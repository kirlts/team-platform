// History of execute runs (UD-262): the row, its own retention, the figures of a period and the instance filter.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { migrate, openDatabase } from '../db/index.js'
import { pruneSpans } from './sqlite-exporter.js'
import { currentInstance, dayStart, instanceLabel, listExecuteRuns, percentile, pruneExecuteRuns, recordExecuteRun, summarizeExecuteRuns, updateExecuteRun } from './execute-runs.js'

const DAY = 24 * 3600 * 1000

function database () {
  const db = openDatabase(':memory:')
  migrate(db)
  return db
}

const run = (over = {}) => ({
  job_id: 1, attempt: 1, message_id: 10, instance: 'a.example', started_at: Date.UTC(2026, 9, 20, 12), finished_at: Date.UTC(2026, 9, 20, 12, 5),
  total_ms: 300000, run_ms: 280000, cost_usd: 1, outcome: 'done', delivered: null, slowest_tools: [], ...over
})

test('a run is one row per job and attempt; writing it again replaces it', () => {
  const db = database()
  recordExecuteRun(db, run({ cost_usd: 1 }))
  recordExecuteRun(db, run({ cost_usd: 2 }))
  recordExecuteRun(db, run({ attempt: 2 }))
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM execute_runs').get().n, 2)
  assert.equal(listExecuteRuns(db, {}).items.find((r) => r.attempt === 1).cost_usd, 2)
  assert.equal(updateExecuteRun(db, 1, 1, { final_reply_ms: 123, nonsense: 5 }), 1)
  assert.equal(listExecuteRuns(db, { messageId: 10 }).items.find((r) => r.attempt === 1).final_reply_ms, 123)
})

test('delivered keeps three states and only the ten slowest tools are kept', () => {
  const db = database()
  const tools = Array.from({ length: 14 }, (_, i) => ({ kind: 'tool', name: 'Bash', summary: `Orden ${i}`, duration_ms: 1000 * (14 - i), success: true }))
  recordExecuteRun(db, run({ job_id: 1, delivered: true, slowest_tools: tools }))
  recordExecuteRun(db, run({ job_id: 2, delivered: false }))
  recordExecuteRun(db, run({ job_id: 3, delivered: null }))
  const byJob = Object.fromEntries(listExecuteRuns(db, {}).items.map((r) => [r.job_id, r]))
  assert.deepEqual([byJob[1].delivered, byJob[2].delivered, byJob[3].delivered], [true, false, null])
  assert.equal(byJob[1].slowest_tools.length, 10)
  assert.equal(byJob[1].slowest_tools[0].duration_ms, 14000)
  assert.throws(() => db.prepare('UPDATE execute_runs SET delivered = 2 WHERE job_id = 1').run(), /CHECK/)
})

test('the history has its own retention: pruning spans at 7 days leaves the runs, and the runs go at EXECUTE_RUNS_RETENTION_DAYS', () => {
  const db = database()
  const now = Date.UTC(2026, 9, 22)
  recordExecuteRun(db, run({ job_id: 1, started_at: now - 30 * DAY }))
  recordExecuteRun(db, run({ job_id: 2, started_at: now - 400 * DAY }))
  recordExecuteRun(db, run({ job_id: 3, started_at: now - 2 * DAY }))
  pruneSpans(db, { now, retentionDays: 7 })
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM execute_runs').get().n, 3, 'the 7 days of the spans do not touch the runs')
  assert.equal(pruneExecuteRuns(db, { now, retentionDays: 365 }), 1)
  assert.deepEqual(listExecuteRuns(db, {}).items.map((r) => r.job_id).sort(), [1, 3])
  assert.equal(pruneExecuteRuns(db, { now, retentionDays: 7 }), 1, 'a shorter retention deletes more')
})

