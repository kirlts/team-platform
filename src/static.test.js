// Prohibiciones estáticas del núcleo (docs/TEST.md): lo que no se puede escribir en este código. Cada una cita
// la restricción que protege.

import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { lex } from './testing/lex.js'
import { buildNotice, configureFlags, dockerfileArgs } from '../scripts/notice.mjs'

const src = path.dirname(fileURLToPath(import.meta.url))
const raiz = path.resolve(src, '..')
// Los módulos de otros agentes (analyze, extract, providers, telemetry) se verifican en sus propias baterías.
const PROPIOS = ['config.js', 'server.js', 'worker.js', 'log.js', 'db', 'queue', 'api', 'events', 'identity', 'domain', 'testing']

function listFiles (roots = PROPIOS) {
  const found = []
  const walk = (p) => {
    if (statSync(p).isDirectory()) readdirSync(p).forEach((f) => walk(path.join(p, f)))
    else if (/\.(m?js)$/.test(p)) found.push(p)
  }
  roots.forEach((r) => walk(path.join(src, r)))
  // Las pruebas del núcleo viven junto a su código y en la raíz de src.
  readdirSync(src).filter((f) => f.endsWith('.test.js')).forEach((f) => found.push(path.join(src, f)))
  return [...new Set(found)]
}

const esPrueba = (f) => f.endsWith('.test.js') || f.includes(`${path.sep}testing${path.sep}`)

test('HP-008 · los identificadores del código están en inglés (UD-005, §4.7)', () => {
  // Palabras en español que ya se usaron como identificador y se renombraron; sirven de red contra la reincidencia.
  const espanol = new Set(`miembro miembros trabajo trabajos adjunto adjuntos mensaje mensajes plantilla plantillas propuesta respuesta respuestas
    archivo archivos ruta rutas cola estado valor texto correo clave sesion sesiones fila filas nombre cuerpo campo campos limite limites salida
    entrada entorno servidor equipo usuario intento intentos paso pasos resultado resultados sistema sitio origen destino contexto contenido
    tamano linea lineas lista mapa modulo modulos opcion opciones orden pagina parche perfil razon registro reloj retorno segundos siguiente
    trozo vista vistas vigente vencidos ultimo ultima temporal todos nuevo nueva viejo vieja otro otra ahora antes hasta donde sin dos tres
    abrir cerrar crear borrar enviar recibir buscar guardar leer escribir esperar reclamado latido arriendo cupo presupuesto copia gancho firma`.split(/\s+/))
  const malos = []
  for (const f of listFiles()) {
    for (const t of lex(readFileSync(f, 'utf8'))) {
      if (t.type !== 'ident') continue
      if (/[^\x00-\x7F]/.test(t.value) || espanol.has(t.value.toLowerCase())) malos.push(`${path.relative(raiz, f)}: ${t.value}`)
    }
  }
  assert.deepEqual([...new Set(malos)], [])
})

test('HP-003 · ningún código decide con el texto que escribe una persona (§1.2, §4.2)', () => {
  const textoHumano = new Set(['text', 'body', 'title', 'message', 'description', 'profile', 'reply'])
  const metodos = new Set(['test', 'match', 'matchAll', 'includes', 'startsWith', 'endsWith', 'search', 'indexOf', 'localeCompare'])
  const hallazgos = []
  for (const f of listFiles(['domain', 'api', 'identity', 'queue', 'events']).filter((x) => !esPrueba(x))) {
    const tokens = lex(readFileSync(f, 'utf8')).filter((t) => t.type !== 'comment')
    tokens.forEach((t, i) => {
      if (t.type === 'ident' && textoHumano.has(t.value) && tokens[i + 1]?.value === '.' && metodos.has(tokens[i + 2]?.value) && tokens[i + 3]?.value === '(') {
        hallazgos.push(`${path.relative(raiz, f)}: ${t.value}.${tokens[i + 2].value}(`)
      }
    })
  }
  assert.deepEqual(hallazgos, [])
})

test('HP-005 · los mensajes sólo nacen de publicar una propuesta confirmada (§4.4, UD-003)', () => {
  const quienInserta = listFiles().filter((f) => !esPrueba(f) && /INSERT INTO messages\b/.test(readFileSync(f, 'utf8'))).map((f) => path.relative(src, f))
  assert.deepEqual(quienInserta, [path.join('domain', 'proposals.js')])
})

test('HP-007 · ninguna columna del esquema guarda una llave o un secreto en claro (§4.6)', () => {
  const sql = readdirSync(path.join(src, 'db', 'migrations')).map((f) => readFileSync(path.join(src, 'db', 'migrations', f), 'utf8')).join('\n')
  const columnas = [...sql.matchAll(/^\s{2}([a-z_]+)\s+(?:TEXT|INTEGER|REAL)\b/gm)].map((m) => m[1])
  assert.ok(columnas.length > 80)
  const sospechosas = columnas.filter((c) => /(api_?key|secret|passphrase|private)/i.test(c) || (/token/i.test(c) && !/_tokens$/.test(c)) || (/password/i.test(c) && c !== 'password_hash'))
  assert.deepEqual(sospechosas, [])
})

