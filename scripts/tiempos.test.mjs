// scripts/tiempos.mjs (UD-262): reads the history of runs from a database it opens read-only, without the API.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { migrate, openDatabase } from '../src/db/index.js'
import { recordExecuteRun } from '../src/telemetry/execute-runs.js'
import { duracion, runTiempos } from './tiempos.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
let dir
let env

const base = { attempt: 1, runner: 'machine', model: 'claude-sonnet-5-5', outcome: 'done', delivered: null, slowest_tools: [] }
before(() => {
  dir = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), 'tiempos-'))
  const db = openDatabase(path.join(dir, 'team.db'))
  migrate(db)
  const at = (d, h = 10) => new Date(2026, 9, d, h).getTime()
  recordExecuteRun(db, { ...base, job_id: 1, message_id: 31, instance: 'otra.example', started_at: at(2), finished_at: at(2, 11), total_ms: 3600000, cost_usd: 99, outcome: 'done' })
  recordExecuteRun(db, { ...base, job_id: 2, message_id: 40, instance: 'esta.example', started_at: at(20), finished_at: at(20, 11), queue_wait_ms: 5000, first_reply_ms: 41000, final_reply_ms: 600000, total_ms: 660000, create_ms: 30000, run_ms: 600000, destroy_ms: 9000, tools_ms: 120000, cost_usd: 1.5, turns: 12, tool_count: 20, subagent_count: 1, delivered: true, delivery_ms: 45000, transcript_ref: 'transcripts/2.jsonl', slowest_tools: [{ kind: 'tool', name: 'Bash', summary: 'Orden: npm test', duration_ms: 94000, success: true }] })
  recordExecuteRun(db, { ...base, job_id: 3, message_id: 41, instance: 'esta.example', started_at: at(21), finished_at: at(21, 11), total_ms: 1200000, cost_usd: 2.5, outcome: 'investigated', delivered: false })
  recordExecuteRun(db, { ...base, job_id: 4, message_id: 42, instance: 'esta.example', started_at: at(22), finished_at: at(22, 11), total_ms: 100000, cost_usd: null, outcome: 'failed', error_code: 'execute_timeout' })
  db.close()
  env = { DATA_DIR: dir }
})
after(() => rmSync(dir, { recursive: true, force: true }))

test('--ultimos prints a table of the latest runs of this instance, newest first, and leaves out other instances', () => {
  const r = runTiempos(['--ultimos', '2'], env)
  assert.equal(r.code, 0, r.err)
  const lines = r.out.split('\n')
  assert.match(lines[0], /^Inicio\s+Mensaje\s+Trabajo\s+Resultado\s+Cola/)
  assert.match(lines[1], /2026-10-22 10:00\s+42\s+4\s+failed \(execute_timeout\)/)
  assert.match(lines[2], /2026-10-21 10:00\s+41\s+3\s+investigated/)
  assert.match(r.out, /Mostrando 2 de 3\./)
  assert.match(r.out, /No se cuentan 1 ejecuciones de otras instancias/)
  assert.doesNotMatch(r.out, /\b31\b/)
})

test('--mensaje shows the detail of the runs of one message', () => {
  const r = runTiempos(['--mensaje', '40'], env)
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /trabajo 2, intento 1, mensaje 40/)
  assert.match(r.out, /Primera respuesta\s+41 s/)
  assert.match(r.out, /Total\s+11 min 0 s/)
  assert.match(r.out, /Transcripción\s+transcripts\/2\.jsonl/)
  assert.match(r.out, /1\. +1 min 34 s +Orden: npm test/)
  assert.match(runTiempos(['--mensaje', '999'], env).out, /Sin ejecuciones del mensaje 999/)
  assert.match(runTiempos(['--mensaje', '31'], env).out, /Sin ejecuciones del mensaje 31 de la instancia esta\.example/, 'a message of another instance is not shown')
})

