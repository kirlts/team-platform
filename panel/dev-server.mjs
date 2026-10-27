#!/usr/bin/env node
// DEVELOPMENT DOUBLE SERVER. It is not the team-platform API and does not go into the production image.
//
// Implements the MASTER-SPEC §7.1 contract in memory (routes under /api) so the panel can be built and
// captured without the real API. Everything it returns is development sample data:
// «Prueba» members, a project called «Desarrollo», invented messages and attachments, and an
// «analysis» that splits the text by paragraphs without reading it. On restart, everything goes back to the start.
//
// Access: any email of the sample members (ana@dev.invalid is Editor) with a password
// of 15 characters or more. No passwords are stored in this file.
//
//   node dev-server.mjs                       listens on 127.0.0.1:8787 (PANEL_DEV_PORT)
//   PANEL_DEV_STATIC=1 node dev-server.mjs    also serves panel/dist with CSP, as @fastify/static would
//
// Assumptions the panel makes about the responses (the specification only fixes the routes) are in
// panel/src/lib/types.ts; this server meets them.

import { createHash, randomUUID } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import Ajv from 'ajv'
import { parseTemplate } from '../src/analyze/templates.js'
import { mountedIndex } from '../src/api/mount.js'
import { loadConfig } from '../src/config.js'
import { changeOfWrite } from '../src/events/changes.js'
import { batchSchema } from '../src/telemetry/ui-spec.js'
import { recordUiBatch, uiSummary } from '../src/telemetry/ui.js'

const PORT = Number(process.env.PANEL_DEV_PORT ?? 8787)
const STATIC = process.env.PANEL_DEV_STATIC === '1'
/** PANEL_DEV_BASE=/team/ serves the panel and the API under that path, as the real server does with BASE_PATH (H-3721). */
const BASE = `/${(process.env.PANEL_DEV_BASE ?? '/').replace(/^\/+|\/+$/g, '')}/`.replace('//', '/')
/** PANEL_DEV_DIST serves another build than panel/dist: a test that builds its own copy never shares a folder with another test (the build empties it). */
const DIST = process.env.PANEL_DEV_DIST ? `${resolve(process.env.PANEL_DEV_DIST)}${sep}` : fileURLToPath(new URL('./dist/', import.meta.url))
/** Each step of the simulated analysis lasts this long. It only exists so the bar visibly advances. */
const STEP_MS = Number(process.env.PANEL_DEV_STEP_MS ?? 700)
const MAX_BODY = 40 * 1024 * 1024
/** PANEL_DEV_CONTROL=1 opens /api/_control/*: a test freezes and advances the simulated analysis and resets the sample state by an explicit order (H-901). */
const CONTROL = process.env.PANEL_DEV_CONTROL === '1'
/** THEME_CSS=/path/theme.css serves the host's theme sheet after the panel's, and the fonts and images next to it under theme/, as the real server does (H-3721). */
const THEME_CSS = process.env.THEME_CSS ?? ''

const id = () => randomUUID().slice(0, 8)
// Every sample date hangs from ONE instant, the birth of the server. With `Date.now()` at each call, two messages seeded «40 minutes ago» a few
// lines apart got dates a millisecond apart on a loaded machine and swapped places in the newest-first list (2026-10-26: Mensajes showed
// four rows with media instead of three and one without, in a different one of the pool's files each run).
const BORN = Date.now()
const ago = (minutes) => new Date(BORN - minutes * 60_000).toISOString()

// ---------------------------------------------------------------- sample data

const members = [
  { id: 'u-ana', email: 'ana@dev.invalid', name: 'Ana Prueba', role: 'editor', language: 'es-419', active: true, profile: 'Soy la Editora del equipo y llevo el servidor, la base de datos y el despliegue. Decido cómo se publica y qué entra a producción.\n\nNo toco la interfaz del panel ni las pruebas manuales. Prefiero que los avisos lleguen con el error literal y el paso donde ocurrió.' },
  { id: 'u-bruno', email: 'bruno@dev.invalid', name: 'Bruno Prueba', role: 'member', language: 'es-419', active: true, profile: 'Me encargo de la interfaz del panel y de la accesibilidad. Sé de React, de teclado y de lectores de pantalla.\n\nNo decido nada de la API. Prefiero recibir los reportes con una captura y el tamaño de la ventana.' },
  { id: 'u-carla', email: 'carla@dev.invalid', name: 'Carla Prueba', role: 'member', language: 'es-419', active: true, profile: 'Hago pruebas manuales y reporto errores con sus pasos para reproducirlos. Conozco el comportamiento esperado de cada pantalla.\n\nNo arreglo código. Prefiero que me devuelvan el caso cerrado con la versión donde quedó corregido.' },
  { id: 'u-diego', email: 'diego@dev.invalid', name: 'Diego Prueba', role: 'member', language: 'es-419', active: true, profile: 'Llevo producto y los requerimientos del cliente. Decido el orden de lo que se construye.\n\nNo toco infraestructura. Prefiero las preguntas por escrito y con el contexto del cliente.' },
  // Names and texts deliberately long: the panel must wrap them, not cut them.
  { id: 'u-maria', email: 'maria.de.los.angeles.fernandez.larrain@dev.invalid', name: 'María de los Ángeles Fernández-Larraín', role: 'member', language: 'es-419', active: true, profile: 'Escribo la documentación del producto, los manuales de usuario y la capacitación del equipo del cliente, y reviso los textos de la interfaz en cada versión. Sé de redacción técnica, de localización y de accesibilidad del lenguaje.\n\nDecido el tono de todo texto que lee una persona usuaria. No toco el código ni la base de datos; si un texto está en el código, pido el cambio a quien lo mantiene.\n\nPrefiero que me lleguen los cambios con el texto antes y el texto después, y que me avisen con tiempo cuando una pantalla cambia de lugar. Los audios largos me cuestan; prefiero un resumen escrito.' },
  { id: 'u-eduardo', email: 'eduardo@dev.invalid', name: 'Eduardo Valenzuela Ibáñez', role: 'member', language: 'es-419', active: true, profile: 'Hago integraciones con servicios externos: correo, GitHub y mensajería. Conozco las cuotas y los límites de cada proveedor.\n\nNo decido el diseño de las pantallas.' },
  { id: 'u-sofia', email: 'sofia@dev.invalid', name: 'Sofía Prueba', role: 'member', language: 'es-419', active: true, profile: 'Analizo datos: mido cuánto tarda cada paso y qué cuesta cada llamada al modelo.\n\nNo toco el panel.' },
  { id: 'u-tomas', email: 'tomas@dev.invalid', name: 'Tomás Prueba', role: 'member', language: 'es-419', active: true, profile: 'Me ocupo de la seguridad: sesiones, permisos y secretos. Decido qué se publica hacia afuera.' },
  { id: 'u-valentina', email: 'valentina@dev.invalid', name: 'Valentina Prueba', role: 'member', language: 'es-419', active: true, profile: 'Llevo la operación y el soporte. Contesto las dudas del equipo del cliente.\n\nNo toco el código.' },
]

const AREA_PALETTE = ['#6d28d9', '#c2410c', '#15803d', '#0f766e', '#a21caf', '#4d7c0f', '#be185d', '#0369a1']

const areas = [
  { id: 'a-idea', color: '#6d28d9', title: 'Idea', description: 'Una posibilidad sin compromiso de hacerla.', position: 1 },
  { id: 'a-error', color: '#854d0e', title: 'Error', description: 'Algo que antes funcionaba o debería funcionar y no lo hace.', position: 2, handoffs: [{ member_id: 'u-ana', count: 3 }, { member_id: 'u-diego', count: 1 }], guards: [{ id: 1, text: 'Nada cambia el cobro del plan', mechanism: 'credencial de solo lectura', person: true }] },
  { id: 'a-feature', color: '#15803d', title: 'Nueva funcionalidad', description: 'Una capacidad que el sistema no tiene y alguien necesita.', position: 3 },
  { id: 'a-feedback', color: '#0f766e', title: 'Retroalimentación', description: 'Una opinión sobre algo que ya existe.', position: 4 },
  { id: 'a-pregunta', color: '#a21caf', title: 'Pregunta', description: 'Algo que alguien necesita saber para seguir.', position: 5 },
  { id: 'a-accesibilidad', color: '#4d7c0f', title: 'Accesibilidad y experiencia de uso en dispositivos móviles', description: 'Observaciones sobre cómo se lee, se toca y se entiende el panel desde un teléfono, con lector de pantalla o con el teclado solamente.', position: 6 },
]

/** The area as the API shows it (UD-269): who decides now (the one set while it is an active person, else the first active Editor) and the week's handoffs by person. */
const areaView = (a) => {
  const person = (mid) => members.find((m) => m.id === mid && m.kind !== 'agent' && m.active)
  const decider = person(a.escalation_member_id) ?? members.find((m) => m.role === 'editor' && m.kind !== 'agent' && m.active)
  const { escalation_member_id: _stored, ...rest } = a
  // UD-295: the larger and the light model of the area as they apply now, and its Guards.
  return { ...rest, execute_model: a.execute_model ?? 'claude-sonnet-5-5', execute_model_light: a.execute_model_light ?? 'claude-haiku-5-5', guards: a.guards ?? [], escalation_member_id: decider?.id ?? null, handoffs: a.handoffs ?? [] }
}

const templateBody = (name, description, extra = '') =>
  `---\nname: ${name}\ndescription: ${description}\nfields:\n  - { name: summary, label: Resumen, required: true }\n${extra}---\n## Método\nLeer el input y separar un mensaje por cada punto distinto.\n\n## Formato de salida\nUn mensaje por punto. Título: verbo en infinitivo y lugar.\n`

const templates = [
  { id: 't-error', area_id: 'a-error', name: 'Reporte de error', description: 'Qué falló, cómo reproducirlo y qué se esperaba ver.', body_markdown: templateBody('Reporte de error', 'Qué falló, cómo reproducirlo y qué se esperaba ver.', '  - { name: steps, label: Pasos para reproducir, required: true }\n  - { name: expected, label: Qué se esperaba, required: true }\n  - { name: actual, label: Qué pasó, required: true }\noutput:\n  - { name: cause, label: Causa, type: text, required: true }\n  - { name: branch, label: Rama, type: text, required: false }\n'), updated_at: ago(3000), deleted_at: null },
  { id: 't-error-ui', area_id: 'a-error', name: 'Error visual', description: 'Elementos desalineados, cortados o ilegibles en una pantalla.', body_markdown: templateBody('Error visual', 'Elementos desalineados, cortados o ilegibles en una pantalla.'), updated_at: ago(2900) },
  { id: 't-idea', area_id: 'a-idea', name: 'Idea', description: 'Una posibilidad con su motivo.', body_markdown: templateBody('Idea', 'Una posibilidad con su motivo.'), updated_at: ago(3000) },
  { id: 't-feature', area_id: 'a-feature', name: 'Requerimiento', description: 'Qué se necesita y para quién.', body_markdown: templateBody('Requerimiento', 'Qué se necesita y para quién.'), updated_at: ago(3000) },
  { id: 't-feedback', area_id: 'a-feedback', name: 'Opinión', description: 'Qué se vio y qué se piensa de eso.', body_markdown: templateBody('Opinión', 'Qué se vio y qué se piensa de eso.'), updated_at: ago(3000) },
  { id: 't-pregunta', area_id: 'a-pregunta', name: 'Pregunta', description: 'Qué se necesita saber y para qué.', body_markdown: templateBody('Pregunta', 'Qué se necesita saber y para qué.'), updated_at: ago(3000) },
  { id: 't-accesibilidad', area_id: 'a-accesibilidad', name: 'Observación de accesibilidad', description: 'Qué se vio, con qué dispositivo o ayuda técnica y qué impide hacer.', body_markdown: templateBody('Observación de accesibilidad', 'Qué se vio, con qué dispositivo o ayuda técnica y qué impide hacer.', '  - { name: device, label: Dispositivo o ayuda técnica, required: false }\n'), updated_at: ago(3000) },
]

/** Same default as the server (config.project.descriptionMaxChars). */
const PROJECT_MAX_CHARS = 200000
const PROJECT_NAME = 'Desarrollo'
/** Same cap and defaults as the server (H-3722: config.project.nameMaxChars, config.analysis.framingMaxChars, prompts-*.js). */
const PROJECT_NAME_MAX_CHARS = 80
const FRAMING_MAX_CHARS = 2000
const FRAMING_DEFAULTS = {
  'es-419': 'Esta es la bandeja de entrada de un equipo de software pequeño. Un mismo input puede traer varios puntos de áreas distintas: un error, una idea, una pregunta.',
  en: 'This is the inbox of a small software team. One input may carry several points from different areas: a bug, an idea, a question.',
}
let framing = {}
const framingView = () => ({
  framing: Object.fromEntries(Object.entries(FRAMING_DEFAULTS).map(([lang, def]) => [lang, { value: framing[lang] ?? def, default: def, custom: lang in framing }])),
  max_chars: FRAMING_MAX_CHARS,
})
const project = {
  name: PROJECT_NAME,
  description: '# Desarrollo\n\nPanel y API de un equipo chico que reparte mensajes con un modelo de lenguaje.\n\n## Stack\n\n- **Servidor**: Node con SQLite en un solo volumen.\n- **Panel**: React, TanStack Query y React Router.\n- Los adjuntos viven en `attachments/` y se sirven por la API.\n\n## Decisiones\n\n1. Todo lo que pasa por un modelo se mide.\n2. El código va en inglés y la interfaz en el idioma de la cuenta.\n\nMás detalle en [el repositorio](https://example.com/repo).',
}

const providers = [
  { slot: 'text', provider: 'anthropic', model: 'claude-haiku-5-5' },
  { slot: 'vision', provider: 'anthropic', model: 'claude-haiku-5-5' },
  { slot: 'speech', provider: 'groq-speech', model: 'whisper-large-v3-turbo' },
]

// ---- Provider connections (keys). The double never keeps a key: only its last four characters, like the real server's views.
const CAUSES = ['invalid_key', 'no_quota', 'model_not_found', 'no_network', 'rate_limited', 'timeout', 'bad_address', 'provider_error', 'unknown']
const PRESETS = [
  { name: 'deepseek', label: 'DeepSeek', kind: 'openai-compatible', base_url: 'https://api.deepseek.com/v1', suggested_model: 'deepseek-chat', structured: 'json_object' },
  { name: 'groq', label: 'Groq', kind: 'openai-compatible', base_url: 'https://api.groq.com/openai/v1', suggested_model: 'llama-3.3-70b-versatile', structured: 'json_schema' },
  { name: 'openrouter', label: 'OpenRouter', kind: 'openai-compatible', base_url: 'https://openrouter.ai/api/v1', suggested_model: 'openai/gpt-5-mini', structured: 'json_schema' },
  { name: 'gemini', label: 'Gemini', kind: 'openai-compatible', base_url: 'https://generativelanguage.googleapis.com/v1beta/openai', suggested_model: 'gemini-2.5-flash', structured: 'json_schema' },
]
const SLOT_PROVIDERS = { text: ['anthropic', 'openai-compatible'], vision: ['anthropic', 'openai-compatible'], speech: ['groq-speech'] }
const NAME_RE = /^[a-z0-9-]{2,40}$/
const HTTP_BY_CAUSE = { invalid_key: 401, no_quota: 402, model_not_found: 404, rate_limited: 429, provider_error: 502 }
const iso = (offsetMs = 0) => new Date(Date.now() - offsetMs).toISOString()
const randomMs = () => 40 + Math.floor(Math.random() * 360)

/** @type {Map<string, any>} */
const connections = new Map()
function seedConnections() {
  connections.clear()
  const add = (c) => connections.set(c.name, c)
  add({ name: 'anthropic', label: 'Anthropic', kind: 'anthropic', custom: false, base_url: null, structured: null, key: { source: 'environment', last4: '0000', updated_at: null }, last_check: { at: iso(3 * 3600_000), ok: true, cause: null, duration_ms: 212 } })
  add({ name: 'groq-speech', label: 'Groq (transcripción)', kind: 'groq-speech', custom: false, base_url: 'https://api.groq.com/openai/v1', structured: null, key: { source: 'stored', last4: '5678', updated_at: iso(2 * 86_400_000) }, last_check: { at: iso(2 * 3600_000), ok: true, cause: null, duration_ms: 148 } })
  for (const p of PRESETS) add({ ...p, custom: false, key: { source: null, last4: null, updated_at: null }, last_check: null })
  add({ name: 'mi-gateway', label: 'Pasarela interna', kind: 'openai-compatible', custom: true, base_url: 'https://llm.ejemplo.invalid/v1', structured: 'json_object', key: { source: 'stored', last4: '9f2a', updated_at: iso(5 * 86_400_000) }, last_check: { at: iso(26 * 60_000), ok: false, cause: 'no_quota', duration_ms: 190 } })
}
seedConnections()

const usedBy = (name) => providers.filter((p) => p.provider === name).map((p) => p.slot)
function connectionView(c) {
  const used = usedBy(c.name)
  const status = !c.key.source ? 'no_key' : c.last_check && !c.last_check.ok ? 'failing' : 'configured'
  return { name: c.name, label: c.label, kind: c.kind, custom: c.custom, base_url: c.base_url, structured: c.structured, status, key: { ...c.key }, used_by: used, last_check: c.last_check }
}
/** Listed: the two fixed ones, every custom one, and any preset with a key or in use. */
const listed = (c) => c.name === 'anthropic' || c.name === 'groq-speech' || c.custom || c.key.source !== null || usedBy(c.name).length > 0

/**
 * The simulated test of the contract: a key containing `fail-<cause>` fails with that cause, a model containing `missing-model`
 * fails with model_not_found, and anything else works with 40 to 400 ms and the models `modelo-a`, `modelo-b` and the one asked for.
 */
function simulateCheck({ apiKey, hasKey = true, model }) {
  const base = { model: model ?? null, checked_at: iso() }
  const fail = (cause) => ({ ok: false, cause, status: HTTP_BY_CAUSE[cause] ?? null, duration_ms: cause === 'timeout' ? 15000 : randomMs(), models: null, model_listed: null, ...base })
  if (!hasKey) return fail('invalid_key')
  const asked = /fail-([a-z_]+)/.exec(apiKey ?? '')
  if (asked && CAUSES.includes(asked[1])) return fail(asked[1])
  if (model && model.includes('missing-model')) return fail('model_not_found')
  const models = ['modelo-a', 'modelo-b', ...(model ? [model] : [])]
  return { ok: true, cause: null, status: 200, duration_ms: randomMs(), models, model_listed: model ? true : null, ...base }
}
const stamp = (c, check) => {
  c.last_check = { at: check.checked_at, ok: check.ok, cause: check.cause, duration_ms: check.duration_ms }
}
const checkFailure = (res, check) => send(res, 422, { code: 'provider_check_failed', message: 'La prueba contra el proveedor falló', cause: check.cause, status_code: check.status ?? undefined, duration_ms: check.duration_ms })
const last4Of = (key) => String(key).trim().slice(-4)

