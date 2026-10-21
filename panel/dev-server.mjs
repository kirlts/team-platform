#!/usr/bin/env node
// SERVIDOR DOBLE DE DESARROLLO. No es la API de team-platform y no entra a la imagen de producción.
//
// Implementa en memoria el contrato de MASTER-SPEC §7.1 (rutas bajo /api) para poder construir y
// capturar el panel sin la API real. Todo lo que devuelve es dato de ejemplo de desarrollo:
// miembros «Prueba», un proyecto llamado «Desarrollo», mensajes y adjuntos inventados, y un
// «análisis» que reparte el texto por párrafos sin leerlo. Al reiniciar, todo vuelve al inicio.
//
// Acceso: cualquier correo de los miembros de ejemplo (ana@dev.invalid es Editor) con una contraseña
// de 15 caracteres o más. No hay contraseñas guardadas en este archivo.
//
//   node dev-server.mjs                       escucha en 127.0.0.1:8787 (PANEL_DEV_PORT)
//   PANEL_DEV_STATIC=1 node dev-server.mjs    además sirve panel/dist con CSP, como lo haría @fastify/static
//
// Supuestos que el panel hace sobre las respuestas (la especificación sólo fija las rutas) están en
// panel/src/lib/types.ts; este servidor los cumple.

import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.PANEL_DEV_PORT ?? 8787)
const STATIC = process.env.PANEL_DEV_STATIC === '1'
const DIST = fileURLToPath(new URL('./dist/', import.meta.url))
/** Cada paso del análisis simulado dura esto. Sólo existe para que la barra se vea avanzar. */
const STEP_MS = Number(process.env.PANEL_DEV_STEP_MS ?? 700)
const MAX_BODY = 40 * 1024 * 1024

const id = () => randomUUID().slice(0, 8)
const ago = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString()

// ---------------------------------------------------------------- datos de ejemplo

const members = [
  { id: 'u-ana', email: 'ana@dev.invalid', name: 'Ana Prueba', role: 'editor', responsibilities: 'Servidor, base de datos y despliegue.', domains: ['API', 'Infraestructura'] },
  { id: 'u-bruno', email: 'bruno@dev.invalid', name: 'Bruno Prueba', role: 'member', responsibilities: 'Interfaz del panel y accesibilidad.', domains: ['Panel', 'Diseño'] },
  { id: 'u-carla', email: 'carla@dev.invalid', name: 'Carla Prueba', role: 'member', responsibilities: 'Pruebas manuales y reporte de errores.', domains: ['Calidad'] },
  { id: 'u-diego', email: 'diego@dev.invalid', name: 'Diego Prueba', role: 'member', responsibilities: 'Producto y requerimientos del cliente.', domains: ['Producto', 'Soporte'] },
  // Nombres y textos largos a propósito: el panel debe envolverlos, no cortarlos.
  { id: 'u-maria', email: 'maria.de.los.angeles.fernandez.larrain@dev.invalid', name: 'María de los Ángeles Fernández-Larraín', role: 'member', responsibilities: 'Documentación del producto, manuales de usuario, capacitación del equipo del cliente y revisión de los textos de la interfaz en cada versión.', domains: ['Documentación', 'Capacitación', 'Redacción técnica', 'Localización'] },
  { id: 'u-eduardo', email: 'eduardo@dev.invalid', name: 'Eduardo Valenzuela Ibáñez', role: 'member', responsibilities: 'Integraciones con servicios externos.', domains: ['Integraciones'] },
  { id: 'u-sofia', email: 'sofia@dev.invalid', name: 'Sofía Prueba', role: 'member', responsibilities: 'Análisis de datos.', domains: ['Datos'] },
  { id: 'u-tomas', email: 'tomas@dev.invalid', name: 'Tomás Prueba', role: 'member', responsibilities: 'Seguridad.', domains: ['Seguridad'] },
  { id: 'u-valentina', email: 'valentina@dev.invalid', name: 'Valentina Prueba', role: 'member', responsibilities: 'Operación y soporte.', domains: ['Soporte'] },
]

const areas = [
  { id: 'a-idea', title: 'Idea', description: 'Una posibilidad sin compromiso de hacerla.', position: 1 },
  { id: 'a-error', title: 'Error', description: 'Algo que antes funcionaba o debería funcionar y no lo hace.', position: 2 },
  { id: 'a-feature', title: 'Nueva funcionalidad', description: 'Una capacidad que el sistema no tiene y alguien necesita.', position: 3 },
  { id: 'a-feedback', title: 'Retroalimentación', description: 'Una opinión sobre algo que ya existe.', position: 4 },
  { id: 'a-pregunta', title: 'Pregunta', description: 'Algo que alguien necesita saber para seguir.', position: 5 },
  { id: 'a-accesibilidad', title: 'Accesibilidad y experiencia de uso en dispositivos móviles', description: 'Observaciones sobre cómo se lee, se toca y se entiende el panel desde un teléfono, con lector de pantalla o con el teclado solamente.', position: 6 },
]