test('percentiles are nearest-rank; the summary gives average, p50 and p95 per phase', () => {
  assert.equal(percentile([], 0.5), null)
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2)
  assert.equal(percentile(Array.from({ length: 20 }, (_, i) => i + 1), 0.95), 19)
  const db = database()
  for (let i = 1; i <= 20; i++) recordExecuteRun(db, run({ job_id: i, total_ms: i * 1000, cost_usd: 0.5, outcome: i <= 5 ? 'investigated' : 'done' }))
  const s = summarizeExecuteRuns(db, {})
  assert.deepEqual(s.phases.total_ms, { n: 20, avg: 10500, p50: 10000, p95: 19000 })
  assert.deepEqual(s.phases.judge_ms, { n: 0, avg: null, p50: null, p95: null }, 'a phase nobody reported stays unknown')
  assert.deepEqual(s.cost, { n: 20, avg_usd: 0.5, total_usd: 10 })
  assert.deepEqual(s.resolved, { runs: 20, investigated: 5, rate: 0.25 })
  assert.deepEqual(s.delivery, { known: 0, delivered: 0, held: 0, rate: null })
})

test('the summary counts failures, delivery with data and the ten slowest tools of the period', () => {
  const db = database()
  recordExecuteRun(db, run({ job_id: 1, delivered: true, slowest_tools: [{ name: 'Bash', summary: 'Orden: npm test', duration_ms: 90000, success: true }] }))
  recordExecuteRun(db, run({ job_id: 2, delivered: false, outcome: 'failed', error_code: 'execute_timeout', cost_usd: null, slowest_tools: [{ name: 'Read', summary: 'Lectura: a.ts', duration_ms: 20, success: true }] }))
  recordExecuteRun(db, run({ job_id: 3, delivered: null }))
  const s = summarizeExecuteRuns(db, {})
  assert.equal(s.runs, 3)
  assert.equal(s.failed, 1)
  assert.deepEqual(s.delivery, { known: 2, delivered: 1, held: 0, rate: 0.5 })
  assert.deepEqual(s.cost, { n: 2, avg_usd: 1, total_usd: 2 })
  assert.deepEqual(s.slowest_tools.map((t) => [t.summary, t.job_id]), [['Orden: npm test', 1], ['Lectura: a.ts', 2]])
})

test('rows of other instances are left out; the default instance is the one of the latest run', () => {
  const db = database()
  recordExecuteRun(db, run({ job_id: 1, instance: 'old.example', started_at: Date.UTC(2026, 9, 1) }))
  recordExecuteRun(db, run({ job_id: 2, instance: 'new.example', started_at: Date.UTC(2026, 9, 2) }))
  assert.equal(currentInstance(db), 'new.example')
  assert.deepEqual(listExecuteRuns(db, { instance: 'new.example' }).items.map((r) => r.job_id), [2])
  assert.equal(summarizeExecuteRuns(db, { instance: 'old.example' }).runs, 1)
  assert.equal(summarizeExecuteRuns(db, {}).runs, 2)
  assert.equal(instanceLabel({ instanceName: 'x', publicUrl: 'https://a.example/team' }), 'x')
  assert.equal(instanceLabel({ instanceName: '', publicUrl: 'https://a.example/team' }), 'a.example')
  assert.equal(instanceLabel({ instanceName: '', publicUrl: '' }), 'local')
})

test('period filters take local days and a date that does not exist is null', () => {
  assert.equal(dayStart('2026-02-30'), null)
  assert.equal(dayStart('hoy'), null)
  assert.equal(dayStart('2026-10-22'), new Date(2026, 9, 22).getTime())
  const db = database()
  recordExecuteRun(db, run({ job_id: 1, started_at: new Date(2026, 9, 21, 23, 59).getTime() }))
  recordExecuteRun(db, run({ job_id: 2, started_at: new Date(2026, 9, 22, 0, 1).getTime() }))
  assert.deepEqual(listExecuteRuns(db, { since: dayStart('2026-10-22') }).items.map((r) => r.job_id), [2])
  assert.deepEqual(listExecuteRuns(db, { until: dayStart('2026-10-22') }).items.map((r) => r.job_id), [1])
})