function providersView() {
  return {
    analyzer: 'api',
    items: providers.map((p) => {
      const c = connections.get(p.provider)
      const view = c ? connectionView(c) : null
      const hasKey = !!c?.key.source
      return { slot: p.slot, provider: p.provider, model: p.model, ...(c?.base_url ? { base_url: c.base_url } : {}), available: hasKey, reason: hasKey ? null : 'missing_api_key', key_last4: c?.key.last4 ?? null, status: view?.status ?? 'no_key' }
    }),
  }
}

/** @type {Map<string, {id:string, kind:string, mime:string, name:string, size:number, data:Buffer, input_id?:string}>} */
const attachments = new Map()

function svgCapture(title, hue) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400"><rect width="640" height="400" fill="hsl(${hue} 30% 94%)"/><rect x="0" y="0" width="640" height="36" fill="hsl(${hue} 35% 30%)"/><rect x="24" y="64" width="180" height="300" fill="hsl(${hue} 25% 86%)"/><rect x="228" y="64" width="388" height="120" fill="hsl(${hue} 25% 88%)"/><rect x="228" y="204" width="180" height="160" fill="hsl(${hue} 25% 84%)"/><rect x="436" y="204" width="180" height="160" fill="hsl(${hue} 25% 90%)"/><text x="320" y="388" font-family="sans-serif" font-size="14" text-anchor="middle" fill="hsl(${hue} 20% 35%)">${title} (ejemplo de desarrollo)</text></svg>`,
  )
}

/** A real PNG (what a pasted capture is in production: `image.png`), with a gradient so every size is different and none is a flat color. */
function pngCapture(width, height, hue) {
  const crc = (buf) => {
    let c = ~0
    for (const b of buf) {
      c ^= b
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
    }
    return ~c >>> 0
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data])
    const out = Buffer.alloc(12 + data.length)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(crc(body), 8 + data.length)
    return out
  }
  const head = Buffer.alloc(13)
  head.writeUInt32BE(width, 0)
  head.writeUInt32BE(height, 4)
  head.set([8, 2, 0, 0, 0], 8)
  const rows = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    const at = y * (width * 3 + 1)
    for (let x = 0; x < width; x++) rows.set([(hue + x) % 256, (hue * 2 + y) % 256, ((x + y) >> 1) % 256], at + 1 + x * 3)
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', head), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
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

/** The state of a message, derived as the real API does (UD-042): closed when it was closed; otherwise answered with one reply or more, and open without any. Never written by hand. */
/** The replies still in the thread: a deleted one (UD-240) is kept to be restored, but no read counts it. */
const liveReplies = (msg) => (replies.get(msg.id) ?? []).filter((r) => !r.deleted_at)
/** The messages still in the lists: a deleted one is kept to be restored, but no read counts it. */
const liveMessages = () => messages.filter((x) => !x.deleted_at)

function syncStatus(msg) {
  // A forward is a notice of the thread, not an answer (UD-272): the message waits for whoever received it.
  msg.status = msg.closed_at ? 'closed' : liveReplies(msg).some((r) => r.kind !== 'forward') ? 'answered' : 'open'
  return msg.status
}

/** The number of a message, as the real server numbers them: a counter that only goes up (the panel draws it as #N). */
let lastMessageNumber = 100
function seedMessage(m, rs = []) {
  const msg = { id: String(++lastMessageNumber), input_id: null, closed_at: null, ...m }
  messages.push(msg)
  replies.set(msg.id, rs.map((r) => ({ id: `r-${id()}`, message_id: msg.id, attachment_ids: [], ...r })))
  syncStatus(msg)
  return msg
}

seedMessage({ assessment: { expectation: 'Cambiar el color del botón y mostrar el antes y el después.', guards: [1], estimates: { understand_vs_create: 0.15, irreversibility: 0.1, value_holder: 'model', certainty: 0.9, reason: 'Es un ajuste de estilo con la causa dicha.', idea: 0.1, idea_guard: false, idea_reason: 'Describe algo que falla, no una posibilidad.' }, by: null }, area_id: 'a-error', author_id: 'u-carla', title: 'Corregir el contraste del botón Enviar en el inicio', body: 'El botón Enviar de la barra de nuevo mensaje casi no se distingue del fondo en el tema oscuro.\n\nPasos: abrir Inicio con el tema oscuro y mirar la barra.', created_at: ago(35), assignee_ids: ['u-bruno', 'u-ana'], attachment_ids: [imgDashboard] })
seedMessage({ assessment: { expectation: 'Investigar el formato del archivo y proponer cómo exportarlo; después, implementarlo.', guards: [], estimates: { understand_vs_create: 0.6, irreversibility: 0.2, value_holder: 'model', certainty: 0.7, reason: 'Hay que diseñar el formato.' }, by: null }, area_id: 'a-feature', author_id: 'u-diego', title: 'Agregar exportación de mensajes cerrados', body: 'El cliente pidió bajar los mensajes cerrados del mes en un archivo para su revisión.', created_at: ago(190), assignee_ids: ['u-ana'], attachment_ids: [docFeedback] }, [
  { author_id: 'u-ana', kind: 'clarification', body: '¿El formato es CSV o una hoja de cálculo? Cambia el esfuerzo.', created_at: ago(120) },
  { author_id: 'u-diego', kind: 'answer', body: 'CSV alcanza.', created_at: ago(90) },
])
seedMessage({ assessment: { expectation: 'Reunir los datos de uso de video y recomendar un límite; la decisión es de una persona.', guards: [], estimates: { understand_vs_create: 0.5, irreversibility: 0.6, value_holder: 'person', certainty: 0.8, reason: 'Falta un criterio del negocio.' }, by: null }, area_id: 'a-pregunta', author_id: 'u-bruno', title: 'Definir el tamaño máximo de un video', body: '¿Cuál es el límite de video que vamos a aceptar en la primera versión?', created_at: ago(26 * 60), assignee_ids: ['u-ana', 'u-diego'], attachment_ids: [] })
seedMessage({ area_id: 'a-error', author_id: 'u-carla', title: 'Arreglar el error al iniciar sesión con correo en mayúsculas', body: 'Con el correo escrito en mayúsculas el inicio de sesión responde que la cuenta no existe.', created_at: ago(28 * 60), assignee_ids: ['u-ana', 'u-carla'], attachment_ids: [imgLogin] }, [
  { author_id: 'u-bruno', kind: 'fix', body: 'Corregido en la rama de acceso: el correo se normaliza antes de buscar.', created_at: ago(26 * 60) },
])
seedMessage({ area_id: 'a-idea', author_id: 'u-diego', title: 'Probar un resumen semanal por área', body: 'Un resumen de lo cerrado y lo abierto por área cada lunes ayudaría a la reunión de equipo.', created_at: ago(50 * 60), assignee_ids: [], attachment_ids: [] })
seedMessage({ area_id: 'a-feedback', author_id: 'u-bruno', title: 'Las fechas de la agenda se leen mejor con el día de la semana', body: 'En la captura de la agenda las fechas sin día de la semana obligan a contar. Sugiero agregarlo.', created_at: ago(72 * 60), closed_at: ago(60 * 60), assignee_ids: ['u-carla'], attachment_ids: [imgAgenda, audioNota] }, [
  { author_id: 'u-carla', kind: 'answer', body: 'Hecho en la última versión.', created_at: ago(61 * 60) },
])
seedMessage({ area_id: 'a-error', author_id: 'u-ana', title: 'Revisar el tiempo de respuesta de la lista de mensajes', body: 'Con más de doscientos mensajes la lista tarda en abrir.', created_at: ago(96 * 60), assignee_ids: ['u-bruno'], attachment_ids: [] })

// A message Ana sent that someone answered: blue for her (informative), since it is not assigned to her.
seedMessage({ area_id: 'a-pregunta', author_id: 'u-ana', title: 'Confirmar el formato de las capturas del informe', body: 'Para el informe mensual necesito saber si las capturas van en PNG o en JPG.', created_at: ago(40), fields: { question: 'PNG o JPG para las capturas del informe.' }, assignee_ids: ['u-bruno'], attachment_ids: [] }, [
  { author_id: 'u-bruno', kind: 'answer', body: 'PNG: las capturas con texto se ven nítidas.', created_at: ago(18) },
])

// Messages with every media type, long titles and many recipients, to see how the text is distributed.
const everyone = members.map((x) => x.id)
seedMessage({ area_id: 'a-accesibilidad', author_id: 'u-carla', title: 'Revisar la lectura del panel en teléfonos pequeños con el tamaño de letra del sistema al máximo y el tema oscuro activado', body: 'En un teléfono de 360 píxeles de ancho con la letra del sistema al máximo, varias filas se desbordan. Adjunto una captura, la grabación, una nota de voz, el documento con el detalle y el caso en GitHub.', created_at: ago(12), fields: { summary: 'La fila de mensajes se desborda con la letra del sistema al máximo.', device: 'Teléfono de 360 píxeles de ancho con Android' }, assignee_ids: everyone.filter((x) => x !== 'u-carla'), attachment_ids: [imgDashboard, videoDemo, audioNota, docFeedback, linkIssue] }, [
  { author_id: 'u-maria', kind: 'clarification', body: 'Cuando dices tamaño máximo, ¿hablas del ajuste de accesibilidad de Android o del zoom del navegador? Cambia dónde se arregla.', created_at: ago(8), attachment_ids: [imgLogin, audioNota] },
  { author_id: 'u-ana', kind: 'answer', body: 'Del ajuste de Android. Dejo la grabación del caso.', created_at: ago(5), attachment_ids: [videoDemo, docFeedback, linkIssue] },
])
seedMessage({ area_id: 'a-error', author_id: 'u-diego', title: 'Grabación del cierre de sesión que no borra la sesión anterior', body: 'Se ve en el video: después de cerrar sesión, al volver atrás el panel muestra los mensajes.', created_at: ago(20), assignee_ids: ['u-ana', 'u-maria'], attachment_ids: [videoDemo] }, [
  { author_id: 'u-ana', kind: 'fix', body: 'Corregido: al cerrar sesión se vacía la caché de consultas.', created_at: ago(15), attachment_ids: [linkIssue] },
])
seedMessage({ area_id: 'a-idea', author_id: 'u-bruno', title: 'Nota de voz con la idea del resumen semanal', body: 'La dejé hablada porque es más rápido.', created_at: ago(40), assignee_ids: ['u-ana'], attachment_ids: [audioNota] })
seedMessage({ area_id: 'a-pregunta', author_id: 'u-diego', title: 'Enlace al caso del cliente', body: 'El cliente lo escribió en su sistema.', created_at: ago(45), assignee_ids: ['u-ana'], attachment_ids: [linkIssue] })

// Messages with the long content that used to push a phone screen sideways (code block, long paths and URLs, unbroken words), only with
// PANEL_DEV_OVERFLOW=1 so the other tests keep the data they count on. Development sample data, like the rest of the file.
if (process.env.PANEL_DEV_OVERFLOW === '1') {
  const longUrl = 'https://github.com/example/team-platform/blob/main/packages/client/src/generated/openapi/schemas/messages/list-messages-response.ts?plain=1&ref=feature%2Fa-very-long-branch-name-without-any-break'
  const longPath = '/home/usuario/proyectos/team-platform/.claude/worktrees/sin-desborde-movil/panel/src/components/MessageDetailAttachmentGalleryWithAnExtremelyLongName.tsx'
  const code = '```json\n{"message_id":"4f1c2a9e-0b7d-4c1e-9a53-2f6d8e7a1b34","path":"' + longPath + '","reply":{"kind":"answer","text":"' + 'x'.repeat(120) + '"}}\n```'
  const long = seedAttachment('link', 'text/uri-list', longUrl, Buffer.from(longUrl))
  seedMessage({ area_id: 'a-error', author_id: 'u-carla', title: 'Hilo largo con bloque de código y rutas largas ' + longPath, body: 'Ruta: ' + longPath + '\n\nURL: ' + longUrl + '\n\n' + code, created_at: ago(1), assignee_ids: ['u-ana'], attachment_ids: [long, linkIssue] }, [
    { author_id: 'u-ana', kind: 'answer', body: 'Respuesta de Claude:\n\n' + code + '\n\nArchivos: ' + longPath + ' y ' + longUrl + '\n\n' + 'Palabra'.repeat(40), created_at: ago(0.5), attachment_ids: [long] },
  ])
}