const templateBody = (name, description, extra = '') =>
  `---\nname: ${name}\ndescription: ${description}\nfields:\n  - { name: summary, label: Resumen, required: true }\n${extra}---\n## Método\nLeer el input y separar un mensaje por cada punto distinto.\n\n## Formato de salida\nUn mensaje por punto. Título: verbo en infinitivo y lugar.\n`

const templates = [
  { id: 't-error', area_id: 'a-error', name: 'Reporte de error', description: 'Algo que antes funcionaba o debería funcionar y no lo hace.', body_markdown: templateBody('Reporte de error', 'Algo que antes funcionaba o debería funcionar y no lo hace.', '  - { name: steps, label: Pasos para reproducir, required: true }\n  - { name: expected, label: Qué se esperaba, required: true }\n  - { name: actual, label: Qué pasó, required: true }\n'), updated_at: ago(3000) },
  { id: 't-error-ui', area_id: 'a-error', name: 'Error visual', description: 'Elementos desalineados, cortados o ilegibles en una pantalla.', body_markdown: templateBody('Error visual', 'Elementos desalineados, cortados o ilegibles en una pantalla.'), updated_at: ago(2900) },
  { id: 't-idea', area_id: 'a-idea', name: 'Idea', description: 'Una posibilidad con su motivo.', body_markdown: templateBody('Idea', 'Una posibilidad con su motivo.'), updated_at: ago(3000) },
  { id: 't-feature', area_id: 'a-feature', name: 'Requerimiento', description: 'Qué se necesita y para quién.', body_markdown: templateBody('Requerimiento', 'Qué se necesita y para quién.'), updated_at: ago(3000) },
  { id: 't-feedback', area_id: 'a-feedback', name: 'Opinión', description: 'Qué se vio y qué se piensa de eso.', body_markdown: templateBody('Opinión', 'Qué se vio y qué se piensa de eso.'), updated_at: ago(3000) },
  { id: 't-pregunta', area_id: 'a-pregunta', name: 'Pregunta', description: 'Qué se necesita saber y para qué.', body_markdown: templateBody('Pregunta', 'Qué se necesita saber y para qué.'), updated_at: ago(3000) },
]

const providers = [
  { slot: 'text', provider: 'anthropic', model: 'claude-haiku-5-5' },
  { slot: 'vision', provider: 'anthropic', model: 'claude-haiku-5-5' },
  { slot: 'speech', provider: 'groq-speech', model: 'whisper-large-v3-turbo' },
]

/** @type {Map<string, {id:string, kind:string, mime:string, name:string, size:number, data:Buffer, input_id?:string}>} */
const attachments = new Map()

function svgCapture(title, hue) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400"><rect width="640" height="400" fill="hsl(${hue} 30% 94%)"/><rect x="0" y="0" width="640" height="36" fill="hsl(${hue} 35% 30%)"/><rect x="24" y="64" width="180" height="300" fill="hsl(${hue} 25% 86%)"/><rect x="228" y="64" width="388" height="120" fill="hsl(${hue} 25% 88%)"/><rect x="228" y="204" width="180" height="160" fill="hsl(${hue} 25% 84%)"/><rect x="436" y="204" width="180" height="160" fill="hsl(${hue} 25% 90%)"/><text x="320" y="388" font-family="sans-serif" font-size="14" text-anchor="middle" fill="hsl(${hue} 20% 35%)">${title} (ejemplo de desarrollo)</text></svg>`,
  )
}

function silentWav(seconds) {
  const rate = 8000
  const samples = rate * seconds
  const buf = Buffer.alloc(44 + samples)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + samples, 4)
  buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate, 28)
  buf.writeUInt16LE(1, 32)
  buf.writeUInt16LE(8, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(samples, 40)
  buf.fill(128, 44)
  return buf
}

function seedAttachment(kind, mime, name, data) {
  const a = { id: `f-${id()}`, kind, mime, name, size: data.length, data }
  attachments.set(a.id, a)
  return a.id
}