test('HP-011 · toda dependencia de producción tiene licencia compatible con MIT (§4.10, UD-004)', () => {
  const lock = JSON.parse(readFileSync(path.join(raiz, 'package-lock.json'), 'utf8'))
  const permitidas = /^(MIT|ISC|BSD-2-Clause|BSD-3-Clause|Apache-2\.0|0BSD|BlueOak-1\.0\.0|Python-2\.0|PSF-2\.0|Zlib|CC0-1\.0|Unlicense|MIT-0)$/
  // Excepción declarada: `sharp` (extractores) trae como binarios opcionales por plataforma libvips, con licencia
  // LGPL-3.0-or-later. Se enlaza de forma dinámica y se sustituye con otro libvips; la decisión de conservarla o
  // cambiar de biblioteca de imágenes es de quien es dueño de los extractores y de Martín (UD-004). Ver el informe final.
  const EXCEPCIONES = [/^node_modules\/@img\/sharp-/]
  const incompatibles = []
  let revisadas = 0
  for (const [location, p] of Object.entries(lock.packages)) {
    if (!location || p.dev || (p.optional && p.devOptional)) continue
    if (EXCEPCIONES.some((e) => e.test(location))) continue
    revisadas++
    // «A OR B» vale si alguna alternativa es compatible; «A AND B» exige todas.
    const licencia = String(p.license ?? '').replace(/[()]/g, '')
    const compatible = licencia !== '' && licencia.split(/\s+OR\s+/).some((alt) => alt.split(/\s+AND\s+/).every((l) => permitidas.test(l.trim())))
    if (!compatible) incompatibles.push(`${location}: ${p.license ?? 'sin licencia declarada'}`)
  }
  assert.ok(revisadas > 50)
  assert.deepEqual(incompatibles, [])
})

// Segunda capa de licencias (UD-020): lo que la imagen ejecuta o carga y no es un paquete de npm figura en NOTICE.
test('HP-011 · la excepción de @img/sharp-libvips-* está justificada en NOTICE, con la versión del lockfile', () => {
  const lock = JSON.parse(readFileSync(path.join(raiz, 'package-lock.json'), 'utf8'))
  const notice = readFileSync(path.join(raiz, 'NOTICE'), 'utf8')
  const libvips = Object.entries(lock.packages).filter(([location]) => /^node_modules\/@img\/sharp-libvips-/.test(location))
  assert.ok(libvips.length > 0)
  for (const [location, p] of libvips) {
    assert.equal(p.license, 'LGPL-3.0-or-later', `${location}: la excepción sólo cubre LGPL-3.0-or-later`)
    assert.ok(notice.includes(`@img/sharp-libvips-* ${p.version}`), `NOTICE no menciona @img/sharp-libvips-* ${p.version}`)
  }
  assert.match(notice, /LGPL-3\.0-or-later/)
  // El resto de la excepción (los enlaces nativos de sharp) sólo puede sumar licencias permisivas a la LGPL.
  const permisivas = /^(MIT|Apache-2\.0|LGPL-3\.0-or-later)$/
  for (const [location, p] of Object.entries(lock.packages)) {
    if (!/^node_modules\/@img\/sharp-(?!libvips)/.test(location)) continue
    const ok = String(p.license).replace(/[()]/g, '').split(/\s+(?:AND|OR)\s+/).every((l) => permisivas.test(l.trim()))
    assert.ok(ok, `${location}: ${p.license}`)
  }
})

test('HP-011 · NOTICE nombra ffmpeg con la versión y la suma que fija el Dockerfile, y está al día', () => {
  const dockerfile = readFileSync(path.join(raiz, 'Dockerfile'), 'utf8')
  const notice = readFileSync(path.join(raiz, 'NOTICE'), 'utf8')
  const a = dockerfileArgs(dockerfile)
  assert.match(a.FFMPEG_VERSION, /^\d+\.\d+(\.\d+)?$/)
  assert.ok(notice.includes(`FFmpeg ${a.FFMPEG_VERSION}`), 'NOTICE no nombra la versión de ffmpeg del Dockerfile')
  assert.ok(notice.includes(a.FFMPEG_SHA256), 'NOTICE no lleva la suma SHA-256 del Dockerfile')
  assert.ok(notice.includes(`https://ffmpeg.org/releases/ffmpeg-${a.FFMPEG_VERSION}.tar.xz`))
  assert.match(notice, /LGPL-2\.1-or-later/)
  assert.ok(notice.includes(`dav1d ${a.DAV1D_VERSION}`))
  assert.ok(notice.includes('libstdc++'))
  // Generado: `node scripts/notice.mjs` lo reescribe.
  assert.equal(notice, buildNotice(raiz), 'NOTICE está desactualizado: node scripts/notice.mjs')
})

test('HP-011 · ffmpeg se compila sin GPL: ni --enable-gpl, ni --enable-nonfree, ni --enable-version3, ni x264/x265', () => {
  const dockerfile = readFileSync(path.join(raiz, 'Dockerfile'), 'utf8')
  const flags = configureFlags(dockerfile)
  assert.ok(flags.includes('--disable-everything') && flags.includes('--enable-small'))
  for (const flag of flags) {
    assert.ok(!/^--enable-(gpl|nonfree|version3|libx264|libx265|libxvid|postproc)$/.test(flag), `la configuración de ffmpeg lleva ${flag}`)
  }
  // La imagen que se publica instala NOTICE donde la LGPL exige que viaje.
  assert.ok(dockerfile.includes('COPY NOTICE /usr/share/licenses/NOTICE'))
  assert.ok(dockerfile.includes('/usr/share/licenses/ffmpeg/'))
})

test('HP-006 · un contenedor y un volumen bastan: compose.yml declara un solo servicio (§4.5)', () => {
  const compose = readFileSync(path.join(raiz, 'compose.yml'), 'utf8').split('\n')
  const startAt = compose.findIndex((l) => /^services:\s*$/.test(l))
  assert.ok(startAt >= 0)
  const services = []
  for (const line of compose.slice(startAt + 1)) {
    if (/^\S/.test(line) && !/^\s*#/.test(line)) break // otra clave de primer nivel (volumes:)
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line)
    if (m) services.push(m[1])
  }
  assert.deepEqual(services, ['team-platform'])
})