test('--resumen gives the figures of the period and --desde narrows it', () => {
  const r = runTiempos(['--resumen'], env)
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /Ejecuciones: 3 de la instancia esta\.example .* con error: 1/)
  assert.match(r.out, /Total\s+3\s+/)
  assert.match(r.out, /Costo: medio 2,00 USD, total 4,00 USD \(2 ejecuciones con costo\)/)
  assert.match(r.out, /Entrega: 1 de 2 con dato \(50 %\)/)
  assert.match(r.out, /Ya resuelto \(resultado "investigated"\): 1 de 3 \(33 %\)/)
  assert.match(r.out, /1\. +1 min 34 s +Orden: npm test +\(mensaje 40, trabajo 2\)/)
  const since = runTiempos(['--resumen', '--desde', '2026-10-21'], env)
  assert.match(since.out, /Ejecuciones: 2 /)
  assert.match(runTiempos(['--resumen', '--desde', '2026-10-21', '--hasta', '2026-10-21'], env).out, /Ejecuciones: 1 /)
  const all = runTiempos(['--resumen', '--todas'], env)
  assert.match(all.out, /Ejecuciones: 4 \(todas las instancias\)/)
  assert.match(runTiempos(['--resumen', '--instancia', 'otra.example'], env).out, /Ejecuciones: 1 de la instancia otra\.example/)
})

test('--json prints the same data as JSON', () => {
  const s = JSON.parse(runTiempos(['--resumen', '--json'], env).out)
  assert.equal(s.runs, 3)
  assert.equal(s.instance, 'esta.example')
  assert.equal(s.phases.total_ms.p50, 660000)
  const l = JSON.parse(runTiempos(['--ultimos', '5', '--json'], env).out)
  assert.deepEqual(l.items.map((x) => x.job_id), [4, 3, 2])
  assert.equal(l.items[2].slowest_tools[0].duration_ms, 94000)
})

test('it opens the database read-only: the file does not change, and it needs no API credentials', async () => {
  const file = path.join(dir, 'team.db')
  const before = [statSync(file).mtimeMs, statSync(file).size, readFileSync(file).length]
  const cleanEnv = { PATH: process.env.PATH, DATA_DIR: dir }
  const { stdout } = await promisify(execFile)('node', ['scripts/tiempos.mjs', '--resumen'], { cwd: root, env: cleanEnv })
  assert.match(stdout, /Ejecuciones: 3/)
  assert.deepEqual([statSync(file).mtimeMs, statSync(file).size, readFileSync(file).length], before)
  const source = readFileSync(path.join(root, 'scripts/tiempos.mjs'), 'utf8')
  assert.match(source, /readOnly: true/)
  assert.doesNotMatch(source, /\b(INSERT|UPDATE|DELETE|DROP|ALTER)\b\s/, 'the script has no write statement')
})

test('errors say what to do: no database, no table, unknown option', () => {
  assert.match(runTiempos(['--resumen'], { DATA_DIR: path.join(dir, 'nada') }).err, /no existe la base/)
  assert.match(runTiempos(['--ultimos', 'x'], env).err, /entero positivo/)
  assert.match(runTiempos(['--desde', '2026-13-01', '--resumen'], env).err, /AAAA-MM-DD/)
  assert.match(runTiempos(['--foo'], env).err, /Opción desconocida/)
  assert.equal(runTiempos([], env).code, 1)
  assert.equal(runTiempos(['--help'], env).code, 0)
  const empty = openDatabase(path.join(dir, 'vieja.db'))
  empty.exec('CREATE TABLE jobs (id INTEGER)')
  empty.close()
  assert.match(runTiempos(['--resumen'], { DB_PATH: path.join(dir, 'vieja.db') }).err, /migración 0018/)
})

test('durations read as seconds and minutes', () => {
  assert.equal(duracion(null), '—')
  assert.equal(duracion(420), '420 ms')
  assert.equal(duracion(1500), '1,5 s')
  assert.equal(duracion(41000), '41 s')
  assert.equal(duracion(94000), '1 min 34 s')
})

test('the image carries the script', () => {
  const dockerfile = readFileSync(path.join(root, 'Dockerfile'), 'utf8')
  const runtime = dockerfile.slice(dockerfile.lastIndexOf('\nFROM '))
  assert.match(runtime, /^COPY scripts\/tiempos\.mjs \.\/scripts\/tiempos\.mjs$/m)
  const ignore = readFileSync(path.join(root, '.dockerignore'), 'utf8').split('\n')
  assert.ok(ignore.includes('!scripts/tiempos.mjs'), 'the build context lets it through')
})