const imgDashboard = seedAttachment('image', 'image/svg+xml', 'dashboard.svg', svgCapture('Dashboard', 220))
const imgLogin = seedAttachment('image', 'image/svg+xml', 'login.svg', svgCapture('Inicio de sesión', 150))
const imgAgenda = seedAttachment('image', 'image/svg+xml', 'agenda.svg', svgCapture('Agenda', 20))
const audioNota = seedAttachment('audio', 'audio/wav', 'nota-de-voz.wav', silentWav(6))
const videoDemo = seedAttachment('video', 'video/webm', 'grabacion-del-error.webm', readFileSync(new URL('./dev-fixtures/sample.webm', import.meta.url)))
const linkIssue = seedAttachment('link', 'text/uri-list', 'https://github.com/example/team-platform/issues/1234', Buffer.from('https://github.com/example/team-platform/issues/1234'))
const docFeedback = seedAttachment('document', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'feedback-cliente.docx', Buffer.from('ejemplo de desarrollo'))

/** @type {any[]} */
const messages = []
/** @type {Map<string, any[]>} */
const replies = new Map()

function seedMessage(m, rs = []) {
  const msg = { id: `m-${id()}`, input_id: null, closed_at: null, ...m }
  messages.push(msg)
  replies.set(msg.id, rs.map((r) => ({ id: `r-${id()}`, message_id: msg.id, attachment_ids: [], ...r })))
  return msg
}

seedMessage({ area_id: 'a-error', author_id: 'u-carla', title: 'Corregir el contraste del botón Enviar en el inicio', body: 'El botón Enviar de la barra de nuevo mensaje casi no se distingue del fondo en el tema oscuro.\n\nPasos: abrir Inicio con el tema oscuro y mirar la barra.', status: 'open', created_at: ago(35), assignee_ids: ['u-bruno', 'u-ana'], attachment_ids: [imgDashboard] })
seedMessage({ area_id: 'a-feature', author_id: 'u-diego', title: 'Agregar exportación de mensajes cerrados', body: 'El cliente pidió bajar los mensajes cerrados del mes en un archivo para su revisión.', status: 'answered', created_at: ago(190), assignee_ids: ['u-ana'], attachment_ids: [docFeedback] }, [
  { author_id: 'u-ana', kind: 'clarification', body: '¿El formato es CSV o una hoja de cálculo? Cambia el esfuerzo.', created_at: ago(120) },
  { author_id: 'u-diego', kind: 'answer', body: 'CSV alcanza.', created_at: ago(90) },
])
seedMessage({ area_id: 'a-pregunta', author_id: 'u-bruno', title: 'Definir el tamaño máximo de un video', body: '¿Cuál es el límite de video que vamos a aceptar en la primera versión?', status: 'open', created_at: ago(26 * 60), assignee_ids: ['u-ana', 'u-diego'], attachment_ids: [] })
seedMessage({ area_id: 'a-error', author_id: 'u-carla', title: 'Arreglar el error al iniciar sesión con correo en mayúsculas', body: 'Con el correo escrito en mayúsculas el inicio de sesión responde que la cuenta no existe.', status: 'answered', created_at: ago(28 * 60), assignee_ids: ['u-ana', 'u-carla'], attachment_ids: [imgLogin] }, [
  { author_id: 'u-bruno', kind: 'fix', body: 'Corregido en la rama de acceso: el correo se normaliza antes de buscar.', created_at: ago(26 * 60) },
])
seedMessage({ area_id: 'a-idea', author_id: 'u-diego', title: 'Probar un resumen semanal por área', body: 'Un resumen de lo cerrado y lo abierto por área cada lunes ayudaría a la reunión de equipo.', status: 'open', created_at: ago(50 * 60), assignee_ids: [], attachment_ids: [] })
seedMessage({ area_id: 'a-feedback', author_id: 'u-bruno', title: 'Las fechas de la agenda se leen mejor con el día de la semana', body: 'En la captura de la agenda las fechas sin día de la semana obligan a contar. Sugiero agregarlo.', status: 'closed', created_at: ago(72 * 60), closed_at: ago(60 * 60), assignee_ids: ['u-carla'], attachment_ids: [imgAgenda, audioNota] }, [
  { author_id: 'u-carla', kind: 'answer', body: 'Hecho en la última versión.', created_at: ago(61 * 60) },
])
seedMessage({ area_id: 'a-error', author_id: 'u-ana', title: 'Revisar el tiempo de respuesta de la lista de mensajes', body: 'Con más de doscientos mensajes la lista tarda en abrir.', status: 'open', created_at: ago(96 * 60), assignee_ids: ['u-bruno'], attachment_ids: [] })