// Messages that show every kind of gallery, only with PANEL_DEV_MEDIA=1 so the other tests keep the data they count on.
// Everything here is development sample data, like the rest of the file.
if (process.env.PANEL_DEV_MEDIA === '1') {
  const photos = ['Pantalla de inicio', 'Lista de mensajes', 'Detalle', 'Bandeja de envíos', 'Equipo', 'Áreas'].map((title, i) => seedAttachment('image', 'image/svg+xml', `foto-${i + 1}.svg`, svgCapture(title, 30 + i * 50)))
  const pdf = seedAttachment('document', 'application/pdf', 'informe-del-cliente.pdf', Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'))
  const voice = seedAttachment('audio', 'audio/wav', 'nota-con-texto.wav', silentWav(8))
  attachments.get(voice).transcript = 'Primero, el botón Enviar no se distingue en el tema oscuro. Segundo, la lista tarda en abrir cuando hay muchos mensajes.'
  const broken = seedAttachment('image', 'image/png', 'foto-dañada.png', Buffer.from('no es una imagen'))
  seedMessage({ area_id: 'a-error', author_id: 'u-carla', title: 'Galería de seis fotos', body: 'Seis capturas de la misma pantalla.', created_at: ago(2), assignee_ids: ['u-ana'], attachment_ids: photos })
  seedMessage({ area_id: 'a-error', author_id: 'u-carla', title: 'Fotos mezcladas con un video', body: 'Tres capturas y la grabación.', created_at: ago(3), assignee_ids: ['u-ana'], attachment_ids: [photos[0], videoDemo, photos[1], photos[2]] })
  seedMessage({ area_id: 'a-idea', author_id: 'u-bruno', title: 'Nota de voz con su transcripción', body: 'La nota dicha en voz alta.', created_at: ago(4), assignee_ids: ['u-ana'], attachment_ids: [voice] })
  seedMessage({ area_id: 'a-pregunta', author_id: 'u-diego', title: 'Informe en PDF y una foto dañada', body: 'El informe del cliente y una foto que no abre.', created_at: ago(5), assignee_ids: ['u-ana'], attachment_ids: [pdf, broken, linkIssue] })
  const manual = seedAttachment('document', 'application/pdf', 'Subir fotos clínicas desde el teléfono.pdf', Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'))
  seedMessage({ area_id: 'a-pregunta', author_id: 'u-diego', title: 'Manual en PDF en la respuesta final', body: 'Cómo subir fotos clínicas desde el teléfono.', created_at: ago(7), assignee_ids: ['u-ana'], attachment_ids: [manual] }, [
    { author_id: 'u-ana', kind: 'answer', body: 'Dejo el manual en PDF y la pantalla.', created_at: ago(1), attachment_ids: [manual, photos[0]] },
  ])
  // As in production (messages 117 and 123): real PNGs named `image.png`, and the microphone recording, an `audio/webm` that has no duration in its header.
  const pasted = [0, 1, 2, 3, 4, 5].map((i) => seedAttachment('image', 'image/png', 'image.png', pngCapture(320 + i * 40, 200 + i * 20, 20 + i * 40)))
  const recording = seedAttachment('audio', 'audio/webm', 'grabacion-1332.webm', readFileSync(new URL('./dev-fixtures/sample-voice.webm', import.meta.url)))
  seedMessage({ area_id: 'a-error', author_id: 'u-carla', title: 'Tres capturas pegadas', body: 'Tres capturas en PNG, como las pega una persona.', created_at: ago(8), assignee_ids: ['u-ana'], attachment_ids: pasted.slice(0, 3) })
  seedMessage({ area_id: 'a-error', author_id: 'u-carla', title: 'Cinco capturas y una grabación de voz', body: 'Cinco capturas y la grabación del micrófono.', created_at: ago(9), assignee_ids: ['u-ana'], attachment_ids: [...pasted.slice(0, 5), recording] })
  seedMessage({ area_id: 'a-error', author_id: 'u-carla', title: 'Seis capturas pegadas', body: 'Seis capturas en PNG, como las pega una persona.', created_at: ago(10), assignee_ids: ['u-ana'], attachment_ids: pasted })
  // A long thread whose last reply carries a pasted capture (message 117 in production): at phone width that picture is far below the first screen.
  const filler = Array.from({ length: 12 }, (_, i) => ({ author_id: i % 2 ? 'u-ana' : 'u-diego', kind: 'answer', body: `Respuesta ${i + 1}. ${'Texto de relleno para alargar el hilo y que lo último quede lejos de la primera pantalla. '.repeat(3)}`, created_at: ago(40 - i), attachment_ids: [] }))
  seedMessage({ area_id: 'a-error', author_id: 'u-carla', title: 'Hilo largo con una captura al final', body: 'Muchas respuestas y una captura pegada en la última.', created_at: ago(41), assignee_ids: ['u-ana'], attachment_ids: [], }, [...filler, { author_id: 'u-ana', kind: 'answer', body: 'La captura de lo que se ve.', created_at: ago(1), attachment_ids: [pasted[2]] }])
  seedMessage({ area_id: 'a-error', author_id: 'u-diego', title: 'Una sola foto', body: 'Un solo medio no lleva carrusel.', created_at: ago(6), assignee_ids: ['u-ana'], attachment_ids: [photos[3]] })
}

/** Fields a template declares in its frontmatter: `- { name: x, label: Y, required: true }`. */
function templateFields(t) {
  return [...(t?.body_markdown ?? '').matchAll(/^\s*-\s*\{\s*name:\s*(\w+),\s*label:\s*([^,}]+),\s*required:\s*(true|false)/gm)].map((m) => ({ name: m[1], label: m[2].trim(), required: m[3] === 'true' }))
}
const activeTemplate = (areaId, templateId) => templates.find((t) => t.id === templateId && t.area_id === areaId && !t.deleted_at) ?? templates.find((t) => t.area_id === areaId && !t.deleted_at)

/** What the real server would reject on publish: fields from another template or empty required fields. */
function proposalProblem(proposal, input) {
  for (const [i, pm] of proposal.messages.entries()) {
    const n = i + 1
    if (!areas.some((a) => a.id === pm.area_id)) return `Mensaje ${n}: el área no existe.`
    if (!String(pm.title ?? '').trim() || !String(pm.body ?? '').trim()) return `Mensaje ${n}: falta el título o el texto.`
    const tpl = activeTemplate(pm.area_id, pm.template_id)
    const fields = tpl ? templateFields(tpl) : []
    const values = pm.fields ?? {}
    const missing = fields.filter((f) => f.required && !String(values[f.name] ?? '').trim()).map((f) => `falta el campo «${f.name}»`)
    const extra = Object.keys(values).filter((k) => !fields.some((f) => f.name === k)).map((k) => `el campo «${k}» no existe en la plantilla`)
    if (missing.length || extra.length) return `Mensaje ${n}: ${[...missing, ...extra].join('; ')}.`
    if (!(pm.assignee_ids ?? []).every((x) => members.some((mm) => mm.id === x))) return `Mensaje ${n}: un destinatario no existe.`
    if (!(pm.attachment_ids ?? []).every((x) => input.attachment_ids.includes(x))) return `Mensaje ${n}: un adjunto no es de este input.`
  }
  // Unit coverage: each one exactly once, in one message or among the discarded ones (HP-014).
  const owners = new Map()
  for (const [i, pm] of proposal.messages.entries()) for (const u of pm.unit_ids ?? []) owners.set(u, [...(owners.get(u) ?? []), `mensaje ${i + 1}`])
  for (const d of proposal.discarded ?? []) for (const u of d.unit_ids ?? []) owners.set(u, [...(owners.get(u) ?? []), 'descartados'])
  const known = new Set(input.units.map((u) => u.id))
  for (const u of owners.keys()) if (!known.has(u)) return { code: 'unit_invalid', message: `La unidad ${u} no existe en el input.` }
  for (const [u, who] of owners) if (who.length > 1) return { code: 'units_overlap', message: `La unidad ${u} está en más de un lugar (${who.join(' y ')}).` }
  const gaps = [...known].filter((u) => !owners.has(u))
  if (gaps.length) return { code: 'units_uncovered', message: `Las unidades ${gaps.join(', ')} no están en ningún mensaje ni entre los descartados.` }
  return null
}

// ---------------------------------------------------------------- session state, events and jobs

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

const SPOKEN_SAMPLE = 'Hola, te dejo este audio. Primero, la lista de pacientes tarda en abrir cuando hay muchos. Segundo, el botón Agendar sigue diciendo Reservar. Tercero, quiero que lo revises hoy y me digas qué recomiendas, porque mañana se lo muestro a la clínica.'

function replyView(r) {
  const { attachment_ids, ...rest } = r
  const files = (attachment_ids ?? []).map(attachmentView).filter(Boolean)
  return { version: 1, edited_at: null, mentions: [], ...rest, attachments: files, attachment_kinds: [...new Set(files.map((f) => f.kind))] }
}

function view(msg) {
  const rs = liveReplies(msg)
  const { attachment_ids, ...rest } = msg
  return {
    ...rest,
    template_id: msg.template_id ?? templates.find((t) => t.area_id === msg.area_id)?.id ?? null,
    fields: msg.fields ?? {},
    updated_at: msg.updated_at ?? msg.created_at,
    version: msg.version ?? 1,
    edited_at: msg.edited_at ?? null,
    edits: msg.edits ?? [],
    attachments: attachment_ids.map(attachmentView).filter(Boolean),
    attachment_kinds: [...new Set(attachment_ids.map(attachmentView).filter(Boolean).map((f) => f.kind))],
    reply_count: rs.length,
    last_reply: rs.length ? replyView(rs[rs.length - 1]) : null,
  }
}

function attachmentView(attId) {
  const a = attachments.get(attId)
  return a ? { id: a.id, input_id: a.input_id, kind: a.kind, mime: a.mime, size: a.size, name: a.name, extracted: a.transcript !== undefined } : null
}

function inputView(input) {
  const { content_hash, attachment_ids, ...rest } = input
  void content_hash
  const published = input.status === 'published' ? (input.message_ids ?? []).map((mid) => messages.find((x) => x.id === mid)).filter(Boolean) : []
  return {
    ...rest,
    updated_at: input.updated_at ?? input.created_at,
    proposed_count: input.proposal?.messages.length ?? 0,
    attachments: attachment_ids.map(attachmentView).filter(Boolean),
    ...(input.status === 'published' ? { message_ids: published.map((x) => x.id), messages: published.map((x) => ({ id: x.id, title: x.title, area_id: x.area_id, status: x.status, edited_at: x.edited_at ?? null })) } : {}),
  }
}

/** Auto-publication (UD-070): on by default; `PANEL_DEV_AUTO_PUBLISH=0` starts with it off, as the Editor can turn it off in Configuración. */
let autoPublish = process.env.PANEL_DEV_AUTO_PUBLISH !== '0'

/** Creates the messages of a proposal and marks the input published. The one place that inserts messages, as in the real server. */
function publishProposal(input, proposal) {
  const created = []
  for (const pm of proposal.messages) {
    const tpl = activeTemplate(pm.area_id, pm.template_id)
    const msg = seedMessage({ input_id: input.id, area_id: pm.area_id, template_id: tpl?.id ?? null, fields: pm.fields ?? {}, author_id: input.author_id, sent_by_id: input.sent_by_id ?? null, title: pm.title.trim(), body: pm.body.trim(), status: 'open', created_at: new Date().toISOString(), assignee_ids: pm.assignee_ids ?? [], attachment_ids: pm.attachment_ids ?? [] })
    created.push(msg.id)
    // An agent among the assignees gets its `execute` job when the message is published (UD-254).
    for (const to of msg.assignee_ids) if (members.find((x) => x.id === to)?.kind === 'agent') executeJobs.set(msg.id, { id: `j-${id()}`, message_id: msg.id, member_id: to, created_at: msg.created_at })
    for (const to of msg.assignee_ids) if (to !== input.author_id) emit(to, 'message', { message_id: msg.id, title: msg.title, author_id: input.author_id, at: msg.created_at })
  }
  input.status = 'published'
  input.updated_at = new Date().toISOString()
  input.message_ids = created
  return created
}

/** The `execute` job an agent assignee got for a published message, by message id. */
const executeJobs = new Map()

/** How many jobs were started, to stagger the ones that follow. */
let running = 0

/**
 * Who advances the analysis. «auto»: a timer, as a real queue would. «held»: nobody, until a test gives the order
 * (`/_control/step`, `/_control/release`), so «being analyzed» is a state the test holds and not a race against a clock (H-901).
 */
let held = false
/** Next step of every job that waits for an order, by job id. */
const waiting = new Map()

function schedule(input, tick, delay) {
  if (held) {
    waiting.set(input.job_id, tick)
    return
  }
  jobs.set(input.job_id, setTimeout(tick, delay))
}

function runJob(input) {
  const total = input.attachment_ids.length + 2
  const steps = [
    ...input.attachment_ids.map((aid, i) => ({ status: 'extracting', phrase: `Lectura de adjunto ${i + 1} de ${input.attachment_ids.length}` })),
    { status: 'analyzing', phrase: 'Clasificando el área' },
    { status: 'analyzing', phrase: 'Descomponiendo en mensajes' },
  ]
  let done = 0
  const tick = () => {
    waiting.delete(input.job_id)
    if (input.status === 'cancelled') return
    if (done === total) {
      input.proposal = analyze(input)
      input.status = 'proposed'
      input.updated_at = new Date().toISOString()
      const problem = autoPublish ? proposalProblem(input.proposal, input) : 'auto_publish_off'
      if (autoPublish && !problem) {
        const message_ids = publishProposal(input, input.proposal)
        emit(input.author_id, 'progress', { job_id: input.job_id, input_id: input.id, percent: 100, phrase: 'Publicado', at: new Date().toISOString() })
        emit(input.author_id, 'done', { job_id: input.job_id, input_id: input.id, done: true, status: 'done', input_status: 'published', message_ids })
        return
      }
      if (autoPublish) {
        input.error = typeof problem === 'string' ? problem : problem.message
        input.error_code = 'publish_blocked'
      }
      emit(input.author_id, 'done', { job_id: input.job_id, input_id: input.id, done: true, status: 'done', input_status: 'proposed', message_ids: [] })
      return
    }
    if (input.text.includes('[simular falla]') && done === steps.length - 1) {
      input.status = 'failed'
      input.updated_at = new Date().toISOString()
      input.error = 'El proveedor de modelo no respondió.'
      input.error_code = 'analysis_failed'
      emit(input.author_id, 'done', { job_id: input.job_id, input_id: input.id, done: true })
      return
    }
    const step = steps[done]
    input.status = step.status
    emit(input.author_id, 'progress', { job_id: input.job_id, input_id: input.id, percent: Math.round((done / total) * 100), phrase: step.phrase, at: new Date().toISOString() })
    done += 1
    schedule(input, tick, STEP_MS)
  }
  // Inputs sent one after another finish at staggered times, as with a queue that runs several at once.
  const lag = (running % 10) * Math.round(STEP_MS / 2)
  running += 1
  schedule(input, tick, STEP_MS + lag)
}

/** Numbered units of the input: one paragraph each. The server numbers them, as the real system will. */
function unitsOf(text) {
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p, i) => ({ id: i + 1, text: p }))
}

// The development «analysis» is a double: it picks the area by keywords and writes a title and a body that look like what a
// model would return (the title summarizes, the body adds what is missing). It does not read the meaning of the text.
const AREA_HINTS = [
  [/error|falla|no funciona|desalinead|roto|rota|bug|se cae|lento|cortad/i, 'a-error'],
  [/¿|\?\s*$|^pregunta/i, 'a-pregunta'],
  [/agregar|nueva|sincroniz|pedido|exportar|soporte para/i, 'a-feature'],
  [/idea|podr[ií]amos|ser[ií]a bueno|probar/i, 'a-idea'],
]
/** What the double writes under every message it proposes: it does not read the text, and it says so. */
const SIMULATED_NOTE = 'Propuesta simulada por el servidor de ejemplo: no es el análisis real y su área es la primera del catálogo, no una clasificación.'
const FIELD_SAMPLES = {
  summary: 'Punto detectado en el texto enviado; el detalle está en el cuerpo del mensaje.',
  steps: 'Abrir la pantalla indicada y repetir la acción descrita.',
  expected: 'La pantalla se muestra completa y alineada.',
  actual: 'La pantalla se ve desalineada o cortada.',
}
function titleOf(text) {
  const sentence = text.split(/(?<=[.?!])\s/)[0].replace(/[.?!]+$/, '').trim()
  if (sentence.length <= 64) return sentence
  return sentence.slice(0, 64).replace(/\s+\S*$/, '')
}

/** Development «analysis»: one message per unit, its area by keywords; the units past the third are left without action. */
function analyze(input) {
  const others = members.filter((m) => m.id !== input.author_id && m.active)
  const images = input.attachment_ids.filter((aid) => attachments.get(aid)?.kind === 'image')
  const units = input.units.length ? input.units : [{ id: 1, text: 'Sin texto' }]
  const keep = units.length > 3 ? units.slice(0, 3) : units
  const rest = units.slice(keep.length)
  return {
    messages: keep.map((u, i) => {
      // Without a keyword the area is the first of the catalog, and the proposal says it is simulated: no pretended classification.
      const areaId = AREA_HINTS.find(([pattern]) => pattern.test(u.text))?.[1] ?? areas[0].id
      const template = activeTemplate(areaId, null)
      return {
        area_id: areaId,
        template_id: template?.id ?? null,
        title: titleOf(u.text),
        body: `${u.text}\n\n${SIMULATED_NOTE}`,
        fields: Object.fromEntries(templateFields(template).map((f) => [f.name, f.required ? (FIELD_SAMPLES[f.name] ?? '') : ''])),
        // UD-291: the recipients the sender chose are the assignees; the routing keeps choosing area and template.
        assignee_ids: input.recipient_ids?.length ? [...input.recipient_ids] : [others[i % others.length].id],
        attachment_ids: i === 0 ? input.attachment_ids : images,
        unit_ids: [u.id],
      }
    }),
    discarded: rest.length ? [{ unit_ids: rest.map((u) => u.id), reason: 'Sin acción para el equipo' }] : [],
    simulated: true,
  }
}

// ---------------------------------------------------------------- HTTP utilities

function send(res, status, body, headers = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers })
  res.end(payload)
}

/** API error body: `{ code, message }`; the panel translates the code to its catalog. */
const CODE_BY_STATUS = { 400: 'bad_request', 401: 'unauthenticated', 403: 'forbidden', 404: 'not_found', 409: 'conflict', 422: 'validation', 500: 'internal' }
const fail = (res, status, message, code = CODE_BY_STATUS[status] ?? 'bad_request') => send(res, status, { code, message })

/** List with the API envelope: `{ items, page, limit, total }`. */
const envelope = (items) => ({ items, page: 1, limit: 100, total: items.length })

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error('Body too large'))
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

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.map': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.webp': 'image/webp' }

const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"

