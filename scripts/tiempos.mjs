#!/usr/bin/env node
// `tiempos`: lee el historial de ejecuciones del harness (tabla `execute_runs`, UD-262) sin sesión ni credenciales de la
// API. Abre la base en SOLO LECTURA: DB_PATH, o DATA_DIR/team.db (en el contenedor, DATA_DIR=/data).
//   docker exec <contenedor> node scripts/tiempos.mjs --resumen
// Con una copia de la base: DATA_DIR=/ruta/a/la/copia node scripts/tiempos.mjs --ultimos 20

import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { currentInstance, dayStart, instancesOf, listExecuteRuns, summarizeExecuteRuns } from '../src/telemetry/execute-runs.js'

export const AYUDA = `tiempos: tiempos, costos y resultado de las ejecuciones del harness, desde la base de la instancia (solo lectura).

Uso: node scripts/tiempos.mjs <consulta> [filtros] [--json]

Consultas:
  --ultimos N          tabla de las N ejecuciones más recientes (por omisión 20)
  --mensaje ID         las ejecuciones de un mensaje, con el detalle de cada una
  --resumen            promedio, p50 y p95 por fase, costo, entrega, "ya resuelto" y las 10 herramientas más lentas
Filtros:
  --desde AAAA-MM-DD   primer día incluido (día local del servidor)
  --hasta AAAA-MM-DD   último día incluido
  --instancia NOMBRE   una instancia concreta; por omisión la de la ejecución más reciente
  --todas              todas las instancias de la base
  --json               salida JSON en vez de tabla

Base: DB_PATH, o DATA_DIR/team.db (DATA_DIR=/data en el contenedor).`

const FASES = [
  ['queue_wait_ms', 'Cola'], ['first_reply_ms', 'Primera respuesta'], ['final_reply_ms', 'Respuesta final'], ['total_ms', 'Total'],
  ['create_ms', 'Crear máquina'], ['run_ms', 'Sesión'], ['destroy_ms', 'Destruir máquina'],
  ['tools_ms', 'Herramientas'], ['judge_ms', 'Juez'], ['delivery_ms', 'Entrega'], ['wait_ms', 'Espera']
]