// Mensajes con todos los tipos de medio, títulos largos y muchos destinatarios, para ver cómo se reparte el texto.
const everyone = members.map((x) => x.id)
seedMessage({ area_id: 'a-accesibilidad', author_id: 'u-carla', title: 'Revisar la lectura del panel en teléfonos pequeños con el tamaño de letra del sistema al máximo y el tema oscuro activado', body: 'En un teléfono de 360 píxeles de ancho con la letra del sistema al máximo, varias filas se desbordan. Adjunto una captura, la grabación, una nota de voz, el documento con el detalle y el caso en GitHub.', status: 'open', created_at: ago(12), assignee_ids: everyone.filter((x) => x !== 'u-carla'), attachment_ids: [imgDashboard, videoDemo, audioNota, docFeedback, linkIssue] }, [
  { author_id: 'u-maria', kind: 'clarification', body: 'Cuando dices tamaño máximo, ¿hablas del ajuste de accesibilidad de Android o del zoom del navegador? Cambia dónde se arregla.', created_at: ago(8), attachment_ids: [imgLogin, audioNota] },
  { author_id: 'u-ana', kind: 'answer', body: 'Del ajuste de Android. Dejo la grabación del caso.', created_at: ago(5), attachment_ids: [videoDemo, docFeedback, linkIssue] },
])
seedMessage({ area_id: 'a-error', author_id: 'u-diego', title: 'Grabación del cierre de sesión que no borra la sesión anterior', body: 'Se ve en el video: después de cerrar sesión, al volver atrás el panel muestra los mensajes.', status: 'answered', created_at: ago(20), assignee_ids: ['u-ana', 'u-maria'], attachment_ids: [videoDemo] }, [
  { author_id: 'u-ana', kind: 'fix', body: 'Corregido: al cerrar sesión se vacía la caché de consultas.', created_at: ago(15), attachment_ids: [linkIssue] },
])
seedMessage({ area_id: 'a-idea', author_id: 'u-bruno', title: 'Nota de voz con la idea del resumen semanal', body: 'La dejé hablada porque es más rápido.', status: 'open', created_at: ago(40), assignee_ids: ['u-ana'], attachment_ids: [audioNota] })
seedMessage({ area_id: 'a-pregunta', author_id: 'u-diego', title: 'Enlace al caso del cliente', body: 'El cliente lo escribió en su sistema.', status: 'open', created_at: ago(45), assignee_ids: ['u-ana'], attachment_ids: [linkIssue] })

// ---------------------------------------------------------------- estado de sesión, eventos y trabajos

const sessions = new Map()
const inputs = new Map()
const jobs = new Map()
let seq = 0
/** @type {{seq:number, member_id:string|null, name:string, data:any}[]} */
const eventLog = []
/** @type {Set<{member_id:string, res:import('node:http').ServerResponse}>} */
const streams = new Set()

function emit(memberId, name, data) {
  seq += 1
  const ev = { seq, member_id: memberId, name, data }
  eventLog.push(ev)
  for (const s of streams) if (ev.member_id === null || ev.member_id === s.member_id) writeEvent(s.res, ev)
}

function writeEvent(res, ev) {
  res.write(`id: ${ev.seq}\nevent: ${ev.name}\ndata: ${JSON.stringify(ev.data)}\n\n`)
}

function replyView(r) {
  const { attachment_ids, ...rest } = r
  return { ...rest, attachments: (attachment_ids ?? []).map(attachmentView).filter(Boolean) }
}

function view(msg) {
  const rs = replies.get(msg.id) ?? []
  const { attachment_ids, ...rest } = msg
  return {
    ...rest,
    attachments: attachment_ids.map(attachmentView).filter(Boolean),
    reply_count: rs.length,
    last_reply: rs.length ? replyView(rs[rs.length - 1]) : null,
  }
}

function attachmentView(attId) {
  const a = attachments.get(attId)
  return a ? { id: a.id, input_id: a.input_id, kind: a.kind, mime: a.mime, size: a.size, name: a.name } : null
}

function inputView(input) {
  const { content_hash, attachment_ids, ...rest } = input
  void content_hash
  return { ...rest, attachments: attachment_ids.map(attachmentView).filter(Boolean) }
}

function runJob(input) {
  const total = input.attachment_ids.length + 2
  const steps = [
    ...input.attachment_ids.map((aid, i) => ({ status: 'extracting', phrase: `Leyendo adjunto ${i + 1} de ${input.attachment_ids.length}` })),
    { status: 'analyzing', phrase: 'Clasificando el área' },
    { status: 'analyzing', phrase: 'Descomponiendo en mensajes' },
  ]
  let done = 0
  const tick = () => {
    if (input.status === 'cancelled') return
    if (done === total) {
      input.proposal = analyze(input)
      input.status = 'proposed'
      emit(input.author_id, 'done', { job_id: input.job_id, input_id: input.id, done: true })
      return
    }
    const step = steps[done]
    input.status = step.status
    emit(input.author_id, 'progress', { job_id: input.job_id, input_id: input.id, percent: Math.round((done / total) * 100), phrase: step.phrase, at: new Date().toISOString() })
    done += 1
    jobs.set(input.job_id, setTimeout(tick, STEP_MS))
  }
  jobs.set(input.job_id, setTimeout(tick, STEP_MS))
}