function serveStatic(req, res, pathname) {
  if (THEME_CSS && pathname === '/theme.css') {
    res.writeHead(200, { 'Content-Type': MIME['.css'], 'Cache-Control': 'no-cache' })
    return res.end(readFileSync(THEME_CSS))
  }
  if (THEME_CSS && pathname.startsWith('/theme/')) {
    const name = pathname.slice('/theme/'.length)
    if (!/^[\w.-]+\.(woff2|woff|ttf|png|svg|webp)$/.test(name)) return fail(res, 404, 'No existe')
    const themeFile = join(dirname(THEME_CSS), name)
    if (!existsSync(themeFile)) return fail(res, 404, 'No existe')
    res.writeHead(200, { 'Content-Type': MIME[extname(themeFile)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' })
    return createReadStream(themeFile).pipe(res)
  }
  let file = normalize(join(DIST, pathname === '/' ? 'index.html' : pathname))
  if (!file.startsWith(DIST)) return fail(res, 403, 'Ruta no permitida')
  const isAsset = pathname.startsWith('/assets/')
  if (!existsSync(file) || statSync(file).isDirectory()) {
    if (isAsset) return fail(res, 404, 'No existe')
    file = join(DIST, 'index.html')
  }
  if (file === join(DIST, 'index.html')) {
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Content-Security-Policy': CSP, 'Cache-Control': 'no-cache' })
    return res.end(mountedIndex(readFileSync(file, 'utf8'), { basePath: BASE, apiPrefix: `${BASE}api`, themeCss: THEME_CSS }))
  }
  const headers = {
    'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
    'Content-Security-Policy': CSP,
    'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
  }
  res.writeHead(200, headers)
  createReadStream(file).pipe(res)
}

// ---------------------------------------------------------------- interface telemetry (UD-091)
// The same contract as the real server: the shape comes from src/telemetry/ui-spec.js, the events become spans through
// `recordUiBatch` (here into an in-memory `spans` table made by the real migration) and the summary is `uiSummary`.
// The body cap and the rate limit of the real route are not copied: this server has no one to protect.

const uiConfig = loadConfig({ DATA_DIR: '/tmp/dev-server-unused' })
const uiState = { enabled: uiConfig.uiTelemetry.enabledDefault }
const uiDb = new DatabaseSync(':memory:')
uiDb.exec(readFileSync(fileURLToPath(new URL('../src/telemetry/migration.sql', import.meta.url)), 'utf8'))
const uiValidate = new Ajv({ strict: true, coerceTypes: false }).compile(
  batchSchema({ maxEvents: uiConfig.uiTelemetry.maxEvents, maxDurationMs: uiConfig.identity.session.absoluteHours * 3_600_000 }),
)
const uiInsert = uiDb.prepare(`INSERT INTO spans (trace_id, span_id, parent_id, name, kind, start_ns, end_ns, status, status_message, attributes_json, events_json)
  VALUES (?, ?, NULL, ?, 'INTERNAL', ?, ?, ?, NULL, ?, '[]')`)
const uiTracer = {
  startSpan(name, { startTime, attributes }) {
    const attrs = { ...attributes }
    let status = 'unset'
    return {
      setAttribute: (k, v) => { attrs[k] = v },
      setStatus: ({ code }) => { status = code === 2 ? 'error' : 'ok' },
      end(endMs) { uiInsert.run(randomUUID().replaceAll('-', ''), randomUUID().replaceAll('-', '').slice(0, 16), name, BigInt(Math.round(startTime)) * 1_000_000n, BigInt(Math.round(endMs)) * 1_000_000n, status, JSON.stringify(attrs)) },
    }
  },
}

// ---------------------------------------------------------------- routes

// ---------------------------------------------------------------- control for tests (H-901)


// ---------------------------------------------------------------- queue, traces and log (UD-251)
// The real server keeps jobs, spans and an audit log; the double derives the jobs of the sends and adds a few older ones.
const JOB_STATE_OF = { queued: 'queued', extracting: 'running', analyzing: 'running', proposed: 'done', published: 'done', failed: 'failed', cancelled: 'cancelled' }
/** @type {{id:string, input_id:string|null, status:string, attempts:number, created_at:string, finished_at:string|null, last_error:string|null, started_ms:number}[]} */
let olderJobs = []
/** The seeded execution of `/_control/execution` (UD-262), or null. */
let execution = null
/** The timing of the messages `/_control/agent-work` seeds, by message id (B7). */
const workTimings = new Map()
/** UD-275: the reviews held for a person, by message id: `{ branch, held_reason, job_id, agent_id, delivering_job_id }`. */
const reviews = new Map()
const purgedJobs = new Set()
/** @type {{id:string, at:string, member_id:string|null, member_name:string|null, action:string, entity:string, entity_id:string|null, detail:object|null}[]} */
const auditLog = []

function seedOps() {
  olderJobs = [
    { id: 'j-old01', input_id: null, status: 'done', attempts: 1, created_at: ago(2900), finished_at: ago(2897), last_error: null },
    { id: 'j-old02', input_id: null, status: 'done', attempts: 1, created_at: ago(2400), finished_at: ago(2398), last_error: null },
    { id: 'j-old03', input_id: null, status: 'failed', attempts: 3, created_at: ago(1900), finished_at: ago(1895), last_error: 'El proveedor de modelo no respondió.' },
    { id: 'j-old04', input_id: null, status: 'done', attempts: 2, created_at: ago(1500), finished_at: ago(1496), last_error: null },
    { id: 'j-old05', input_id: null, status: 'cancelled', attempts: 1, created_at: ago(900), finished_at: ago(899), last_error: null },
  ]
  purgedJobs.clear()
}
function record(member, action, entity, entityId, detail) {
  auditLog.unshift({ id: `a-${id()}`, at: new Date().toISOString(), member_id: member?.id ?? null, member_name: member?.name ?? null, action, entity, entity_id: entityId ?? null, detail: detail ?? null })
}
function seedAudit() {
auditLog.length = 0
for (const [minutes, who, action, entity, entityId, detail] of [
  [4300, 'u-ana', 'settings.publication', 'settings', null, { auto_publish: true }],
  [3900, 'u-ana', 'area.create', 'area', 'a-pregunta', null],
  [3100, 'u-diego', 'input.create', 'input', 'i-seed01', null],
  [3000, 'u-diego', 'input.publish', 'input', 'i-seed01', null],
  [1800, 'u-ana', 'member.update', 'member', 'u-carla', { fields: ['name'] }],
  [700, 'u-ana', 'settings.telemetry', 'settings', null, { ui_enabled: true }],
]) {
  const who_ = members.find((m) => m.id === who)
  auditLog.push({ id: `a-${id()}`, at: ago(minutes), member_id: who_.id, member_name: who_.name, action, entity, entity_id: entityId, detail })
}
auditLog.sort((a, b) => b.at.localeCompare(a.at))
}
seedOps()
seedAudit()

function allJobs() {
  const own = [...inputs.values()].filter((i) => i.job_id).map((i) => ({ id: i.job_id, input_id: i.id, status: JOB_STATE_OF[i.status] ?? 'queued', attempts: i.status === 'failed' ? 3 : 1, created_at: i.created_at, finished_at: ['proposed', 'published', 'failed', 'cancelled'].includes(i.status) ? (i.updated_at ?? i.created_at) : null, last_error: i.status === 'failed' ? i.error : null }))
  // UD-263: with `deliver` the message running now is in its delivery, a job of its own with its own phase.
  const exec = execution ? [{ id: 'j-exec1', kind: execution.deliver ? 'deliver' : 'execute', input_id: null, message_id: execution.liveId, phase: execution.deliver ? 'deliverDeploy' : 'run', status: 'running', attempts: 1, created_at: ago(1), run_at: ago(1), finished_at: null, last_error: null }] : []
  const agentRuns = [...executeJobs.values()].map((j) => ({ id: j.id, kind: 'execute', input_id: null, message_id: j.message_id, phase: 'run', status: 'running', attempts: 1, created_at: j.created_at, run_at: j.created_at, finished_at: null, last_error: null }))
  return [...exec, ...agentRuns, ...own, ...olderJobs].filter((j) => !purgedJobs.has(j.id)).sort((a, b) => b.created_at.localeCompare(a.created_at))
}
const jobRowOf = (j) => ({ id: j.id, kind: j.kind ?? 'analyze_input', message_id: j.message_id ?? null, phase: j.phase ?? null, input_id: j.input_id, status: j.status, priority: 0, attempts: j.attempts, max_attempts: 3, run_at: j.run_at ?? j.created_at, lease_until: null, worker_id: j.status === 'running' ? 'w-1' : null, last_error: j.last_error, created_at: j.created_at, finished_at: j.finished_at })

/** A span tree for a finished job, deterministic from its id: the analysis with one call per step. */
function traceOf(job) {
  if (!['done', 'failed'].includes(job.status)) return null
  const seed = [...job.id].reduce((n, c) => n + c.charCodeAt(0), 0)
  const node = (name, kind, ms, attributes, children = [], status = 'ok') => ({ trace_id: `t-${job.id}`, span_id: `s-${name}`, parent_id: null, name, kind, status, status_message: null, start_ns: '0', end_ns: '0', start_ms: 0, duration_ms: ms, attributes, events: [], children })
  const call = (name, ms, inTok, outTok, cost) => node(name, 'client', ms, { 'gen_ai.usage.input_tokens': inTok, 'gen_ai.usage.output_tokens': outTok, 'team.cost_usd': cost })
  const classify = call('llm.classify_area', 900 + (seed % 400), 1800 + (seed % 300), 60, 0.0042)
  const split = job.status === 'failed' ? node('llm.split_messages', 'client', 30_000, {}, [], 'error') : call('llm.split_messages', 2400 + (seed % 900), 2600 + (seed % 500), 420, 0.0121)
  const calls = [classify, split]
  const root = node('job.analyze', 'internal', calls.reduce((n, c) => n + c.duration_ms, 0) + 240, { 'team.job_id': job.id }, [node('extract.attachments', 'internal', 180 + (seed % 90), {}), ...calls], job.status === 'failed' ? 'error' : 'ok')
  const ok = calls.filter((c) => c.status === 'ok')
  return {
    job_id: job.id, trace_ids: [`t-${job.id}`], span_count: 3 + calls.length,
    totals: { llm_calls: ok.length, input_tokens: ok.reduce((n, c) => n + c.attributes['gen_ai.usage.input_tokens'], 0), output_tokens: ok.reduce((n, c) => n + c.attributes['gen_ai.usage.output_tokens'], 0), cost_usd: ok.reduce((n, c) => n + c.attributes['team.cost_usd'], 0) },
    roots: [root],
  }
}

const copyOf = (v) => structuredClone(v)
/** The sample state as it was born: the order «reset» goes back to. */
const initial = CONTROL
  ? { members: copyOf(members), areas: copyOf(areas), templates: copyOf(templates), project: copyOf(project), providers: copyOf(providers), attachments: copyOf(attachments), messages: copyOf(messages), replies: copyOf(replies) }
  : null

const restoreArray = (target, source) => target.splice(0, target.length, ...copyOf(source))
const restoreMap = (target, source) => {
  target.clear()
  for (const [k, v] of copyOf(source)) target.set(k, v)
}

/** Every job that waits for an order moves one step, or the ones of one input all the way to the end when `finish` is given. */
function stepJobs(inputId, finish) {
  for (let guard = 0; guard < 64; guard++) {
    const due = [...waiting].filter(([jobId]) => !inputId || inputs.get(inputId)?.job_id === jobId)
    if (!due.length) return
    for (const [, tick] of due) tick()
    if (!finish) return
  }
}

function control(path, query) {
  if (path === '/_control/hold') {
    held = true
    return {}
  }
  if (path === '/_control/release') {
    held = false
    for (const [jobId, tick] of [...waiting]) {
      waiting.delete(jobId)
      jobs.set(jobId, setTimeout(tick, 0))
    }
    return {}
  }
  if (path === '/_control/step') {
    stepJobs(query.get('input_id'), query.get('finish') === '1')
    return {}
  }
  if (path === '/_control/execution') {
    // UD-262: an agent member, a message it worked (with its timing) and another one running now.
    if (!members.some((m) => m.id === 'u-claude')) members.push({ id: 'u-claude', email: 'claude@dev.invalid', name: 'Claude', role: 'member', kind: 'agent', language: 'es-419', active: true, profile: 'Sesión desatendida que trabaja los mensajes asignados.' })
    const done = seedMessage({ area_id: 'a-error', author_id: 'u-carla', title: 'Cambiar el texto del botón de reservas', body: 'El botón dice Reservar y debe decir Agendar.', created_at: ago(50), assignee_ids: ['u-claude'], attachment_ids: [] })
    const live = seedMessage({ area_id: 'a-error', author_id: 'u-carla', title: 'Ajustar el espacio de la tabla de pacientes', body: 'Las filas quedan pegadas.', created_at: ago(5), assignee_ids: ['u-claude'], attachment_ids: [] })
    execution = { doneId: done.id, liveId: live.id, deliver: query.get('deliver') === '1' }
    return { done_id: done.id, live_id: live.id }
  }
  if (path === '/_control/agent-work') {
    // B7: one message per state of the work of an agent in the sheet: waiting, creating the machine, in the session, failed session (the retry runs the work again), failed delivery (the retry only publishes).
    if (!members.some((m) => m.id === 'u-claude')) members.push({ id: 'u-claude', email: 'claude@dev.invalid', name: 'Claude', role: 'member', kind: 'agent', language: 'es-419', active: true, profile: 'Sesión desatendida que trabaja los mensajes asignados.' })
    const phase = (name, duration_ms, status = 'unset') => ({ name, duration_ms, offset_ms: null, status })
    const timing = (message_id, over) => ({ message_id, machine: true, delivers: true, job_id: `j-work-${message_id}`, job_status: 'running', trace_id: null, phase: null, attempts: 1, elapsed_ms: null, first_reply_ms: null, final_reply_ms: null, first_reply_since_message_ms: null, final_reply_since_message_ms: null, total_ms: null, queue_wait_ms: null, phases: [], slowest: [], turns: [], tree: null, ...over })
    const failure = (action) => [{ author_id: 'u-claude', kind: 'answer', created_at: ago(2), body: action === 'publish' ? 'Claude no pudo entregar el cambio: se acabó el tiempo.' : 'Claude no pudo responder: se acabó el tiempo.', retryable: true, retry_action: action, replaced_by_job_id: null, retrying: false }]
    const make = (title, over, rs = []) => {
      const msg = seedMessage({ area_id: 'a-error', author_id: 'u-carla', title, body: `${title}: mensaje que trabaja Claude.`, created_at: ago(30), assignee_ids: ['u-claude'], attachment_ids: [] }, rs)
      workTimings.set(msg.id, timing(msg.id, over))
      return msg.id
    }
    return {
      queued: make('Trabajo en cola', { job_status: 'queued' }),
      machine: make('Trabajo creando la máquina', { phase: 'create', elapsed_ms: 38_000 }),
      session: make('Trabajo en la sesión', { phase: 'run', elapsed_ms: 212_000, phases: [phase('create', 95_000)] }),
      failed_session: make('Trabajo con la sesión fallida', { job_status: 'failed', phases: [phase('create', 95_000), phase('run', 300_000, 'error')] }, failure('work')),
      failed_delivery: make('Trabajo con la entrega fallida', { job_status: 'done', phases: [phase('create', 95_000), phase('run', 210_000), phase('destroy', 8_000), phase('deliver', 42_000, 'error')], deliver: { job_id: 'j-work-deliver', job_status: 'failed', phase: null, attempts: 1 } }, failure('publish')),
    }
  }
  if (path === '/_control/review') {
    // UD-275: a message whose delivery is held: Claude's reply with the «Propuesta» screenshots and the review block waiting for a person.
    if (!members.some((m) => m.id === 'u-claude')) members.push({ id: 'u-claude', email: 'claude@dev.invalid', name: 'Claude', role: 'member', kind: 'agent', language: 'es-419', active: true, profile: 'Sesión desatendida que trabaja los mensajes asignados.' })
    const shot = (n, label, hue) => seedAttachment('image', 'image/svg+xml', `Propuesta - ${n} · ${label}.svg`, svgCapture(label, hue))
    const msg = seedMessage({ area_id: 'a-feature', author_id: 'u-carla', title: 'Subir fotos clínicas a la ficha', body: 'Quiero subir fotos del paciente desde el teléfono a su ficha.', created_at: ago(60), assignee_ids: ['u-ana'], attachment_ids: [] }, [
      { author_id: 'u-claude', kind: 'clarification', created_at: ago(8), attachment_ids: [shot('0:02', 'Paso 1 · Abrir la ficha', 210), shot('0:05', 'Paso 2 · Apretar Tomar fotografía', 160)],
        body: 'La ficha del paciente ahora permite tomar una fotografía y guardarla en su historial. Cambia lo que ve la recepción.\n\nRiesgo: la foto queda con datos de una persona. Mirar el paso 2 antes de entregar.\n\nCambio listo para revisar: toca datos de personas. Todavía no llega a producción. Cómo queda, en «Propuesta».' }
    ])
    reviews.set(msg.id, { branch: `tp/${msg.id}`, held_reason: 'Toca datos de personas', job_id: 'j-rev0', agent_id: 'u-claude', delivering_job_id: null, state: 'held' })
    return { message_id: msg.id }
  }
  if (path === '/_control/idea-guard') {
    // UD-307: the Guard of the idea applies. Claude built and showed the idea, nothing is delivered, the thread says «Lista para ver» and the message waits for a person with its review held.
    if (!members.some((m) => m.id === 'u-claude')) members.push({ id: 'u-claude', email: 'claude@dev.invalid', name: 'Claude', role: 'member', kind: 'agent', language: 'es-419', active: true, profile: 'Sesión desatendida que trabaja los mensajes asignados.' })
    const shot = (n, label, hue) => seedAttachment('image', 'image/svg+xml', `Propuesta - ${n} · ${label}.svg`, svgCapture(label, hue))
    const msg = seedMessage({
      assessment: { expectation: 'Mostrar cómo se vería un resumen semanal por área; la decisión de publicarlo es de una persona.', guards: [], estimates: { understand_vs_create: 0.7, irreversibility: 0.3, value_holder: 'person', certainty: 0.6, reason: 'Es una posibilidad sin fecha ni acuerdo.', idea: 0.9, idea_guard: true, idea_reason: 'Quien escribe comparte una posibilidad para ver, no un cambio acordado.' }, by: null },
      area_id: 'a-idea', author_id: 'u-carla', title: 'Un resumen semanal por área en Inicio', body: 'Sería bueno ver un resumen de lo cerrado y lo abierto por área cada lunes, arriba de las listas.', created_at: ago(45), assignee_ids: ['u-ana'], attachment_ids: [],
    }, [
      { author_id: 'u-claude', kind: 'clarification', created_at: ago(9), attachment_ids: [shot('0:03', 'Resumen en Inicio', 260), shot('0:08', 'Resumen por área', 190)],
        body: 'Lista para ver. No está en producción: respóndeme en este hilo qué quieres que haga con esto.\n\nInicio ahora muestra una franja con lo cerrado y lo abierto de cada área. Se ve en «Propuesta».' },
    ])
    reviews.set(msg.id, { branch: `tp/${msg.id}`, held_reason: 'Idea para ver', job_id: 'j-idea0', agent_id: 'u-claude', delivering_job_id: null, state: 'held' })
    return { message_id: msg.id }
  }
  if (path === '/_control/handoff') {
    // UD-269: Claude could not decide. The reply is the question with its recommendation, the agent left the assignees and the person who decides in the area holds the message.
    if (!members.some((m) => m.id === 'u-claude')) members.push({ id: 'u-claude', email: 'claude@dev.invalid', name: 'Claude', role: 'member', kind: 'agent', language: 'es-419', active: true, profile: 'Sesión desatendida que trabaja los mensajes asignados.' })
    const msg = seedMessage({
      assessment: { expectation: 'Exportar los mensajes cerrados del mes; falta saber dónde se entrega el archivo.', guards: [], estimates: { understand_vs_create: 0.4, irreversibility: 0.5, value_holder: 'person', certainty: 0.5, reason: 'Falta un criterio del negocio.', idea: 0.1, idea_guard: false, idea_reason: 'Pide un cambio decidido.' }, by: null },
      area_id: 'a-feature', author_id: 'u-diego', title: 'Entregar el resumen mensual al cliente', body: 'El cliente quiere recibir cada mes el resumen de lo cerrado.', created_at: ago(70), assignee_ids: ['u-ana'], attachment_ids: [],
    }, [
      { author_id: 'u-claude', kind: 'clarification', created_at: ago(12),
        body: 'Necesito una decisión: ¿el resumen llega por correo o se descarga desde la plataforma?\n\nRecomendación: por correo, el primer día de cada mes.\n\nSi la respuesta es otra: el cliente tendría que entrar a la plataforma para verlo.' },
    ])
    return { message_id: msg.id }
  }
  if (path === '/_control/extraction') {
    // UD-071: the text read from what the message carries: the speech of an audio and of a video, and the text of a document, shown with each medium.
    const voice = seedAttachment('audio', 'audio/wav', 'nota-con-texto.wav', silentWav(8))
    attachments.get(voice).transcript = 'Primero, el botón Enviar no se distingue en el tema oscuro. Segundo, la lista tarda en abrir cuando hay muchos mensajes.'
    const video = seedAttachment('video', 'video/webm', 'recorrido-con-voz.webm', readFileSync(new URL('./dev-fixtures/sample.webm', import.meta.url)))
    attachments.get(video).transcript = SPOKEN_SAMPLE
    const pdf = seedAttachment('document', 'application/pdf', 'informe-del-cliente.pdf', Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'))
    attachments.get(pdf).transcript = 'Informe del cliente. Resumen: la lista de pacientes tarda en abrir con más de mil filas. Pedido: que abra en menos de dos segundos.'
    const msg = seedMessage({ area_id: 'a-error', author_id: 'u-bruno', title: 'Nota de voz, video y un informe', body: 'Lo dije hablando y dejé la grabación y el informe del cliente.', created_at: ago(6), assignee_ids: ['u-ana'], attachment_ids: [voice, video, pdf] })
    return { message_id: msg.id }
  }
  if (path === '/_control/reset') {
    reviews.clear()
    execution = null
    workTimings.clear()
    executeJobs.clear()
    for (const t of jobs.values()) clearTimeout(t)
    jobs.clear()
    waiting.clear()
    held = false
    running = 0
    autoPublish = process.env.PANEL_DEV_AUTO_PUBLISH !== '0'
    project.name = PROJECT_NAME
    framing = {}
    inputs.clear()
    seedOps()
    seedAudit()
    eventLog.length = 0
    restoreArray(members, initial.members)
    restoreArray(areas, initial.areas)
    restoreArray(templates, initial.templates)
    restoreArray(providers, initial.providers)
    seedConnections()
    restoreArray(messages, initial.messages)
    Object.keys(project).forEach((k) => delete project[k])
    Object.assign(project, copyOf(initial.project))
    restoreMap(attachments, initial.attachments)
    for (const a of attachments.values()) a.data = Buffer.from(a.data)
    restoreMap(replies, initial.replies)
    return {}
  }
  return null
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  let { pathname } = url
  if (BASE !== '/') {
    // Under a base, everything lives below it and the rest of the host is someone else's.
    if (`${pathname}/` === BASE) pathname = '/'
    else if (pathname.startsWith(BASE)) pathname = pathname.slice(BASE.length - 1)
    else return fail(res, 404, 'Fuera de la base del panel')
  }
  const method = req.method ?? 'GET'

  if (!pathname.startsWith('/api/')) {
    if (STATIC) return serveStatic(req, res, pathname)
    return fail(res, 404, 'Servidor doble de desarrollo: sólo /api')
  }
  const path = pathname.slice('/api'.length)
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(method)
  // Like the real server (src/api/index.js): a write that went through is announced to the whole team once the response is out.
  if (unsafe && !path.startsWith('/_control/')) {
    res.on('finish', () => {
      const parts = path.split('/')
      const template = parts.map((p, i) => (i === 2 && !['delete', 'restore', 'me'].includes(p) ? ':id' : i === 4 && parts[3] === 'replies' ? ':replyId' : p)).join('/')
      const change = changeOfWrite({ method, routeUrl: template, params: { id: parts[2] }, status: res.statusCode })
      if (change) emit(null, 'message', change)
    })
  }

  try {
    if (path === '/health') return send(res, 200, { ok: true, dev: true })

    if (CONTROL && path.startsWith('/_control/') && method === 'POST') {
      const done = control(path, url.searchParams)
      return done ? send(res, 200, done) : fail(res, 404, 'Orden de control inexistente')
    }

    if (unsafe && !req.headers['x-team-request']) return fail(res, 403, 'Falta la cabecera CSRF')

    if (path === '/auth/login' && method === 'POST') {
      const body = await readJson(req)
      const member = members.find((m) => m.email === String(body?.email ?? '').trim().toLowerCase())
      const password = String(body?.password ?? '')
      if (!member || !member.active || password.length < 15) return fail(res, 401, 'Correo o contraseña incorrectos', 'invalid_credentials')
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
    if (path === '/me' && method === 'GET') return send(res, 200, { ...me, provider: 'local', project_name: project.name, password_min_length: 15, ui_telemetry: { enabled: uiState.enabled, max_events: uiConfig.uiTelemetry.maxEvents } })

    // --- interface telemetry (UD-091)
    if (path === '/telemetry/ui' && method === 'POST') {
      const body = await readJson(req)
      if (!uiValidate(body)) return fail(res, 400, 'Datos inválidos.', 'validation')
      if (uiState.enabled) recordUiBatch(body, { tracer: uiTracer })
      return send(res, 204, undefined)
    }
    if (path === '/telemetry/ui-summary' && method === 'GET') {
      const days = Number(url.searchParams.get('days') ?? uiConfig.worker.retentionDays)
      const now = Date.now()
      return send(res, 200, { ...uiSummary(uiDb, { sinceMs: now - days * 86_400_000, untilMs: now + 1 }), days })
    }
    if (path === '/settings/telemetry' && method === 'PATCH') {
      const body = await readJson(req)
      if (typeof body?.ui_enabled !== 'boolean') return fail(res, 400, 'Datos inválidos.', 'validation')
      uiState.enabled = body.ui_enabled
      return send(res, 200, { ui_enabled: uiState.enabled })
    }

    // --- project description: the whole team sees it and only the Editor changes it (UD-024)
    // Publication (UD-070): everyone reads it, the Editor changes it.
    // --- data reset (UD-240): the double empties its sample state the way POST /api/ops/reset does
    if (path === '/ops/reset' && method === 'POST') {
      if (url.searchParams.get('confirm') !== 'true') return fail(res, 400, 'La operación es destructiva y exige confirm=true en la dirección.', 'confirm_required')
      const body = await readJson(req)
      if (!['content', 'everything'].includes(body?.scope)) return fail(res, 400, 'Alcance inválido', 'validation')
      const blobs = [...attachments.values()].filter((a) => a.kind !== 'link')
      const deleted = { inputs: inputs.size, attachments: attachments.size, messages: messages.length, replies: [...replies.values()].reduce((n, list) => n + list.length, 0), jobs: jobs.size, spans: 0 }
      const bytesFreed = blobs.reduce((n, a) => n + (a.data?.length ?? 0), 0)
      for (const t of jobs.values()) clearTimeout(t)
      jobs.clear()
      waiting.clear()
      inputs.clear()
      olderJobs = []
      record(me, 'data.reset', 'data', null, { scope: body.scope })
      eventLog.length = 0
      messages.length = 0
      replies.clear()
      attachments.clear()
      if (body.scope === 'everything') {
        deleted.members = members.filter((m) => m.id !== me.id).length
        deleted.areas = areas.length
        deleted.templates = templates.length
        members.splice(0, members.length, ...members.filter((m) => m.id === me.id))
        restoreArray(areas, initial?.areas ?? areas)
        restoreArray(templates, initial?.templates ?? templates)
      }
      return send(res, 200, { scope: body.scope, deleted, files: blobs.length, bytes_freed: bytesFreed })
    }
    // --- sample set (UD-252): one input per example of ejemplos/, like POST /api/ops/seed
    if (path === '/ops/seed' && method === 'POST') {
      if (url.searchParams.get('confirm') !== 'true') return fail(res, 400, 'La operación exige confirm=true en la dirección.', 'confirm_required')
      const { readExamples } = await import('../src/domain/seed-examples.js')
      let created = 0
      let existing = 0
      for (const send of readExamples(new URL('../ejemplos/', import.meta.url).pathname)) {
        const datas = send.files.map((f) => ({ ...f, data: readFileSync(f.path) }))
        const hash = createHash('sha256').update(me.id).update(send.text).update(datas.map((f) => createHash('sha256').update(f.data).digest('hex')).join()).digest('hex')
        if ([...inputs.values()].some((i) => i.content_hash === hash && i.status !== 'cancelled' && i.status !== 'published')) { existing++; continue }
        const inputId = `i-${id()}`
        const attachmentIds = datas.map((f) => {
          const a = { id: `f-${id()}`, kind: kindOf(f.mime), mime: f.mime, name: f.name, size: f.data.length, data: f.data, input_id: inputId }
          attachments.set(a.id, a)
          return a.id
        })
        const input = { id: inputId, author_id: me.id, text: send.text, content_hash: hash, status: 'queued', created_at: new Date().toISOString(), job_id: `j-${id()}`, attachment_ids: attachmentIds, units: unitsOf(send.text), proposal: null, error: null }
        inputs.set(input.id, input)
        runJob(input)
        created++
      }
      return send(res, 202, { created, existing })
    }
    if (path === '/settings/publication' && method === 'GET') return send(res, 200, { auto_publish: autoPublish })
    if (path === '/settings/publication' && method === 'PATCH') {
      const body = await readJson(req)
      if (!body || typeof body.auto_publish !== 'boolean') return fail(res, 400, 'auto_publish es verdadero o falso', 'validation')
      autoPublish = body.auto_publish
      return send(res, 200, { auto_publish: autoPublish })
    }
    if (path === '/settings/analysis' && method === 'GET') {
      return send(res, 200, framingView())
    }
    if (path === '/settings/analysis' && method === 'PATCH') {
      if (needEditor()) return
      const body = await readJson(req)
      if (!body?.framing || typeof body.framing !== 'object') return fail(res, 400, 'Falta el encuadre.', 'validation')
      for (const [lang, text] of Object.entries(body.framing)) {
        if (!(lang in FRAMING_DEFAULTS) || typeof text !== 'string') return fail(res, 400, 'Idioma o texto inválido.', 'validation')
        if ([...text.trim()].length > FRAMING_MAX_CHARS) return fail(res, 413, `El encuadre del análisis supera el máximo de ${FRAMING_MAX_CHARS} caracteres.`, 'too_large')
        if (!text.trim() || text.trim() === FRAMING_DEFAULTS[lang]) delete framing[lang]
        else framing[lang] = text.trim()
      }
      return send(res, 200, framingView())
    }
    if (path === '/settings/project' && method === 'GET') return send(res, 200, { ...project, max_chars: PROJECT_MAX_CHARS, name_max_chars: PROJECT_NAME_MAX_CHARS })
    if (path === '/settings/project' && method === 'PATCH') {
      if (needEditor()) return
      const ct = req.headers['content-type'] ?? ''
      if (ct.startsWith('multipart/')) {
        const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(ct)
        const file = parseMultipart(await readBody(req), boundary[1] ?? boundary[2]).find((p) => p.name === 'file' && p.filename)
        if (!file) return fail(res, 400, 'Falta el archivo.', 'validation')
        project.description = file.data.toString('utf8')
      } else {
        const body = await readJson(req)
        if (typeof body?.description !== 'string' && typeof body?.name !== 'string') return fail(res, 400, 'Falta la descripción.', 'description_required')
        if (typeof body.name === 'string') {
          if ([...body.name.trim()].length > PROJECT_NAME_MAX_CHARS) return fail(res, 413, `El nombre del proyecto supera el máximo de ${PROJECT_NAME_MAX_CHARS} caracteres.`, 'too_large')
          project.name = body.name.trim() || PROJECT_NAME
        }
        if (typeof body.description === 'string') project.description = body.description
      }
      return send(res, 200, { ...project, max_chars: PROJECT_MAX_CHARS, name_max_chars: PROJECT_NAME_MAX_CHARS })
    }

    // --- events
    if (path === '/events' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
      res.write('retry: 3000\n\n')
      const stream = { member_id: me.id, res }
      streams.add(stream)
      const last = Number(req.headers['last-event-id'] ?? 0)
      for (const ev of eventLog) if (ev.seq > last && (ev.member_id === null || ev.member_id === me.id)) writeEvent(res, ev)
      const beat = setInterval(() => res.write(': heartbeat\n\n'), 15_000)
      req.on('close', () => {
        clearInterval(beat)
        streams.delete(stream)
      })
      return
    }

    // --- development only: simulates a message arriving from another member (tests the SSE notice)
    if (path === '/_dev/incoming' && method === 'POST') {
      const from = members.find((x) => x.id !== me.id)
      const msg = seedMessage({ area_id: 'a-pregunta', author_id: from.id, title: 'Confirmar el límite de adjuntos por mensaje', body: 'Mensaje entrante de ejemplo, generado por el servidor de desarrollo.', created_at: new Date().toISOString(), assignee_ids: [me.id], attachment_ids: [] })
      emit(me.id, 'message', { message_id: msg.id, title: msg.title, author_id: from.id, at: msg.created_at })
      return send(res, 201, { message_id: msg.id })
    }

    // --- queue, traces and log of the Editor (UD-251)
    const pageOf = (list) => {
      const limit = Math.min(100, Number(url.searchParams.get('limit') ?? 25))
      const page = Math.max(1, Number(url.searchParams.get('page') ?? 1))
      return { items: list.slice((page - 1) * limit, page * limit), page, limit, total: list.length }
    }
    if (path === '/jobs' && method === 'GET') {
      const state = url.searchParams.get('state')
      return send(res, 200, pageOf(allJobs().filter((j) => !state || j.status === state).map(jobRowOf)))
    }
    if (path === '/jobs' && method === 'DELETE') {
      const state = url.searchParams.get('state')
      if (!['done', 'failed', 'cancelled'].includes(state ?? '')) return fail(res, 400, 'Estado inválido', 'validation')
      if (url.searchParams.get('confirm') !== 'true') return fail(res, 400, 'La operación es destructiva y exige confirm=true en la dirección.', 'confirm_required')
      const gone = allJobs().filter((j) => j.status === state)
      for (const j of gone) purgedJobs.add(j.id)
      record(me, 'jobs.purge', 'job', null, { state, purged: gone.length })
      return send(res, 200, { purged: gone.length })
    }
    const timingMatch = /^\/messages\/([^/]+)\/timing$/.exec(path)
    if (timingMatch && method === 'GET') {
      if (execution?.deliver && timingMatch[1] === execution.liveId) {
        // UD-263: the run ended and its delivery is running: the message is « running » with the phase of the delivery.
        return send(res, 200, {
          message_id: timingMatch[1], job_id: 'j-exec0', job_status: 'running', trace_id: null, phase: 'deliverDeploy', attempts: 1, elapsed_ms: 20_000,
          first_reply_ms: 41000, final_reply_ms: null, first_reply_since_message_ms: null, final_reply_since_message_ms: null, total_ms: null, queue_wait_ms: null,
          phases: [], slowest: [], turns: [], tree: null, deliver: { job_id: 'j-exec1', job_status: 'running', phase: 'deliverDeploy', attempts: 1 },
        })
      }
      if (workTimings.has(timingMatch[1])) return send(res, 200, workTimings.get(timingMatch[1]))
      const agentRun = executeJobs.get(timingMatch[1])
      if (agentRun) {
        return send(res, 200, {
          message_id: timingMatch[1], job_id: agentRun.id, job_status: 'running', trace_id: null, phase: 'run', attempts: 1, elapsed_ms: 5_000,
          first_reply_ms: null, final_reply_ms: null, first_reply_since_message_ms: null, final_reply_since_message_ms: null, total_ms: null, queue_wait_ms: null,
          phases: [], slowest: [], turns: [], tree: null,
        })
      }
      if (!execution || timingMatch[1] !== execution.doneId) return fail(res, 404, 'El mensaje no tiene trabajo de ejecución.', 'not_found')
      const span = (name, ms, attributes = {}, children = [], status = 'ok') => ({ trace_id: 't-exec', span_id: `s-${name}-${ms}`, parent_id: null, name, kind: 'INTERNAL', status, status_message: null, start_ns: '0', end_ns: '0', start_ms: 0, duration_ms: ms, attributes, events: [], children })
      const tool = (name, summary, ms, ok = true) => span('execute.tool', ms, { 'gen_ai.tool.name': name, 'team.tool.summary': summary, 'team.tool.success': ok }, [], ok ? 'ok' : 'error')
      const tools = [tool('Read', 'Lectura: Reservas.tsx', 800), tool('Edit', 'Edición: Reservas.tsx', 1200), tool('Bash', 'Orden: npm test', 94000, false), tool('Bash', 'Orden: npm test', 61000)]
      const sub = span('execute.subagent', 30000, { 'gen_ai.agent.name': 'reviewer', 'team.tool.summary': 'Subagente: Revisar estilos' }, [tool('Grep', 'Búsqueda: Agendar', 400)])
      const run = span('execute.machine.run', 210000, {}, [...tools, sub])
      const tree = span('execute', 1_380_000, { 'team.queue_wait_ms': 920_000 }, [span('execute.machine.create', 95000), run, span('execute.machine.destroy', 8000)])
      return send(res, 200, {
        message_id: timingMatch[1], job_id: 'j-exec0', job_status: 'done', trace_id: 'a'.repeat(32), phase: null, attempts: 1, model: 'claude-haiku-5-5', cost_usd: 0.31, judgment: { job_id: 'j-exec0', judge_model: 'claude-haiku-5-5', worked_with: 'claude-haiku-5-5', quadrant: 'execute', axes: [{ axis: 1, name: 'Alineación estratégica', score: 0, target: 0, meets: true, kpis: 1 }, { axis: 2, name: 'Integridad del artefacto', score: 1, target: 2, meets: false, kpis: 2 }, { axis: 3, name: 'Eficiencia del proceso', score: null, target: 1, meets: null, kpis: 0 }, { axis: 4, name: 'Colaboración y transparencia', score: null, target: 0, meets: null, kpis: 0 }], kpis: [{ id: '2.1', applies: true, score: 1, quote: 'Ya carga con tus datos', claim: 'La pantalla carga con sus datos.', reasoning: 'r' }], summary: 'Adecuado para un arreglo directo.', cost_usd: 0.01 }, elapsed_ms: null,
        first_reply_ms: 41000, final_reply_ms: 1_320_000, first_reply_since_message_ms: 961000, final_reply_since_message_ms: 2_240_000, total_ms: 1_380_000, queue_wait_ms: 920_000,
        phases: [{ name: 'create', duration_ms: 95000, offset_ms: 0, status: 'unset' }, { name: 'run', duration_ms: 210000, offset_ms: 95000, status: 'unset' }, { name: 'destroy', duration_ms: 8000, offset_ms: 1_370_000, status: 'unset' }],
        slowest: [...tools, sub].map((n) => ({ kind: n.name === 'execute.subagent' ? 'subagent' : 'tool', name: n.attributes['gen_ai.tool.name'] ?? n.attributes['gen_ai.agent.name'], summary: n.attributes['team.tool.summary'], duration_ms: n.duration_ms, success: n.attributes['team.tool.success'] ?? null })).sort((a, b) => b.duration_ms - a.duration_ms),
        turns: [], tree,
      })
    }
    if (path === '/ops/execute-runs/summary' && method === 'GET') {
      // UD-262: the same figures the API computes from `execute_runs`, for a period with five runs (one failed).
      const stat = (n, avg, p50, p95) => ({ n, avg, p50, p95 })
      const none = stat(0, null, null, null)
      return send(res, 200, {
        runs: 5, failed: 1, from: ago(5 * 24 * 60), to: ago(60),
        phases: {
          queue_wait_ms: stat(5, 410_000, 320_000, 920_000), first_reply_ms: stat(4, 52_000, 41_000, 90_000), final_reply_ms: stat(4, 1_100_000, 1_020_000, 1_320_000),
          total_ms: stat(5, 1_180_000, 1_110_000, 1_380_000), create_ms: stat(5, 95_000, 90_000, 120_000), run_ms: stat(5, 1_000_000, 980_000, 1_300_000), destroy_ms: stat(5, 8000, 8000, 9000),
          tools_ms: stat(4, 240_000, 210_000, 420_000), judge_ms: none, delivery_ms: stat(2, 45_000, 40_000, 50_000), wait_ms: none
        },
        cost: { n: 5, avg_usd: 1.62, total_usd: 8.1 }, tokens: { input: 900000, output: 41000, cache_read: 700000, cache_write: 30000 },
        delivery: { known: 2, delivered: 1, rate: 0.5 }, resolved: { runs: 5, investigated: 1, rate: 0.2 },
        slowest_tools: [
          { kind: 'tool', name: 'Bash', summary: 'Orden: npm test', duration_ms: 94000, success: false, job_id: 'j-exec0', message_id: null },
          { kind: 'tool', name: 'Bash', summary: 'Orden: npm test', duration_ms: 61000, success: true, job_id: 'j-exec0', message_id: null }
        ]
      })
    }
    const traceMatch = /^\/jobs\/([^/]+)\/trace$/.exec(path)
    if (traceMatch && method === 'GET') {
      const job = allJobs().find((j) => j.id === traceMatch[1])
      const trace = job ? traceOf(job) : null
      return trace ? send(res, 200, trace) : fail(res, 404, 'El trabajo no dejó spans.', 'not_found')
    }
    if (path === '/audit' && method === 'GET') {
      const action = url.searchParams.get('action')
      return send(res, 200, pageOf(auditLog.filter((a) => !action || a.action === action)))
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
      if (!text.trim() && !files.length && !links.length) return fail(res, 400, 'El input está vacío', 'empty_input')
      // «Enviar como» (UD-255): the author is the member chosen; `sent_by_id` keeps who had the session when it is someone else.
      const asId = parts.find((p) => p.name === 'as_member_id')?.data.toString('utf8') || me.id
      const author = members.find((x) => x.id === asId)
      if (!author || author.active === false) return fail(res, 400, '«Enviar como» no es un miembro activo.', 'send_as_invalid')
      if (author.kind === 'agent') return fail(res, 400, 'No se envía en nombre de un miembro agente.', 'cannot_send_as_agent')
      const sentBy = author.id === me.id ? null : me.id
      // Recipients (UD-291): each one an active member; an agent is one more, with no route of its own.
      const recipientIds = []
      for (const p of parts.filter((x) => x.name === 'recipient_ids' || x.name === 'recipient_ids[]')) {
        const rid = p.data.toString('utf8').trim()
        if (!members.some((x) => x.id === rid && x.active !== false)) return fail(res, 400, `El miembro ${rid} no existe o está desactivado.`, 'recipient_invalid')
        if (!recipientIds.includes(rid)) recipientIds.push(rid)
      }
      // Rejections before queueing, like the API's: a large file or a long video (the name triggers it).
      const huge = files.find((f) => /demasiado-grande/.test(f.filename))
      if (huge) return fail(res, 413, 'Un archivo supera el tamaño máximo permitido.', `${kindOf(huge.type ?? '')}_too_large`)
      const long = files.find((f) => /video-largo/.test(f.filename))
      if (long) return fail(res, 422, 'El video dura demasiado.', 'video_too_long')
      const hash = createHash('sha256').update(author.id).update(text.trim()).update(files.map((f) => createHash('sha256').update(f.data).digest('hex')).join()).update(links.join()).update(recipientIds.join()).digest('hex')
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
      const input = { id: inputId, author_id: author.id, sent_by_id: sentBy, recipient_ids: recipientIds, text, content_hash: hash, status: 'queued', created_at: new Date().toISOString(), job_id: `j-${id()}`, attachment_ids: attachmentIds, units: unitsOf(text), proposal: null, error: null }
      inputs.set(input.id, input)
      // The sample data had no input.create rows; only a send in someone else's name leaves one, the row the flows read.
      if (sentBy) record(me, 'input.create', 'input', input.id, { atts: attachmentIds.length, author_id: author.id, sent_by_id: me.id })
      runJob(input)
      return send(res, 201, { input_id: input.id, job_id: input.job_id })
    }

    // My inputs still in play: GET /inputs?mine=1&status=queued,extracting,analyzing,proposed,failed
    if (path === '/inputs' && method === 'GET') {
      const wanted = (url.searchParams.get('status') ?? '').split(',').filter(Boolean)
      // `all=1` (UD-251): the Editor's queue, the sends of everybody with the name of the sender, paginated; a member gets 403.
      if (url.searchParams.get('all')) {
        const everyone = [...inputs.values()].filter((i) => !wanted.length || wanted.includes(i.status)).sort((a, b) => b.created_at.localeCompare(a.created_at))
        return send(res, 200, pageOf(everyone.map((i) => ({ ...inputView(i), author_name: members.find((x) => x.id === i.author_id)?.name ?? null }))))
      }
      const mine = [...inputs.values()].filter((i) => i.author_id === me.id && (!wanted.length || wanted.includes(i.status)))
      // `order=desc` is the history of sends (every state, newest first); `mine=1` alone keeps the tray order.
      if (url.searchParams.get('order') === 'desc') mine.sort((a, b) => b.created_at.localeCompare(a.created_at))
      return send(res, 200, envelope(mine.map(inputView)))
    }

    let m = /^\/inputs\/([^/]+)(?:\/(publish|cancel|restore|reprocess|proposal))?$/.exec(path)
    // Deletion for real (UD-240): the sender or the Editor; with `with_messages=true` the published messages go too.
    if (m && !m[2] && method === 'DELETE') {
      const input = inputs.get(m[1])
      if (!input) return fail(res, 404, 'No existe')
      if (url.searchParams.get('confirm') !== 'true') return fail(res, 400, 'La operación es destructiva y exige confirm=true en la dirección.', 'confirm_required')
      const withMessages = url.searchParams.get('with_messages') === 'true'
      clearTimeout(jobs.get(input.job_id))
      waiting.delete(input.job_id)
      const born = messages.filter((x) => x.input_id === input.id)
      let deletedMessages = 0
      if (withMessages) {
        for (const msg of born) {
          messages.splice(messages.indexOf(msg), 1)
          replies.delete(msg.id)
          deletedMessages++
        }
      } else {
        for (const msg of born) msg.input_id = null
      }
      const stillUsed = new Set(messages.flatMap((x) => x.attachment_ids))
      let deletedAttachments = 0
      let freed = 0
      for (const aid of input.attachment_ids) {
        if (stillUsed.has(aid)) { const a = attachments.get(aid); if (a) a.input_id = null; continue }
        freed += attachments.get(aid)?.size ?? 0
        attachments.delete(aid)
        deletedAttachments++
      }
      inputs.delete(input.id)
      record(me, 'input.delete', 'input', input.id, { with_messages: withMessages })
      return send(res, 200, { input_id: input.id, deleted: { attachments: deletedAttachments, jobs: 1, messages: deletedMessages }, freed_bytes: freed })
    }
    if (m) {
      const input = inputs.get(m[1])
      if (!input || (input.author_id !== me.id && m[2] !== 'reprocess')) return fail(res, 404, 'No existe')
      if (!m[2] && method === 'GET') {
        return send(res, 200, inputView(input))
      }
      // The submitted text is corrected in place; the proposal is not redone.
      if (!m[2] && method === 'PATCH') {
        const body = await readJson(req)
        if (!body || typeof body.text !== 'string' || !body.text.trim()) return fail(res, 422, 'El texto no puede quedar vacío', 'validation')
        input.text = body.text
        input.units = unitsOf(body.text)
        return send(res, 200, inputView(input))
      }
      if (m[2] === 'proposal' && method === 'PATCH') {
        if (input.status !== 'proposed') return fail(res, 409, 'El input no tiene una propuesta pendiente', 'conflict')
        const body = await readJson(req)
        if (!body || !Array.isArray(body.messages) || !body.messages.length) return fail(res, 422, 'La propuesta necesita al menos un mensaje', 'validation')
        for (const pm of body.messages) {
          if (!areas.some((x) => x.id === pm.area_id)) return fail(res, 422, 'El área no existe', 'validation')
          if (!(pm.assignee_ids ?? []).every((x) => members.some((mm) => mm.id === x))) return fail(res, 422, 'Un destinatario no existe', 'validation')
        }
        input.proposal = { messages: body.messages, discarded: body.discarded ?? input.proposal?.discarded ?? [], simulated: input.proposal?.simulated }
        return send(res, 200, input.proposal)
      }
      if (m[2] === 'cancel' && method === 'POST') {
        if (input.status === 'published' || input.status === 'cancelled') return fail(res, 409, 'El input no se puede cancelar', 'conflict')
        clearTimeout(jobs.get(input.job_id))
        waiting.delete(input.job_id)
        input.status = 'cancelled'
        return send(res, 204)
      }
      if (m[2] === 'restore' && method === 'POST') {
        if (input.status !== 'cancelled') return fail(res, 409, 'El input no está cancelado', 'not_cancelled')
        input.status = input.proposal ? 'proposed' : 'failed'
        if (!input.proposal) input.error = 'Se descartó antes de terminar el análisis.'
        return send(res, 200, { input_id: input.id, status: input.status })
      }
      if (m[2] === 'reprocess' && method === 'POST') {
        const wasPublished = input.status === 'published'
        if (!wasPublished && !['proposed', 'failed', 'cancelled'].includes(input.status)) return fail(res, 409, 'Sólo se reprocesa un input publicado, con propuesta, fallido o cancelado', 'not_reprocessable')
        // UD-258: a published send sets its live messages aside (the trash, with their replies) and is analyzed again.
        let setAside = null
        if (wasPublished) {
          const live = (input.message_ids ?? []).map((mid) => messages.find((x) => x.id === mid && !x.deleted_at)).filter(Boolean)
          const at = new Date().toISOString()
          let replyCount = 0
          for (const msg of live) { replyCount += liveReplies(msg).length; msg.deleted_at = at }
          setAside = { messages: live.length, replies: replyCount }
          input.message_ids = []
        }
        input.proposal = null
        input.error = null
        input.error_code = null
        input.text = input.text.replace('[simular falla]', '').trim() || input.text
        input.units = unitsOf(input.text)
        input.status = 'queued'
        input.job_id = `j-${id()}`
        record(me, 'input.reprocess', 'input', input.id, setAside)
        runJob(input)
        return send(res, 202, { input_id: input.id, job_id: input.job_id, ...(setAside ? { set_aside: setAside } : {}) })
      }
      if (m[2] === 'publish' && method === 'POST') {
        if (input.status === 'published') return fail(res, 409, 'El input ya está publicado', 'already_published')
        if (input.status !== 'proposed') return fail(res, 409, 'El input no tiene una propuesta pendiente', 'conflict')
        const sent = await readJson(req)
        const proposal = sent && Array.isArray(sent.messages) ? sent : input.proposal
        if (!proposal?.messages?.length) return fail(res, 422, 'Propuesta inválida', 'validation')
        const problem = proposalProblem(proposal, input)
        if (problem) return typeof problem === 'string' ? fail(res, 422, problem, 'validation') : fail(res, 422, problem.message, problem.code)
        input.error = null
        input.error_code = null
        return send(res, 201, { message_ids: publishProposal(input, proposal) })
      }
    }

    // --- messages
    if (path === '/messages' && method === 'GET') {
      const q = url.searchParams
      const forId = q.get('for') === 'me' ? me.id : q.get('for')
      const needle = (q.get('q') ?? '').toLowerCase()
      // `involved=me`: the rule of the summary (UD-028), assigned to me or sent by me once answered or closed.
      const involved = (x) => q.get('involved') !== 'me' || x.assignee_ids.includes(me.id) || (x.author_id === me.id && x.status !== 'open')
      // `deleted=1` (UD-250): only the deleted ones, the viewer's own, or every one for an Editor.
      const source = q.get('deleted') === '1' ? messages.filter((x) => x.deleted_at && true) : liveMessages()
      let list = source.filter((x) => involved(x) && (!forId || x.assignee_ids.includes(forId)) && (!q.get('area') || x.area_id === q.get('area')) && (!q.get('status') || x.status === q.get('status')) && (!needle || x.id === needle.replace(/^#/, '') || `${x.title} ${x.body}`.toLowerCase().includes(needle)))
      if (q.get('replies') === '1') list = list.filter((x) => liveReplies(x).length > 0)
      const stamp = (x) => (q.get('replies') === '1' ? liveReplies(x).at(-1)?.created_at : x.created_at)
      list.sort((a, b) => stamp(b).localeCompare(stamp(a)))
      return send(res, 200, envelope(list.map((x) => ({ ...view(x), deleted_at: x.deleted_at ?? null }))))
    }
    if (path === '/messages/summary' && method === 'GET') {
      // Same rule as the API (UD-028, UD-041): assigned to me, open or answered; or mine, not assigned and answered.
      const mine = { open: 0, answered: 0, total: 0 }
      const items = []
      for (const x of liveMessages()) {
        if (x.status === 'closed') continue
        const status = x.assignee_ids.includes(me.id) || (x.author_id === me.id && x.status === 'answered') ? x.status : null
        if (status) {
          mine[status]++
          mine.total++
          items.push({ message_id: x.id, title: x.title, status, at: x.created_at })
        }
      }
      const rank = { open: 0, answered: 1 }
      items.sort((a, b) => rank[a.status] - rank[b.status] || b.at.localeCompare(a.at))
      const inArea = (a, status) => liveMessages().filter((x) => x.area_id === a.id && x.status === status)
      return send(res, 200, { mine, items, areas: areas.map((a) => ({ area_id: a.id, open: inArea(a, 'open').length, answered: inArea(a, 'answered').length, closed: inArea(a, 'closed').length, mine_open: inArea(a, 'open').filter((x) => x.assignee_ids.includes(me.id)).length })) })
    }
    // Several messages at once (UD-253), as the real API does: all or nothing, 403 and 404 with the ids that fail.
    if ((path === '/messages/delete' || path === '/messages/restore') && method === 'POST') {
      const restoring = path === '/messages/restore'
      if (!restoring && url.searchParams.get('confirm') !== 'true') return fail(res, 400, 'Falta la confirmación.', 'confirm_required')
      const body = await readJson(req)
      if (!body || !Array.isArray(body.ids) || !body.ids.length || body.ids.length > 100) return fail(res, 400, 'El campo «ids» no es válido.', 'validation')
      const ids = [...new Set(body.ids.map(String))]
      const found = ids.map((id) => messages.find((x) => x.id === id))
      const refused = found.filter((x) => x && false).map((x) => x.id)
      if (refused.length) return send(res, 403, { code: 'not_message_author', message: 'Sólo quien envió el mensaje o un Editor puede borrarlo.', ids: refused })
      const missing = ids.filter((id, i) => !found[i] || (!restoring && found[i].deleted_at))
      if (missing.length) return send(res, 404, { code: 'not_found', message: 'Algunos mensajes no existen.', ids: missing })
      const live = restoring ? found.filter((x) => !x.deleted_at).map((x) => x.id) : []
      if (live.length) return send(res, 409, { code: 'not_deleted', message: 'Algunos mensajes no están borrados.', ids: live })
      const at = new Date().toISOString()
      for (const x of found) {
        x.deleted_at = restoring ? null : at
        record(me, restoring ? 'message.restore' : 'message.delete', 'message', x.id, { bulk: ids.length })
      }
      return send(res, 200, { ids })
    }
    // Soft deletion and restoration of a message and of a reply (UD-240), as the real API does.
    m = /^\/messages\/([^/]+)\/replies\/([^/]+)$/.exec(path)
    if (m && method === 'DELETE') {
      const msg = messages.find((x) => x.id === m[1] && !x.deleted_at)
      const reply = msg && (replies.get(msg.id) ?? []).find((r) => r.id === m[2] && !r.deleted_at)
      if (!reply) return fail(res, 404, 'No existe')
            if (url.searchParams.get('confirm') !== 'true') return fail(res, 400, 'Falta la confirmación.', 'confirm_required')
      reply.deleted_at = new Date().toISOString()
      syncStatus(msg)
      return send(res, 200, { ...view(msg), replies: liveReplies(msg).map(replyView) })
    }
    // Edit of the text of a reply by its author only (UD-253), with the version read, as the real API does.
    if (m && method === 'PATCH') {
      const msg = messages.find((x) => x.id === m[1] && !x.deleted_at)
      const reply = msg && (replies.get(msg.id) ?? []).find((r) => r.id === m[2] && !r.deleted_at)
      if (!reply) return fail(res, 404, 'No existe')
      if (reply.author_id !== me.id) return fail(res, 403, 'Sólo quien escribió la respuesta la edita', 'not_reply_author')
      const body = await readJson(req)
      if (!body || !Number.isInteger(body.version) || (body.body !== undefined && typeof body.body !== 'string') || Object.keys(body).some((k) => !['body', 'version', 'mention_ids', 'remove_attachment_ids'].includes(k))) return fail(res, 400, 'Falta la versión.', 'validation')
      if (body.version !== (reply.version ?? 1)) return send(res, 409, { code: 'edit_conflict', message: 'La respuesta cambió desde que se leyó.', version: reply.version ?? 1 })
      // UD-279: the same edit also takes attachments off and adds mentions (only for who was not mentioned yet).
      const nextBody = body.body ?? reply.body
      const remove = (body.remove_attachment_ids ?? []).map(String)
      const fresh = (body.mention_ids ?? []).map(String).filter((x) => !(reply.mentions ?? []).map(String).includes(x))
      if (nextBody === reply.body && remove.length === 0 && fresh.length === 0) return send(res, 200, { ...view(msg), replies: liveReplies(msg).map(replyView) })
      const left = (reply.attachment_ids ?? []).filter((x) => !remove.includes(String(x)))
      if (!nextBody.trim() && left.length === 0) return fail(res, 400, 'La respuesta no puede estar vacía.', 'reply_empty')
      reply.body = nextBody
      reply.attachment_ids = left
      for (const x of fresh) {
        const to = members.find((u) => String(u.id) === x)
        if (!to) return fail(res, 404, 'El miembro mencionado no existe.', 'not_found')
        reply.mentions = [...(reply.mentions ?? []), to.id]
        if (!msg.assignee_ids.includes(to.id)) msg.assignee_ids = [...msg.assignee_ids, to.id]
      }
      reply.version = (reply.version ?? 1) + 1
      reply.edited_at = new Date().toISOString()
      return send(res, 200, { ...view(msg), replies: liveReplies(msg).map(replyView) })
    }
    m = /^\/messages\/([^/]+)\/replies\/([^/]+)\/attachments$/.exec(path)
    if (m && method === 'POST') {
      const msg = messages.find((x) => x.id === m[1] && !x.deleted_at)
      const reply = msg && (replies.get(msg.id) ?? []).find((r) => r.id === m[2] && !r.deleted_at)
      if (!reply) return fail(res, 404, 'No existe')
      if (reply.author_id !== me.id) return fail(res, 403, 'Sólo quien escribió la respuesta la edita', 'not_reply_author')
      const ct = req.headers['content-type'] ?? ''
      const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(ct)
      const parts = parseMultipart(await readBody(req), boundary[1] ?? boundary[2])
      const version = Number(parts.find((p) => p.name === 'version')?.data.toString('utf8'))
      if (version !== (reply.version ?? 1)) return send(res, 409, { code: 'edit_conflict', message: 'La respuesta cambió desde que se leyó.', version: reply.version ?? 1 })
      const added = []
      for (const f of parts.filter((p) => p.name === 'files' && p.filename)) {
        const mime = f.type ?? 'application/octet-stream'
        const a = { id: `f-${id()}`, kind: kindOf(mime), mime, name: f.filename, size: f.data.length, data: f.data }
        if (a.kind === 'audio' || a.kind === 'video') a.transcript = SPOKEN_SAMPLE
        attachments.set(a.id, a)
        added.push(a.id)
      }
      if (added.length === 0) return fail(res, 400, 'Falta un archivo o un enlace.', 'attachments_empty')
      reply.attachment_ids = [...(reply.attachment_ids ?? []), ...added]
      reply.version = (reply.version ?? 1) + 1
      reply.edited_at = new Date().toISOString()
      return send(res, 201, { ...view(msg), replies: liveReplies(msg).map(replyView) })
    }
    m = /^\/replies\/([^/]+)\/restore$/.exec(path)
    if (m && method === 'POST') {
      const msg = messages.find((x) => !x.deleted_at && (replies.get(x.id) ?? []).some((r) => r.id === m[1]))
      const reply = msg && replies.get(msg.id).find((r) => r.id === m[1])
      if (!reply) return fail(res, 404, 'No existe')
            if (!reply.deleted_at) return fail(res, 409, 'La respuesta no está borrada.', 'not_deleted')
      reply.deleted_at = null
      syncStatus(msg)
      return send(res, 200, { ...view(msg), replies: liveReplies(msg).map(replyView) })
    }
    m = /^\/messages\/([^/]+)(?:\/(replies|close|reopen|attachments|restore|forward|deliver|discard-delivery|assessment))?$/.exec(path)
    if (m) {
      const msg = messages.find((x) => x.id === m[1])
      if (!msg) return fail(res, 404, 'No existe')
      if (m[2] === 'restore' && method === 'POST') {
        if (!msg.deleted_at) return fail(res, 409, 'El mensaje no está borrado.', 'not_deleted')
        msg.deleted_at = null
        return send(res, 200, { ...view(msg), replies: liveReplies(msg).map(replyView) })
      }
      if (msg.deleted_at) {
        if (!(!m[2] && method === 'GET' && url.searchParams.get('include_deleted') === 'true' && !!me)) return fail(res, 404, 'No existe')
      }
      if (!m[2] && method === 'DELETE') {
        if (url.searchParams.get('confirm') !== 'true') return fail(res, 400, 'Falta la confirmación.', 'confirm_required')
        msg.deleted_at = new Date().toISOString()
        res.writeHead(204)
        return res.end()
      }
      if (!m[2] && method === 'GET') return send(res, 200, { ...view(msg), deleted_at: msg.deleted_at ?? null, replies: liveReplies(msg).map(replyView), pending_delivery: reviews.get(msg.id) ?? null })
      if (m[2] === 'deliver' && method === 'POST') {
        if (me.role !== 'editor') return fail(res, 403, 'Esta acción es de un Editor.', 'forbidden')
        const review = reviews.get(msg.id)
        if (!review) return fail(res, 409, 'El mensaje no tiene una entrega esperando revisión.', 'no_pending_delivery')
        review.delivering_job_id = 'j-rev1'
        const progress = (percent, phrase) => emit(me.id, 'progress', { job_id: 'j-rev1', percent, phrase, at: new Date().toISOString() })
        // The delivery of the example: verifying, deploying, answered; the steps are slow enough for a test to look at them.
        progress(0, 'Verificando el cambio')
        setTimeout(() => progress(50, 'Publicando'), 400)
        setTimeout(() => {
          reviews.delete(msg.id)
          replies.get(msg.id)?.push({ id: `r-${id()}`, message_id: msg.id, author_id: 'u-claude', kind: 'answer', body: 'Ya está en producción.\n\n**Resultado**: done', created_at: new Date().toISOString(), attachment_ids: [] })
          syncStatus(msg)
          emit(me.id, 'done', { job_id: 'j-rev1', done: true, status: 'done', message_id: msg.id })
        }, 900)
        return send(res, 202, { job_id: 'j-rev1' })
      }
      if (m[2] === 'discard-delivery' && method === 'POST') {
        if (me.role !== 'editor') return fail(res, 403, 'Esta acción es de un Editor.', 'forbidden')
        const body = await readJson(req)
        if (!reviews.has(msg.id)) return fail(res, 409, 'El mensaje no tiene una entrega esperando revisión.', 'no_pending_delivery')
        if (!String(body?.reason ?? '').trim()) return fail(res, 400, 'El motivo es obligatorio.', 'reason_required')
        reviews.delete(msg.id)
        const reply = { id: `r-${id()}`, message_id: msg.id, author_id: me.id, kind: 'answer', body: `Descartado por ${me.name}: ${body.reason.trim()}`, created_at: new Date().toISOString(), attachment_ids: [] }
        replies.get(msg.id)?.push(reply)
        msg.status = 'open'
        return send(res, 200, { reply_id: reply.id })
      }
      // In-place edit of a published message (UD-071): only the sender, with the `version` that was read; every real change raises it.
      if (!m[2] && method === 'PATCH') {
        if (msg.author_id !== me.id) return fail(res, 403, 'Sólo quien envió el mensaje lo edita', 'not_message_author')
        const body = await readJson(req)
        if (!body || !Object.keys(body).length) return fail(res, 400, 'No hay nada que cambiar', 'validation')
        const allowed = ['version', 'title', 'body', 'fields', 'assignee_ids', 'area_id', 'template_id', 'attachment_ids']
        const unknown = Object.keys(body).filter((k) => !allowed.includes(k))
        if (unknown.length) return fail(res, 400, `El campo «${unknown[0]}» no existe.`, 'validation')
        if (!Number.isInteger(body.version)) return fail(res, 400, 'Falta la versión del mensaje.', 'validation')
        if (body.version !== (msg.version ?? 1)) return send(res, 409, { code: 'edit_conflict', message: 'El mensaje cambió desde que se leyó.', version: msg.version ?? 1 })
        if (body.title !== undefined && !String(body.title).trim()) return fail(res, 400, 'El título no puede quedar vacío.', 'validation')
        if (body.body !== undefined && !String(body.body).trim()) return fail(res, 400, 'El texto no puede quedar vacío.', 'validation')
        if (body.area_id !== undefined && !areas.some((a) => a.id === body.area_id)) return fail(res, 400, 'El área no existe.', 'validation')
        if (body.assignee_ids !== undefined && !body.assignee_ids.every((x) => members.some((mm) => mm.id === x))) return fail(res, 400, 'Un destinatario no existe.', 'validation')
        const origin = inputs.get(msg.input_id)
        if (body.attachment_ids !== undefined && !body.attachment_ids.every((x) => origin?.attachment_ids.includes(x) || (attachments.has(x) && (attachments.get(x).input_id ?? null) === (msg.input_id ?? null)))) return fail(res, 400, 'Un adjunto no es del envío de origen.', 'attachment_invalid')
        const areaId = body.area_id ?? msg.area_id
        const tpl = activeTemplate(areaId, body.template_id ?? (body.area_id ? null : msg.template_id))
        if (body.fields !== undefined) {
          const names = templateFields(tpl).map((f) => f.name)
          const bad = Object.keys(body.fields).find((k) => !names.includes(k))
          if (bad) return fail(res, 400, `El campo «${bad}» no existe en la plantilla.`, 'validation')
        }
        const before = JSON.stringify([msg.title, msg.body, msg.assignee_ids, msg.area_id, msg.template_id, msg.fields, msg.attachment_ids])
        const changed = []
        for (const k of ['title', 'body', 'assignee_ids', 'attachment_ids']) if (body[k] !== undefined) msg[k] = typeof body[k] === 'string' ? body[k].trim() : body[k]
        if (body.area_id !== undefined) {
          msg.area_id = body.area_id
          msg.template_id = tpl?.id ?? null
          msg.fields = body.fields ?? Object.fromEntries(templateFields(tpl).map((f) => [f.name, msg.fields?.[f.name] ?? '']))
        }
        if (body.fields !== undefined) msg.fields = body.fields
        if (JSON.stringify([msg.title, msg.body, msg.assignee_ids, msg.area_id, msg.template_id, msg.fields, msg.attachment_ids]) !== before) {
          for (const k of ['title', 'body', 'fields', 'assignee_ids', 'area_id', 'template_id', 'attachment_ids']) if (body[k] !== undefined) changed.push(k)
          msg.version = (msg.version ?? 1) + 1
          msg.updated_at = new Date().toISOString()
          msg.edited_at = msg.updated_at
          msg.edits = [...(msg.edits ?? []), { id: `e-${id()}`, member_id: me.id, at: msg.edited_at, version: msg.version, fields: changed }]
        }
        return send(res, 200, { ...view(msg), replies: liveReplies(msg).map(replyView) })
      }
      // New files or links on a published message (UD-071): they go at the end, count as an edit, and only the sender does it.
      if (m[2] === 'attachments' && method === 'POST') {
        if (msg.author_id !== me.id) return fail(res, 403, 'Sólo quien envió el mensaje lo edita', 'not_message_author')
        const ct = req.headers['content-type'] ?? ''
        const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(ct)
        if (!boundary) return fail(res, 400, 'Se esperaba multipart')
        const parts = parseMultipart(await readBody(req), boundary[1] ?? boundary[2])
        const version = Number(parts.find((p) => p.name === 'version')?.data.toString('utf8'))
        const files = parts.filter((p) => p.name === 'files' && p.filename)
        const links = parts.filter((p) => p.name === 'links').map((p) => p.data.toString('utf8'))
        if (!Number.isInteger(version)) return fail(res, 400, 'Falta la versión del mensaje.', 'validation')
        if (version !== (msg.version ?? 1)) return send(res, 409, { code: 'edit_conflict', message: 'El mensaje cambió desde que se leyó.', version: msg.version ?? 1 })
        if (!files.length && !links.length) return fail(res, 400, 'No hay nada que agregar.', 'attachments_empty')
        for (const f of files) {
          const mime = f.type ?? 'application/octet-stream'
          const a = { id: `f-${id()}`, kind: kindOf(mime), mime, name: f.filename, size: f.data.length, data: f.data, input_id: msg.input_id }
          attachments.set(a.id, a)
          msg.attachment_ids = [...msg.attachment_ids, a.id]
        }
        for (const link of links) {
          const a = { id: `f-${id()}`, kind: 'link', mime: 'text/uri-list', name: link, size: link.length, data: Buffer.from(link), input_id: msg.input_id }
          attachments.set(a.id, a)
          msg.attachment_ids = [...msg.attachment_ids, a.id]
        }
        msg.version = (msg.version ?? 1) + 1
        msg.updated_at = new Date().toISOString()
        msg.edited_at = msg.updated_at
        msg.edits = [...(msg.edits ?? []), { id: `e-${id()}`, member_id: me.id, at: msg.edited_at, version: msg.version, fields: ['attachment_ids'] }]
        return send(res, 200, { ...view(msg), replies: liveReplies(msg).map(replyView) })
      }
      if (m[2] === 'replies' && method === 'POST') {
        const ct = req.headers['content-type'] ?? ''
        let text
        let kind
        let mentionIds = []
        const attIds = []
        if (ct.startsWith('multipart/')) {
          const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(ct)
          const parts = parseMultipart(await readBody(req), boundary[1] ?? boundary[2])
          text = parts.find((p) => p.name === 'body')?.data.toString('utf8')
          kind = parts.find((p) => p.name === 'kind')?.data.toString('utf8')
          mentionIds = parts.filter((p) => p.name === 'mention_ids').map((p) => p.data.toString('utf8'))
          for (const f of parts.filter((p) => p.name === 'files' && p.filename)) {
            const mime = f.type ?? 'application/octet-stream'
            const a = { id: `f-${id()}`, kind: kindOf(mime), mime, name: f.filename, size: f.data.length, data: f.data }
            if (a.kind === 'audio' || a.kind === 'video') a.transcript = SPOKEN_SAMPLE // UD-279: the real server reads the speech of a reply's audio and video
            attachments.set(a.id, a)
            attIds.push(a.id)
          }
          for (const l of parts.filter((p) => p.name === 'links').map((p) => p.data.toString('utf8'))) {
            const a = { id: `f-${id()}`, kind: 'link', mime: 'text/uri-list', name: l, size: l.length, data: Buffer.from(l) }
            attachments.set(a.id, a)
            attIds.push(a.id)
          }
        } else {
          const body = await readJson(req)
          text = body?.body
          kind = body?.kind
          mentionIds = (body?.mention_ids ?? []).map(String)
        }
        // UD-278: as the real API, the sender writes in the thread only to call someone, and the mentions are the ids picked in the list.
        mentionIds = [...new Set(mentionIds)]
        if (msg.author_id === me.id && mentionIds.length === 0) return fail(res, 403, 'El emisor de un mensaje no puede responderlo.', 'author_cannot_reply')
        for (const mid of mentionIds) {
          const to = members.find((x) => String(x.id) === mid)
          if (!to) return fail(res, 404, 'El miembro mencionado no existe.', 'not_found')
          if (to.id === me.id) return fail(res, 400, 'Una respuesta no menciona a quien la escribe.', 'mention_self')
          if (to.active === false) return fail(res, 400, 'El miembro mencionado está desactivado.', 'assignee_inactive')
        }
        if ((!String(text ?? '').trim() && attIds.length === 0) || !['answer', 'fix', 'clarification'].includes(kind ?? 'answer')) return fail(res, 422, 'Respuesta inválida', 'validation')
        const body = { body: text ?? '', kind: kind ?? 'answer' }
        const reply = { id: `r-${id()}`, message_id: msg.id, author_id: me.id, body: body.body.trim(), kind: body.kind, created_at: new Date().toISOString(), attachment_ids: attIds, mentions: mentionIds.map((x) => members.find((m) => String(m.id) === x).id) }
        replies.get(msg.id).push(reply)
        for (const to of reply.mentions) if (!msg.assignee_ids.includes(to)) msg.assignee_ids = [...msg.assignee_ids, to]
        syncStatus(msg)
        if (msg.author_id === me.id) msg.status = 'open' // a request of the sender is not an answer (UD-278)
        // The real API answers with the message and its thread (the panel reads the cache from it).
        return send(res, 201, { ...view(msg), replies: liveReplies(msg).map(replyView) })
      }
      if (m[2] === 'forward' && method === 'POST') {
        // UD-272: the same message, one more assignee and a notice of kind `forward` in its thread; the reason is required.
        const body = await readJson(req)
        const comment = String(body?.comment ?? '').trim()
        if (!comment) return fail(res, 400, 'Falta el motivo del reenvío.', 'forward_comment_required')
        const to = members.find((x) => String(x.id) === String(body?.member_id))
        if (!to) return fail(res, 404, 'El miembro no existe.', 'not_found')
        if (to.id === me.id) return fail(res, 400, 'Un mensaje no se reenvía a quien lo reenvía.', 'forward_to_self')
        if (to.active === false) return fail(res, 400, 'El miembro está desactivado.', 'assignee_inactive')
        if (msg.closed_at) return fail(res, 409, 'El mensaje está cerrado. Hay que reabrirlo para reenviarlo.', 'message_closed')
        replies.get(msg.id).push({ id: `r-${id()}`, message_id: msg.id, author_id: me.id, body: comment, kind: 'forward', forwarded_to: to.id, created_at: new Date().toISOString(), attachment_ids: [] })
        if (!msg.assignee_ids.includes(to.id)) msg.assignee_ids = [...msg.assignee_ids, to.id]
        syncStatus(msg)
        return send(res, 201, { ...view(msg), replies: liveReplies(msg).map(replyView) })
      }
      if (m[2] === 'close' && method === 'POST') {
        msg.closed_at = new Date().toISOString()
        syncStatus(msg)
        return send(res, 200, { id: msg.id, status: msg.status, closed_at: msg.closed_at })
      }
      if (m[2] === 'assessment' && method === 'PUT') {
        // UD-295: any person of the team changes the assessment by hand: the expectation, the Guards it touches and who holds the value.
        const body = await readJson(req)
        const area = areas.find((a) => a.id === msg.area_id)
        const a = (msg.assessment ??= { expectation: '', guards: [], estimates: null, by: null })
        if (body?.guards !== undefined && body.guards.some((id) => !(area?.guards ?? []).some((g) => g.id === id))) return fail(res, 400, 'Una Guardia no existe en el área del mensaje.', 'guard_invalid')
        if (body?.expectation !== undefined) a.expectation = String(body.expectation).trim()
        if (body?.guards !== undefined) a.guards = [...new Set(body.guards)].sort((x, y) => x - y)
        if (body?.value_holder !== undefined && a.estimates) a.estimates = { ...a.estimates, value_holder: body.value_holder }
        a.by = me?.id ?? null
        return send(res, 200, { ...view(msg), replies: liveReplies(msg).map(replyView) })
      }
      if (m[2] === 'reopen' && method === 'POST') {
        msg.closed_at = null
        syncStatus(msg)
        // As the real API: the reopened message says which state it went back to (answered when it has replies).
        return send(res, 200, { id: msg.id, status: msg.status, closed_at: null })
      }
    }

    // --- areas and templates
    if (path === '/areas' && method === 'GET') {
      const withDeleted = url.searchParams.get('include_deleted') === 'true'
      return send(res, 200, envelope(areas.filter((a) => withDeleted || !a.deleted_at).map((a) => ({ ...areaView(a), open_count: liveMessages().filter((x) => x.area_id === a.id && x.status === 'open').length, unresolved_count: liveMessages().filter((x) => x.area_id === a.id && x.status !== 'closed').length, template_count: templates.filter((t) => t.area_id === a.id && !t.deleted_at).length }))))
    }
    if (path === '/areas' && method === 'POST') {
      if (needEditor()) return
      const body = await readJson(req)
      if (!String(body?.title ?? '').trim()) return fail(res, 422, 'El título es obligatorio')
      const area = { id: `a-${id()}`, title: body.title.trim(), description: String(body.description ?? '').trim(), position: areas.length + 1, color: /^#[0-9a-fA-F]{6}$/.test(body.color ?? '') ? body.color.toLowerCase() : AREA_PALETTE[areas.length % AREA_PALETTE.length] }
      areas.push(area)
      return send(res, 201, area)
    }
    m = /^\/areas\/([^/]+)$/.exec(path)
    // Soft delete (UD-240): the area leaves the lists, its messages stay, POST /areas/:id/restore brings it back.
    if (m && method === 'DELETE') {
      if (needEditor()) return
      const area = areas.find((a) => a.id === m[1] && !a.deleted_at)
      if (!area) return fail(res, 404, 'No existe')
      if (url.searchParams.get('confirm') !== 'true') return fail(res, 400, 'Falta la confirmación.', 'confirmation_required')
      area.deleted_at = new Date().toISOString()
      return send(res, 204)
    }
    m = /^\/areas\/([^/]+)\/restore$/.exec(path)
    if (m && method === 'POST') {
      if (needEditor()) return
      const area = areas.find((a) => a.id === m[1])
      if (!area) return fail(res, 404, 'No existe')
      if (!area.deleted_at) return fail(res, 409, 'El área no está borrada.', 'not_deleted')
      area.deleted_at = null
      return send(res, 200, area)
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
      if (body.color !== undefined) {
        if (!/^#[0-9a-fA-F]{6}$/.test(body.color)) return fail(res, 400, 'El color debe ser #rrggbb', 'validation')
        area.color = body.color.toLowerCase()
      }
      if (body.escalation_member_id !== undefined) {
        if (body.escalation_member_id !== null && !members.some((x) => x.id === body.escalation_member_id && x.kind !== 'agent' && x.active)) return fail(res, 422, 'Quien decide debe ser una persona activa del equipo.')
        area.escalation_member_id = body.escalation_member_id
      }
      for (const key of ['execute_model', 'execute_model_light']) {
        if (body[key] === undefined) continue
        if (body[key] !== null && !['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1'].includes(body[key])) return fail(res, 400, 'El modelo no está en la lista.', 'model_invalid')
        area[key] = body[key]
      }
      if (body.guards !== undefined) {
        // UD-295: a Guard keeps its id when the list is rewritten; a new one takes the next.
        const known = new Set((area.guards ?? []).map((g) => g.id))
        let next = Math.max(0, ...(area.guards ?? []).map((g) => g.id)) + 1
        if (body.guards.some((g) => !String(g.text ?? '').trim())) return fail(res, 422, 'Cada Guardia lleva su texto.', 'guard_invalid')
        area.guards = body.guards.map((g) => ({ id: Number.isInteger(g.id) && known.has(g.id) ? g.id : next++, text: String(g.text).trim(), mechanism: String(g.mechanism ?? '').trim(), person: g.person === true }))
      }
      return send(res, 200, areaView(area))
    }
    m = /^\/areas\/([^/]+)\/templates(?:\/([^/]+))?$/.exec(path)
    if (m) {
      if (!areas.some((a) => a.id === m[1])) return fail(res, 404, 'No existe')
      if (method === 'GET' && !m[2]) return send(res, 200, envelope(templates.filter((t) => t.area_id === m[1] && (url.searchParams.get('include_deleted') === 'true' || !t.deleted_at))))
      if (needEditor()) return
      const body = method === 'DELETE' ? {} : await readJson(req)
      const check = (b) => {
        if (b.name !== undefined && (!String(b.name).trim() || String(b.name).length > 64)) return 'El nombre admite de 1 a 64 caracteres'
        if (b.description !== undefined && String(b.description).length > 1024) return 'La descripción admite hasta 1.024 caracteres'
        // The file itself is read by the server's own parser (H-3723): a frontmatter that does not compile is 422 with its reason.
        if (b.body_markdown !== undefined) {
          try {
            parseTemplate(String(b.body_markdown))
          } catch (error) {
            return error.message
          }
        }
        return null
      }
      if (method === 'POST' && !m[2]) {
        const err = check(body ?? {}) ?? (body?.name ? null : 'El nombre es obligatorio')
        if (err) return fail(res, 422, err)
        const t = { id: `t-${id()}`, area_id: m[1], name: body.name.trim(), description: String(body.description ?? '').trim(), body_markdown: String(body.body_markdown ?? ''), updated_at: new Date().toISOString(), deleted_at: null }
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
        if (url.searchParams.get('confirm') !== 'true') return fail(res, 400, 'Falta la confirmación.', 'confirmation_required')
        t.deleted_at = new Date().toISOString() // soft delete: POST /templates/:id/restore brings it back
        return send(res, 204)
      }
    }
    m = /^\/templates\/([^/]+)\/restore$/.exec(path)
    if (m && method === 'POST') {
      if (needEditor()) return
      const t = templates.find((x) => x.id === m[1])
      if (!t) return fail(res, 404, 'No existe')
      t.deleted_at = null
      return send(res, 200, t)
    }

    // --- team and settings
    if (path === '/members' && method === 'GET') return send(res, 200, envelope(members))
    // Adding a member: Editor only.
    if (path === '/members' && method === 'POST') {
      const body = await readJson(req)
      const email = String(body?.email ?? '').trim().toLowerCase()
      if (!email.includes('@') || !String(body?.name ?? '').trim()) return fail(res, 400, 'El correo y el nombre son obligatorios.', 'validation')
      if (members.some((x) => x.email === email)) return fail(res, 409, 'Ya existe un miembro con ese correo.', 'email_taken')
      if (body.password !== undefined && String(body.password).length < 15) return fail(res, 400, 'La contraseña es demasiado corta.', 'password_too_short')
      const fresh = { id: `u-${id()}`, email, name: String(body.name).trim(), role: body.role === 'editor' ? 'editor' : 'member', language: 'es-419', active: true, profile: String(body.profile ?? '') }
      members.push(fresh)
      return send(res, 201, fresh)
    }
    m = /^\/members\/([^/]+)$/.exec(path)
    if (m && method === 'PATCH') {
      const target = m[1] === 'me' ? me : members.find((x) => x.id === m[1])
      if (!target) return fail(res, 404, 'No existe')
      const body = await readJson(req)
      if (!body) return fail(res, 400, 'JSON inválido', 'bad_request')
      if (body.profile !== undefined) {
        // UD-288 and UD-287, as the API: the profile is a configured text, so only the Editor writes the profile of another member.
        if (!isEditor) return fail(res, 403, 'Requiere rol Editor', 'forbidden')
        if (String(body.profile).length > 4000) return fail(res, 400, 'El perfil admite hasta 4.000 caracteres.', 'validation')
        target.profile = String(body.profile)
      }
      if (body.language !== undefined) {
        if (target.id !== me.id) return fail(res, 403, 'El idioma es de cada cuenta', 'forbidden')
        if (!['es-419', 'en'].includes(body.language)) return fail(res, 400, 'El idioma debe ser es-419 o en.', 'validation')
        target.language = body.language
      }
      if (body.name !== undefined || body.email !== undefined) {
        if (body.name !== undefined) {
          if (!String(body.name).trim()) return fail(res, 400, 'El nombre no puede quedar vacío.', 'validation')
          target.name = String(body.name).trim()
        }
        if (body.email !== undefined) {
          const email = String(body.email).trim().toLowerCase()
          if (members.some((x) => x.id !== target.id && x.email === email)) return fail(res, 409, 'Ya existe un miembro con ese correo.', 'email_taken')
          target.email = email
        }
      }
      if (body.password !== undefined) {
        if (String(body.password).length < 15) return fail(res, 400, 'La contraseña es demasiado corta.', 'password_too_short')
      }
      if ((body.current_password === undefined) !== (body.new_password === undefined)) return fail(res, 400, 'Para cambiar la contraseña se envían la actual y la nueva.', 'password_pair_required')
      if (body.new_password !== undefined) {
        if (target.id !== me.id) return fail(res, 403, 'La contraseña propia se cambia desde Configuración', 'forbidden')
        if (String(body.current_password).length < 15) return fail(res, 401, 'La contraseña actual no es correcta.', 'invalid_credentials')
        if (String(body.new_password).length < 15) return fail(res, 400, 'La contraseña nueva es demasiado corta.', 'password_too_short')
      }
      if (body.active !== undefined) {
        if (!body.active && target.id === me.id) return fail(res, 409, 'No se puede desactivar la propia cuenta.', 'cannot_deactivate_self')
        if (!body.active && target.role === 'editor' && members.filter((x) => x.role === 'editor' && x.active && x.id !== target.id).length === 0) return fail(res, 409, 'El equipo conserva siempre un Editor activo.', 'last_editor')
        target.active = !!body.active
      }
      if (body.role !== undefined) {
        if (!['member', 'editor'].includes(body.role)) return fail(res, 422, 'Rol inválido', 'validation')
        target.role = body.role
      }
      return send(res, 200, target)
    }
    // Deleting a member (UD-240, UD-292): what they published stays under «Miembro eliminado», what is not published goes; `purge=true` takes everything.
    if (m && method === 'DELETE') {
      const target = members.find((x) => x.id === m[1])
      if (!target || target.removed) return fail(res, 404, 'No existe')
      if (url.searchParams.get('confirm') !== 'true') return fail(res, 400, 'La operación es destructiva y exige confirm=true en la dirección.', 'confirm_required')
      if (target.id === me.id) return fail(res, 409, 'No se puede eliminar la propia cuenta.', 'cannot_delete_self')
      if (target.role === 'editor' && target.active && members.filter((x) => x.role === 'editor' && x.active && x.id !== target.id).length === 0) return fail(res, 409, 'El equipo conserva siempre un Editor activo.', 'last_editor')
      const purge = url.searchParams.get('purge') === 'true'
      const ownInputs = [...inputs.values()].filter((i) => i.author_id === target.id)
      const ownMessages = messages.filter((x) => x.author_id === target.id)
      const ownReplies = [...replies.values()].flat().filter((r) => r.author_id === target.id)
      const kept = { inputs: 0, messages: 0, replies: 0 }
      let deleted
      if (purge) {
        deleted = { inputs: ownInputs.length, messages: ownMessages.length, replies: ownReplies.length }
        for (const i of ownInputs) inputs.delete(i.id)
        for (const x of ownMessages) replies.delete(x.id)
        messages.splice(0, messages.length, ...messages.filter((x) => x.author_id !== target.id))
        for (const x of messages) {
          const rest = (replies.get(x.id) ?? []).filter((r) => r.author_id !== target.id)
          replies.set(x.id, rest)
          x.assignee_ids = (x.assignee_ids ?? []).filter((a) => a !== target.id)
          syncStatus(x)
        }
      } else {
        let ghost = members.find((x) => x.removed)
        if (!ghost) { ghost = { id: 'u-removed', email: 'removed-member@members.invalid', name: 'Miembro eliminado', role: 'member', profile: '', language: 'es-419', active: false, removed: true }; members.push(ghost) }
        const unpublished = ownInputs.filter((i) => i.status !== 'published')
        for (const i of unpublished) inputs.delete(i.id)
        for (const i of ownInputs) if (i.status === 'published') i.author_id = ghost.id
        for (const x of ownMessages) x.author_id = ghost.id
        for (const r of ownReplies) r.author_id = ghost.id
        for (const x of messages) x.assignee_ids = (x.assignee_ids ?? []).filter((a) => a !== target.id)
        deleted = { inputs: unpublished.length, messages: 0, replies: 0 }
        kept.inputs = ownInputs.length - unpublished.length
        kept.messages = ownMessages.length
        kept.replies = ownReplies.length
      }
      members.splice(members.indexOf(target), 1)
      return send(res, 200, { member_id: target.id, deleted, kept })
    }
    if (path === '/settings/providers' && method === 'GET') {
      return send(res, 200, providersView())
    }
    if (path === '/settings/providers' && method === 'PATCH') {
      const body = await readJson(req)
      const slot = providers.find((p) => p.slot === body?.slot)
      if (!slot) return fail(res, 422, 'Función inexistente', 'validation')
      const provider = body.provider === undefined ? slot.provider : String(body.provider).trim()
      const model = body.model === undefined ? slot.model : String(body.model).trim()
      const conn = connections.get(provider)
      if (!provider || !model || !conn || !SLOT_PROVIDERS[slot.slot].includes(conn.kind)) return fail(res, 422, 'Proveedor o modelo inválidos para esa función', 'validation')
      // The server tests the combination before it applies it; a failure changes nothing.
      const check = simulateCheck({ hasKey: !!conn.key.source, model })
      stamp(conn, check)
      if (!check.ok) return checkFailure(res, check)
      slot.provider = provider
      slot.model = model
      return send(res, 200, providersView())
    }
    m = /^\/settings\/providers\/(text|vision|speech)\/check$/.exec(path)
    if (m && method === 'POST') {
      const slot = providers.find((p) => p.slot === m[1])
      const conn = connections.get(slot.provider)
      const check = simulateCheck({ hasKey: !!conn?.key.source, model: slot.model })
      if (conn) stamp(conn, check)
      return send(res, 200, { check, slot: slot.slot, provider: slot.provider, model: slot.model })
    }
    if (path === '/settings/connections' && method === 'GET') {
      return send(res, 200, { items: [...connections.values()].filter(listed).map(connectionView), presets: [...PRESETS, { name: 'other', label: 'Otro', kind: 'openai-compatible', base_url: null, suggested_model: null, structured: 'json_schema' }].map((p) => ({ ...p })) })
    }
    if (path === '/settings/connections' && method === 'POST') {
      const body = await readJson(req)
      if (!body || typeof body.api_key !== 'string' || !body.api_key.trim()) return fail(res, 422, 'Falta la clave', 'validation')
      const preset = body.preset && body.preset !== 'other' ? PRESETS.find((p) => p.name === body.preset) : null
      if (body.preset && body.preset !== 'other' && !preset) return fail(res, 404, 'Proveedor inexistente', 'not_found')
      const name = preset ? preset.name : String(body.name ?? '').trim()
      if (!NAME_RE.test(name)) return fail(res, 422, 'Nombre inválido', 'validation')
      const existing = connections.get(name)
      if (existing && (existing.custom || listed(existing))) return fail(res, 409, 'Ya existe una conexión con ese nombre', 'connection_exists')
      const baseUrl = preset ? preset.base_url : String(body.base_url ?? '').trim()
      if (!preset && !/^https?:\/\/[^\s]+$/.test(baseUrl)) return fail(res, 422, 'Dirección inválida', 'validation')
      const check = simulateCheck({ apiKey: body.api_key, model: body.model ? String(body.model) : preset?.suggested_model })
      if (!check.ok) return checkFailure(res, check)
      const conn = preset
        ? existing
        : { name, label: String(body.label ?? '').trim() || name, kind: 'openai-compatible', custom: true, base_url: baseUrl, structured: ['json_schema', 'tool', 'json_object'].includes(body.structured) ? body.structured : 'json_schema', key: {}, last_check: null }
      conn.key = { source: 'stored', last4: last4Of(body.api_key), updated_at: iso() }
      stamp(conn, check)
      connections.set(name, conn)
      return send(res, 201, { connection: connectionView(conn), check })
    }
    m = /^\/settings\/connections\/([^/]+)(\/key|\/check)?$/.exec(path)
    if (m) {
      const conn = connections.get(decodeURIComponent(m[1]))
      if (!conn || !listed(conn)) return fail(res, 404, 'Conexión inexistente', 'not_found')
      if (m[2] === '/key' && method === 'PUT') {
        const body = await readJson(req)
        if (!body || typeof body.api_key !== 'string' || !body.api_key.trim()) return fail(res, 422, 'Falta la clave', 'validation')
        const model = body.model ? String(body.model) : providers.find((p) => p.provider === conn.name)?.model
        const check = simulateCheck({ apiKey: body.api_key, model })
        if (!check.ok) return checkFailure(res, check) // the previous key stays
        conn.key = { source: 'stored', last4: last4Of(body.api_key), updated_at: iso() }
        stamp(conn, check)
        return send(res, 200, { connection: connectionView(conn), check })
      }
      if (m[2] === '/key' && method === 'DELETE') {
        const used = usedBy(conn.name)
        if (used.length) return send(res, 409, { code: 'provider_in_use', message: 'Una función depende de esta clave', used_by: used })
        if (conn.key.source === 'environment') return fail(res, 409, 'La clave viene del entorno del servidor', 'key_from_environment')
        conn.key = { source: null, last4: null, updated_at: null }
        conn.last_check = null
        return send(res, 200, { connection: connectionView(conn) })
      }
      if (m[2] === '/check' && method === 'POST') {
        const body = await readJson(req)
        const model = body?.model ? String(body.model) : (providers.find((p) => p.provider === conn.name)?.model ?? PRESETS.find((p) => p.name === conn.name)?.suggested_model)
        const check = simulateCheck({ hasKey: !!conn.key.source, model })
        stamp(conn, check)
        return send(res, 200, { check })
      }
      if (!m[2] && method === 'DELETE') {
        if (!conn.custom) return fail(res, 422, 'Sólo se eliminan los personalizados', 'validation')
        const used = usedBy(conn.name)
        if (used.length) return send(res, 409, { code: 'provider_in_use', message: 'Una función depende de este proveedor', used_by: used })
        connections.delete(conn.name)
        return send(res, 200, { deleted: true })
      }
    }
    // The text the server extracted from an audio or a video (the real server answers the same, from its `extracted_text`).
    m = /^\/(?:replies\/)?attachments\/([^/]+)\/transcript$/.exec(path)
    if (m && method === 'GET') {
      const a = attachments.get(m[1])
      if (!a || a.transcript === undefined) return fail(res, 404, 'No hay transcripción', 'not_found')
      return send(res, 200, { text: a.transcript })
    }
    m = /^\/(?:replies\/)?attachments\/([^/]+)$/.exec(path)
    if (m && method === 'GET') {
      const a = attachments.get(m[1])
      if (!a) return fail(res, 404, 'No existe')
      // Like the real server: `?download=1` asks for an attachment with the original name (RFC 5987), otherwise the file is shown inline.
      const disposition = url.searchParams.get('download') === '1' ? 'attachment' : 'inline'
      const head = { 'Content-Type': a.mime, 'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(a.name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`, 'Cache-Control': 'private, max-age=3600', 'Accept-Ranges': 'bytes' }
      // A video asks for the bytes it needs (`Range`): a server that answers the whole file to every range makes the browser ask again and again.
      const asked = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
      if (asked && (asked[1] || asked[2])) {
        const size = a.data.length
        const start = asked[1] ? Number(asked[1]) : Math.max(0, size - Number(asked[2]))
        const end = asked[1] && asked[2] ? Math.min(Number(asked[2]), size - 1) : size - 1
        if (start >= size || start > end) {
          res.writeHead(416, { ...head, 'Content-Range': `bytes */${size}` })
          return res.end()
        }
        res.writeHead(206, { ...head, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}` })
        return res.end(a.data.subarray(start, end + 1))
      }
      res.writeHead(200, { ...head, 'Content-Length': a.data.length })
      return res.end(a.data)
    }

    return fail(res, 404, 'Ruta inexistente')
  } catch (err) {
    console.error(err)
    if (!res.headersSent) fail(res, 500, 'Error interno del servidor doble')
    else res.end()
  }
})

// A test that starts this server holds its stdin: when the test process ends, however it ends, the pipe closes and the server leaves with it, so a killed run never leaves a server holding the port (H-901).
if (process.env.PANEL_DEV_EXIT_WITH_PARENT === '1') {
  process.stdin.resume()
  process.stdin.on('close', () => process.exit(0))
}

// No idle timeout on keep-alive connections: Node closes them after 5 s, and a client that reuses a connection at that very moment gets
// ECONNRESET («socket hang up»). Playwright's `route.fetch` keeps connections alive, and under load the fit test hit it on a different view each run.
server.keepAliveTimeout = 0
server.listen(PORT, '127.0.0.1', () => {
  // PANEL_DEV_PORT=0 asks the system for a free port; the line below says which one it got.
  console.log(`[dev-server] DEVELOPMENT DOUBLE SERVER with sample data at http://127.0.0.1:${server.address().port}${BASE}api${STATIC ? ' (also serves panel/dist)' : ''}`)
})