const dec = (n, d = 1) => n.toFixed(d).replace('.', ',')
export const duracion = (ms) => {
  if (ms === null || ms === undefined) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 10000) return `${dec(ms / 1000)} s`
  if (ms < 60000) return `${Math.round(ms / 1000)} s`
  const min = Math.floor(ms / 60000)
  return `${min} min ${Math.round((ms % 60000) / 1000)} s`
}
const usd = (n) => (n === null || n === undefined ? '—' : dec(n, 2))
const pct = (r) => (r === null ? '—' : `${Math.round(r * 100)} %`)
const pad = (t, n, right = false) => (right ? String(t).padStart(n) : String(t).padEnd(n))
const fecha = (ms) => {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Tabla de texto: `cols` = [{ title, get, right }]. */
function tabla (rows, cols) {
  const cells = rows.map((r) => cols.map((c) => String(c.get(r))))
  const widths = cols.map((c, i) => Math.max(c.title.length, ...cells.map((row) => row[i].length)))
  const line = (row) => row.map((t, i) => pad(t, widths[i], cols[i].right)).join('  ').trimEnd()
  return [line(cols.map((c) => c.title)), ...cells.map(line)].join('\n')
}

const resultado = (r) => r.outcome ?? '—'
const entrega = (r) => (r.delivered === null ? '—' : (r.delivered ? 'sí' : 'no'))

function tablaUltimos (items) {
  return tabla(items, [
    { title: 'Inicio', get: (r) => fecha(r.started_at) }, { title: 'Mensaje', get: (r) => r.message_id ?? '—', right: true }, { title: 'Trabajo', get: (r) => r.job_id, right: true },
    { title: 'Resultado', get: (r) => (r.error_code ? `${resultado(r)} (${r.error_code})` : resultado(r)) },
    { title: 'Cola', get: (r) => duracion(r.queue_wait_ms), right: true }, { title: '1.ª resp.', get: (r) => duracion(r.first_reply_ms), right: true },
    { title: 'Final', get: (r) => duracion(r.final_reply_ms), right: true }, { title: 'Total', get: (r) => duracion(r.total_ms), right: true },
    { title: 'USD', get: (r) => usd(r.cost_usd), right: true }, { title: 'Entrega', get: entrega }
  ])
}

function detalle (r) {
  const filas = [
    ['Ejecución', `trabajo ${r.job_id}, intento ${r.attempt}, mensaje ${r.message_id ?? '—'}`],
    ['Instancia', r.instance || '—'], ['Inicio', fecha(r.started_at)], ['Resultado', r.error_code ? `${resultado(r)} (${r.error_code})` : resultado(r)],
    ['Modelo', r.model ?? '—'], ['Ejecutor', `${r.runner ?? '—'}${r.machine ? ` (${r.machine})` : ''}`],
    ['Sesión', r.session_id ?? '—'], ['Traza', r.trace_id ?? '—'], ['Transcripción', r.transcript_ref ?? '—'],
    ...FASES.map(([k, titulo]) => [titulo, duracion(r[k])]),
    ['Tokens', `entrada ${r.input_tokens ?? '—'}, salida ${r.output_tokens ?? '—'}, caché leída ${r.cache_read_tokens ?? '—'}, caché escrita ${r.cache_write_tokens ?? '—'}`],
    ['Costo', `${usd(r.cost_usd)} USD`], ['Turnos', `${r.turns ?? '—'}`], ['Herramientas', `${r.tool_count ?? '—'}`], ['Subagentes', `${r.subagent_count ?? '—'}`], ['Entrega', entrega(r)]
  ]
  const ancho = Math.max(...filas.map(([k]) => k.length))
  const lenta = r.slowest_tools.length ? `\n  Más lentas:\n${r.slowest_tools.map((t, i) => `    ${i + 1}. ${pad(duracion(t.duration_ms), 10, true)}  ${t.summary ?? t.name}${t.success === false ? ' (falló)' : ''}`).join('\n')}` : ''
  return filas.map(([k, v]) => `  ${pad(k, ancho)}  ${v}`).join('\n') + lenta
}

function textoResumen (s, contexto) {
  if (s.runs === 0) return `Sin ejecuciones${contexto}.`
  const cab = `Ejecuciones: ${s.runs}${contexto} · del ${fecha(s.from)} al ${fecha(s.to)} · con error: ${s.failed}`
  const fases = tabla(FASES.map(([k, titulo]) => ({ titulo, ...s.phases[k] })), [
    { title: 'Fase', get: (f) => f.titulo }, { title: 'n', get: (f) => f.n, right: true },
    { title: 'Promedio', get: (f) => duracion(f.avg), right: true }, { title: 'p50', get: (f) => duracion(f.p50), right: true }, { title: 'p95', get: (f) => duracion(f.p95), right: true }
  ])
  const lentas = s.slowest_tools.length
    ? `Herramientas más lentas\n${s.slowest_tools.map((t, i) => `  ${pad(i + 1, 2, true)}. ${pad(duracion(t.duration_ms), 10, true)}  ${t.summary ?? t.name}  (mensaje ${t.message_id ?? '—'}, trabajo ${t.job_id})`).join('\n')}`
    : 'Herramientas más lentas: sin datos'
  return [
    cab, '', fases, '',
    `Costo: medio ${usd(s.cost.avg_usd)} USD, total ${usd(s.cost.total_usd)} USD (${s.cost.n} ejecuciones con costo)`,
    `Tokens: entrada ${s.tokens.input}, salida ${s.tokens.output}, caché leída ${s.tokens.cache_read}`,
    `Entrega: ${s.delivery.delivered} de ${s.delivery.known} con dato (${pct(s.delivery.rate)})`,
    `Ya resuelto (resultado "investigated"): ${s.resolved.investigated} de ${s.resolved.runs} (${pct(s.resolved.rate)})`,
    '', lentas
  ].join('\n')
}

function parseArgs (argv) {
  const o = { ultimos: null, mensaje: null, resumen: false, desde: null, hasta: null, instancia: null, todas: false, json: false, ayuda: false }
  const valor = (i, flag) => {
    if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new Error(`${flag} necesita un valor.`)
    return argv[i + 1]
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--resumen') o.resumen = true
    else if (a === '--json') o.json = true
    else if (a === '--todas') o.todas = true
    else if (a === '--help' || a === '-h') o.ayuda = true
    else if (a === '--ultimos') {
      const v = argv[i + 1]
      if (v === undefined || v.startsWith('--')) o.ultimos = 20
      else { o.ultimos = Number(v); i++; if (!Number.isInteger(o.ultimos) || o.ultimos < 1) throw new Error('--ultimos necesita un entero positivo.') }
    } else if (a === '--mensaje') { o.mensaje = valor(i, a); i++; if (!/^\d+$/.test(o.mensaje)) throw new Error('--mensaje necesita el número del mensaje.') } else if (a === '--desde' || a === '--hasta') {
      const v = valor(i, a); i++
      if (dayStart(v) === null) throw new Error(`${a} necesita una fecha AAAA-MM-DD.`)
      o[a.slice(2)] = v
    } else if (a === '--instancia') { o.instancia = valor(i, a); i++ } else throw new Error(`Opción desconocida: ${a}`)
  }
  return o
}

export function dbPath (env) {
  return env.DB_PATH ? path.resolve(env.DB_PATH) : path.join(path.resolve(env.DATA_DIR ?? '/data'), 'team.db')
}

/** Ejecuta una consulta y devuelve { code, out, err } en vez de salir, para probarla sin proceso. */
export function runTiempos (argv, env = process.env) {
  let o
  try { o = parseArgs(argv) } catch (e) { return { code: 1, out: '', err: `tiempos: ${e.message}\n\n${AYUDA}` } }
  if (o.ayuda || (!o.ultimos && !o.mensaje && !o.resumen)) return { code: o.ayuda ? 0 : 1, out: AYUDA, err: '' }
  const file = dbPath(env)
  if (!existsSync(file)) return { code: 1, out: '', err: `tiempos: no existe la base ${file}. Fije DATA_DIR o DB_PATH.` }
  let db
  try {
    db = new DatabaseSync(file, { readOnly: true, timeout: 5000 })
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'execute_runs'").get()) {
      return { code: 1, out: '', err: 'tiempos: la base no tiene la tabla execute_runs. Falta la migración 0018: actualice la imagen y reinicie.' }
    }
    const instancia = o.todas ? null : (o.instancia ?? currentInstance(db))
    const otras = instancia === null ? 0 : instancesOf(db).filter((i) => i.instance !== instancia).reduce((a, i) => a + i.runs, 0)
    const filtros = { since: o.desde ? dayStart(o.desde) : null, until: o.hasta ? dayStart(o.hasta) + 24 * 3600 * 1000 : null, instance: instancia, messageId: o.mensaje }
    const contexto = instancia === null ? ' (todas las instancias)' : ` de la instancia ${instancia || 'sin nombre'}`
    const nota = otras > 0 ? `\nNo se cuentan ${otras} ejecuciones de otras instancias (--todas las incluye).` : ''
    if (o.resumen) {
      const s = summarizeExecuteRuns(db, filtros)
      return { code: 0, out: o.json ? JSON.stringify({ instance: instancia, ...s }, null, 2) : textoResumen(s, contexto) + nota, err: '' }
    }
    const { items, total } = listExecuteRuns(db, filtros, { limit: o.mensaje ? 200 : o.ultimos })
    if (o.json) return { code: 0, out: JSON.stringify({ instance: instancia, total, items }, null, 2), err: '' }
    if (items.length === 0) return { code: 0, out: `Sin ejecuciones${o.mensaje ? ` del mensaje ${o.mensaje}` : ''}${contexto}.${nota}`, err: '' }
    const cuerpo = o.mensaje ? items.map(detalle).join('\n\n') : tablaUltimos(items)
    const cola = !o.mensaje && total > items.length ? `\nMostrando ${items.length} de ${total}.` : ''
    return { code: 0, out: `${cuerpo}${cola}${nota}`, err: '' }
  } catch (e) {
    return { code: 1, out: '', err: `tiempos: ${e.message}` }
  } finally {
    db?.close()
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const r = runTiempos(process.argv.slice(2))
  if (r.out) process.stdout.write(`${r.out}\n`)
  if (r.err) process.stderr.write(`${r.err}\n`)
  process.exitCode = r.code
}