let analyzed = 0
/** Unidades numeradas del input: un párrafo cada una. Las numera el servidor, como lo hará el sistema real. */
function unitsOf(text) {
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p, i) => ({ id: `u${i + 1}`, text: p }))
}

/** «Análisis» de desarrollo: un mensaje por unidad, cada uno con su área por turno; la última unidad larga queda sin acción. No lee el sentido del texto. */
function analyze(input) {
  const others = members.filter((m) => m.id !== input.author_id)
  const images = input.attachment_ids.filter((aid) => attachments.get(aid)?.kind === 'image')
  const units = input.units.length ? input.units : [{ id: 'u1', text: 'Sin texto' }]
  const keep = units.length > 3 ? units.slice(0, 3) : units
  const rest = units.slice(keep.length)
  return {
    messages: keep.map((u, i) => {
      const area = areas[analyzed++ % areas.length]
      return {
        area_id: area.id,
        template_id: templates.find((t) => t.area_id === area.id)?.id ?? null,
        title: u.text.split('\n')[0].slice(0, 70),
        body: u.text,
        fields: null,
        assignee_ids: [others[i % others.length].id],
        attachment_ids: i === 0 ? input.attachment_ids : images,
        unit_ids: [u.id],
      }
    }),
    discarded: rest.length ? [{ unit_ids: rest.map((u) => u.id), reason: 'Sin acción para el equipo' }] : [],
  }
}

// ---------------------------------------------------------------- utilidades HTTP

function send(res, status, body, headers = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers })
  res.end(payload)
}

const fail = (res, status, error) => send(res, status, { error })

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error('Cuerpo demasiado grande'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function readJson(req) {
  const buf = await readBody(req)
  if (!buf.length) return {}
  try {
    return JSON.parse(buf.toString('utf8'))
  } catch {
    return null
  }
}

function parseMultipart(buf, boundary) {
  const parts = []
  const delim = Buffer.from(`--${boundary}`)
  let pos = buf.indexOf(delim)
  while (pos !== -1) {
    const start = pos + delim.length
    if (buf.slice(start, start + 2).toString() === '--') break
    const next = buf.indexOf(delim, start)
    if (next === -1) break
    const chunk = buf.slice(start + 2, next - 2)
    const headEnd = chunk.indexOf('\r\n\r\n')
    const head = chunk.slice(0, headEnd).toString('utf8')
    const data = chunk.slice(headEnd + 4)
    const name = /name="([^"]*)"/.exec(head)?.[1]
    const filename = /filename="([^"]*)"/.exec(head)?.[1]
    const type = /content-type:\s*([^\r\n]+)/i.exec(head)?.[1]
    parts.push({ name, filename, type, data })
    pos = next
  }
  return parts
}

function kindOf(mime) {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'document'
}

function cookieOf(req) {
  const raw = req.headers.cookie ?? ''
  const hit = raw.split(';').map((s) => s.trim()).find((s) => s.startsWith('team_session='))
  return hit ? hit.slice('team_session='.length) : null
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.map': 'application/json' }

const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"

function serveStatic(req, res, pathname) {
  let file = normalize(join(DIST, pathname === '/' ? 'index.html' : pathname))
  if (!file.startsWith(DIST)) return fail(res, 403, 'Ruta no permitida')
  const isAsset = pathname.startsWith('/assets/')
  if (!existsSync(file) || statSync(file).isDirectory()) {
    if (isAsset) return fail(res, 404, 'No existe')
    file = join(DIST, 'index.html')
  }
  const headers = {
    'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
    'Content-Security-Policy': CSP,
    'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
  }
  res.writeHead(200, headers)
  createReadStream(file).pipe(res)
}

// ---------------------------------------------------------------- rutas

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const { pathname } = url
  const method = req.method ?? 'GET'

  if (!pathname.startsWith('/api/')) {
    if (STATIC) return serveStatic(req, res, pathname)
    return fail(res, 404, 'Servidor doble de desarrollo: sólo /api')
  }
  const path = pathname.slice('/api'.length)
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(method)

  try {
    if (path === '/health') return send(res, 200, { ok: true, dev: true })

    if (unsafe && !req.headers['x-team-request']) return fail(res, 403, 'Falta la cabecera CSRF')

    if (path === '/auth/login' && method === 'POST') {
      const body = await readJson(req)
      const member = members.find((m) => m.email === String(body?.email ?? '').trim().toLowerCase())
      const password = String(body?.password ?? '')
      if (!member || password.length < 15) return fail(res, 401, 'Correo o contraseña incorrectos')
      const token = randomUUID()
      sessions.set(token, member.id)
      return send(res, 200, { id: member.id }, { 'Set-Cookie': `team_session=${token}; HttpOnly; SameSite=Lax; Path=/` })
    }

    const me = members.find((m) => m.id === sessions.get(cookieOf(req)))
    if (!me) return fail(res, 401, 'Sesión requerida')
    const isEditor = me.role === 'editor'
    const needEditor = () => (isEditor ? false : (fail(res, 403, 'Requiere rol Editor'), true))

    if (path === '/auth/logout' && method === 'POST') {
      sessions.delete(cookieOf(req))
      return send(res, 204, undefined, { 'Set-Cookie': 'team_session=; Max-Age=0; Path=/' })
    }
    if (path === '/me' && method === 'GET') return send(res, 200, { ...me, project_name: 'Desarrollo' })

    // --- eventos
    if (path === '/events' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
      res.write('retry: 3000\n\n')
      const stream = { member_id: me.id, res }
      streams.add(stream)
      const last = Number(req.headers['last-event-id'] ?? 0)
      for (const ev of eventLog) if (ev.seq > last && (ev.member_id === null || ev.member_id === me.id)) writeEvent(res, ev)
      const beat = setInterval(() => res.write(': latido\n\n'), 15_000)
      req.on('close', () => {
        clearInterval(beat)
        streams.delete(stream)
      })
      return
    }

    // --- sólo de desarrollo: simula un mensaje que llega de otro miembro (prueba el aviso por SSE)
    if (path === '/_dev/incoming' && method === 'POST') {
      const from = members.find((x) => x.id !== me.id)
      const msg = seedMessage({ area_id: 'a-pregunta', author_id: from.id, title: 'Confirmar el límite de adjuntos por mensaje', body: 'Mensaje entrante de ejemplo, generado por el servidor de desarrollo.', status: 'open', created_at: new Date().toISOString(), assignee_ids: [me.id], attachment_ids: [] })
      emit(me.id, 'message', { message_id: msg.id, title: msg.title, author_id: from.id, at: msg.created_at })
      return send(res, 201, { message_id: msg.id })
    }

    // --- inputs
    if (path === '/inputs' && method === 'POST') {
      const ct = req.headers['content-type'] ?? ''
      const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(ct)
      if (!boundary) return fail(res, 400, 'Se esperaba multipart')
      const parts = parseMultipart(await readBody(req), boundary[1] ?? boundary[2])
      const text = parts.find((p) => p.name === 'text')?.data.toString('utf8') ?? ''
      const files = parts.filter((p) => p.name === 'files' && p.filename)
      const links = parts.filter((p) => p.name === 'links').map((p) => p.data.toString('utf8'))
      if (!text.trim() && !files.length && !links.length) return fail(res, 400, 'El input está vacío')
      const hash = createHash('sha256').update(me.id).update(text.trim()).update(files.map((f) => createHash('sha256').update(f.data).digest('hex')).join()).update(links.join()).digest('hex')
      const existing = [...inputs.values()].find((i) => i.content_hash === hash && i.status !== 'cancelled' && i.status !== 'published')
      if (existing) return send(res, 200, { input_id: existing.id, job_id: existing.job_id })
      const inputId = `i-${id()}`
      const attachmentIds = []
      for (const f of files) {
        const mime = f.type ?? 'application/octet-stream'
        const a = { id: `f-${id()}`, kind: kindOf(mime), mime, name: f.filename, size: f.data.length, data: f.data, input_id: inputId }
        attachments.set(a.id, a)
        attachmentIds.push(a.id)
      }
      for (const link of links) {
        const a = { id: `f-${id()}`, kind: 'link', mime: 'text/uri-list', name: link, size: link.length, data: Buffer.from(link), input_id: inputId }
        attachments.set(a.id, a)
        attachmentIds.push(a.id)
      }
      const input = { id: inputId, author_id: me.id, text, content_hash: hash, status: 'queued', created_at: new Date().toISOString(), job_id: `j-${id()}`, attachment_ids: attachmentIds, units: unitsOf(text), proposal: null, error: null }
      inputs.set(input.id, input)
      runJob(input)
      return send(res, 201, { input_id: input.id, job_id: input.job_id })
    }

    let m = /^\/inputs\/([^/]+)(?:\/(publish|cancel))?$/.exec(path)
    if (m) {
      const input = inputs.get(m[1])
      if (!input || input.author_id !== me.id) return fail(res, 404, 'No existe')
      if (!m[2] && method === 'GET') {
        return send(res, 200, inputView(input))
      }
      if (m[2] === 'cancel' && method === 'POST') {
        clearTimeout(jobs.get(input.job_id))
        input.status = 'cancelled'
        return send(res, 204)
      }
      if (m[2] === 'publish' && method === 'POST') {
        if (input.status !== 'proposed') return fail(res, 409, 'El input no tiene una propuesta pendiente')
        const body = await readJson(req)
        if (!body || !Array.isArray(body.messages) || !body.messages.length) return fail(res, 422, 'Propuesta inválida')
        const created = []
        for (const pm of body.messages) {
          if (!areas.some((a) => a.id === pm.area_id)) return fail(res, 422, 'Área inexistente')
          if (pm.template_id && templates.find((t) => t.id === pm.template_id)?.area_id !== pm.area_id) return fail(res, 422, 'La plantilla no corresponde al área')
          if (!String(pm.title ?? '').trim() || !String(pm.body ?? '').trim()) return fail(res, 422, 'Hay un mensaje sin título o sin texto')
          if (!(pm.assignee_ids ?? []).every((x) => members.some((mm) => mm.id === x))) return fail(res, 422, 'Destinatario inexistente')
          if (!(pm.attachment_ids ?? []).every((x) => input.attachment_ids.includes(x))) return fail(res, 422, 'Adjunto ajeno al input')
          const msg = seedMessage({ input_id: input.id, area_id: pm.area_id, template_id: pm.template_id ?? null, author_id: me.id, title: pm.title.trim(), body: pm.body.trim(), status: 'open', created_at: new Date().toISOString(), assignee_ids: pm.assignee_ids ?? [], attachment_ids: pm.attachment_ids ?? [] })
          created.push(msg.id)
          for (const to of msg.assignee_ids) if (to !== me.id) emit(to, 'message', { message_id: msg.id, title: msg.title, author_id: me.id, at: msg.created_at })
        }
        input.status = 'published'
        return send(res, 201, { message_ids: created })
      }
    }

    // --- mensajes
    if (path === '/messages' && method === 'GET') {
      const q = url.searchParams
      const forId = q.get('for') === 'me' ? me.id : q.get('for')
      const needle = (q.get('q') ?? '').toLowerCase()
      let list = messages.filter((x) => (!forId || x.assignee_ids.includes(forId)) && (!q.get('area') || x.area_id === q.get('area')) && (!q.get('status') || x.status === q.get('status')) && (!needle || `${x.title} ${x.body}`.toLowerCase().includes(needle)))
      if (q.get('replies') === '1') list = list.filter((x) => (replies.get(x.id) ?? []).length > 0)
      const stamp = (x) => (q.get('replies') === '1' ? (replies.get(x.id) ?? []).at(-1)?.created_at : x.created_at)
      list.sort((a, b) => stamp(b).localeCompare(stamp(a)))
      return send(res, 200, list.map(view))
    }
    m = /^\/messages\/([^/]+)(?:\/(replies|close|reopen))?$/.exec(path)
    if (m) {
      const msg = messages.find((x) => x.id === m[1])
      if (!msg) return fail(res, 404, 'No existe')
      if (!m[2] && method === 'GET') return send(res, 200, { ...view(msg), replies: replies.get(msg.id).map(replyView) })
      if (m[2] === 'replies' && method === 'POST') {
        if (msg.author_id === me.id) return fail(res, 403, 'El emisor no puede responder su propio mensaje')
        const body = await readJson(req)
        if (!body || !String(body.body ?? '').trim() || !['answer', 'fix', 'clarification'].includes(body.kind)) return fail(res, 422, 'Respuesta inválida')
        const reply = { id: `r-${id()}`, message_id: msg.id, author_id: me.id, body: body.body.trim(), kind: body.kind, created_at: new Date().toISOString(), attachment_ids: [] }
        replies.get(msg.id).push(reply)
        if (msg.status === 'open') msg.status = 'answered'
        return send(res, 201, replyView(reply))
      }
      if (m[2] === 'close' && method === 'POST') {
        msg.status = 'closed'
        msg.closed_at = new Date().toISOString()
        return send(res, 204)
      }
      if (m[2] === 'reopen' && method === 'POST') {
        msg.status = (replies.get(msg.id) ?? []).length ? 'answered' : 'open'
        msg.closed_at = null
        return send(res, 204)
      }
    }

    // --- áreas y plantillas
    if (path === '/areas' && method === 'GET') {
      return send(res, 200, areas.map((a) => ({ ...a, open_count: messages.filter((x) => x.area_id === a.id && x.status !== 'closed').length, template_count: templates.filter((t) => t.area_id === a.id).length })))
    }
    if (path === '/areas' && method === 'POST') {
      if (needEditor()) return
      const body = await readJson(req)
      if (!String(body?.title ?? '').trim()) return fail(res, 422, 'El título es obligatorio')
      const area = { id: `a-${id()}`, title: body.title.trim(), description: String(body.description ?? '').trim(), position: areas.length + 1 }
      areas.push(area)
      return send(res, 201, area)
    }
    m = /^\/areas\/([^/]+)$/.exec(path)
    if (m && method === 'PATCH') {
      if (needEditor()) return
      const area = areas.find((a) => a.id === m[1])
      const body = await readJson(req)
      if (!area || !body) return fail(res, 404, 'No existe')
      if (body.title !== undefined) {
        if (!String(body.title).trim()) return fail(res, 422, 'El título es obligatorio')
        area.title = String(body.title).trim()
      }
      if (body.description !== undefined) area.description = String(body.description).trim()
      return send(res, 200, area)
    }
    m = /^\/areas\/([^/]+)\/templates(?:\/([^/]+))?$/.exec(path)
    if (m) {
      if (!areas.some((a) => a.id === m[1])) return fail(res, 404, 'No existe')
      if (method === 'GET' && !m[2]) return send(res, 200, templates.filter((t) => t.area_id === m[1]))
      if (needEditor()) return
      const body = method === 'DELETE' ? {} : await readJson(req)
      const check = (b) => {
        if (b.name !== undefined && (!String(b.name).trim() || String(b.name).length > 64)) return 'El nombre admite de 1 a 64 caracteres'
        if (b.description !== undefined && String(b.description).length > 1024) return 'La descripción admite hasta 1.024 caracteres'
        return null
      }
      if (method === 'POST' && !m[2]) {
        const err = check(body ?? {}) ?? (body?.name ? null : 'El nombre es obligatorio')
        if (err) return fail(res, 422, err)
        const t = { id: `t-${id()}`, area_id: m[1], name: body.name.trim(), description: String(body.description ?? '').trim(), body_markdown: String(body.body_markdown ?? ''), updated_at: new Date().toISOString() }
        templates.push(t)
        return send(res, 201, t)
      }
      const t = templates.find((x) => x.id === m[2] && x.area_id === m[1])
      if (!t) return fail(res, 404, 'No existe')
      if (method === 'PATCH') {
        const err = check(body ?? {})
        if (err) return fail(res, 422, err)
        for (const k of ['name', 'description', 'body_markdown']) if (body[k] !== undefined) t[k] = String(body[k])
        t.updated_at = new Date().toISOString()
        return send(res, 200, t)
      }
      if (method === 'DELETE') {
        templates.splice(templates.indexOf(t), 1)
        return send(res, 204)
      }
    }

    // --- equipo y ajustes
    if (path === '/members' && method === 'GET') return send(res, 200, members)
    m = /^\/members\/([^/]+)$/.exec(path)
    if (m && method === 'PATCH') {
      const target = m[1] === 'me' ? me : members.find((x) => x.id === m[1])
      if (!target) return fail(res, 404, 'No existe')
      if (target.id !== me.id && needEditor()) return
      const body = await readJson(req)
      if (!body) return fail(res, 400, 'JSON inválido')
      if (body.responsibilities !== undefined) target.responsibilities = String(body.responsibilities)
      if (Array.isArray(body.domains)) target.domains = body.domains.map(String).filter(Boolean)
      if (body.role !== undefined) {
        if (!isEditor) return fail(res, 403, 'Requiere rol Editor')
        if (!['member', 'editor'].includes(body.role)) return fail(res, 422, 'Rol inválido')
        target.role = body.role
      }
      return send(res, 200, target)
    }
    if (path === '/settings/providers') {
      if (needEditor()) return
      if (method === 'GET') return send(res, 200, providers)
      if (method === 'PATCH') {
        const body = await readJson(req)
        const slot = providers.find((p) => p.slot === body?.slot)
        if (!slot || !String(body.provider ?? '').trim() || !String(body.model ?? '').trim()) return fail(res, 422, 'Ranura, proveedor y modelo son obligatorios')
        slot.provider = body.provider.trim()
        slot.model = body.model.trim()
        return send(res, 200, slot)
      }
    }
    m = /^\/attachments\/([^/]+)$/.exec(path)
    if (m && method === 'GET') {
      const a = attachments.get(m[1])
      if (!a) return fail(res, 404, 'No existe')
      res.writeHead(200, { 'Content-Type': a.mime, 'Content-Length': a.data.length, 'Content-Disposition': `inline; filename="${encodeURIComponent(a.name)}"`, 'Cache-Control': 'private, max-age=3600' })
      return res.end(a.data)
    }

    return fail(res, 404, 'Ruta inexistente')
  } catch (err) {
    console.error(err)
    if (!res.headersSent) fail(res, 500, 'Error interno del servidor doble')
    else res.end()
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[dev-server] SERVIDOR DOBLE DE DESARROLLO con datos de ejemplo en http://127.0.0.1:${PORT}/api${STATIC ? ' (sirve también panel/dist)' : ''}`)
})
