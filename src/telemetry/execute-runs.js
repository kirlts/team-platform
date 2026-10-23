// History of the `execute` runs (UD-262, MASTER-SPEC §7.10 bis): one row per run in `execute_runs`, written when the job
// closes, with the figures the span tree has only while `spans` is kept (7 days). Read by `GET /ops/execute-runs`, by the
// panel and by `scripts/tiempos.mjs`, which opens the database read-only. This module takes the connection it is given
// and opens nothing, so the script can use it without loading the server.

const MS_PER_DAY = 24 * 3600 * 1000 // calendar constant, not a tunable
export const SLOWEST_TOOLS_KEPT = 10 // UD-262: the ten slowest calls of a run
export const PHASES = ['queue_wait_ms', 'first_reply_ms', 'final_reply_ms', 'total_ms', 'create_ms', 'run_ms', 'destroy_ms', 'tools_ms', 'judge_ms', 'delivery_ms', 'wait_ms']

const COLUMNS = [
  'job_id', 'attempt', 'message_id', 'instance', 'trace_id', 'session_id', 'model', 'runner', 'machine', 'started_at', 'finished_at',
  ...PHASES, 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'cost_usd', 'turns', 'tool_count', 'subagent_count',
  'outcome', 'error_code', 'delivered', 'transcript_ref', 'slowest_tools_json', 'deliver_job_id', 'delivery_ref', 'delivery_held'
]
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : null)

/** The label this instance writes in each row: INSTANCE_NAME, else the host of PUBLIC_URL, else «local». */
export function instanceLabel (config) {
  if (config.instanceName) return config.instanceName
  try { return new URL(config.publicUrl).host || 'local' } catch { return 'local' }
}

/** Inserts the run of an attempt; a second write of the same attempt replaces the first. */
export function recordExecuteRun (db, run) {
  const row = { ...run, slowest_tools_json: JSON.stringify((run.slowest_tools ?? []).slice(0, SLOWEST_TOOLS_KEPT)) }
  const values = COLUMNS.map((c) => {
    const v = row[c] ?? null
    if (c === 'delivered' || c === 'delivery_held') return v === null ? null : (v ? 1 : 0)
    if (c === 'slowest_tools_json') return v ?? '[]'
    return typeof v === 'number' ? num(v) : v
  })
  db.prepare(`INSERT OR REPLACE INTO execute_runs (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(() => '?').join(', ')})`).run(...values)
}

/** Updates fields of a recorded run (the closing reply is known once the job commits). */
export function updateExecuteRun (db, jobId, attempt, fields) {
  const keys = Object.keys(fields).filter((k) => COLUMNS.includes(k))
  if (keys.length === 0) return 0
  return Number(db.prepare(`UPDATE execute_runs SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE job_id = ? AND attempt = ?`)
    .run(...keys.map((k) => fields[k] ?? null), jobId, attempt).changes)
}

/** Own retention, not the one of `spans`: EXECUTE_RUNS_RETENTION_DAYS (365 by default). */
export function pruneExecuteRuns (db, { now = Date.now(), retentionDays = 365 } = {}) {
  return Number(db.prepare('DELETE FROM execute_runs WHERE started_at < ?').run(now - retentionDays * MS_PER_DAY).changes)
}

/** «2026-10-22» → start of that local day in ms; null if it is not a date. */
export function dayStart (text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text ?? ''))
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d.getTime() : null
}

/** The instance of the most recent run: the default one to show, so a restored copy shows its own runs first. */
export function currentInstance (db) {
  return db.prepare('SELECT instance FROM execute_runs ORDER BY started_at DESC, id DESC LIMIT 1').get()?.instance ?? null
}

/** Instances present, with their count of runs. */
export function instancesOf (db) {
  return db.prepare('SELECT instance, COUNT(*) AS runs FROM execute_runs GROUP BY instance ORDER BY MAX(started_at) DESC').all().map((r) => ({ instance: r.instance, runs: r.runs }))
}

function where ({ since = null, until = null, messageId = null, instance = null, outcome = null }) {
  const parts = []
  const params = []
  if (since !== null) { parts.push('started_at >= ?'); params.push(since) }
  if (until !== null) { parts.push('started_at < ?'); params.push(until) }
  if (messageId !== null) { parts.push('message_id = ?'); params.push(Number(messageId)) }
  if (instance !== null) { parts.push('instance = ?'); params.push(instance) }
  if (outcome !== null) { parts.push('outcome = ?'); params.push(outcome) }
  return { sql: parts.length ? `WHERE ${parts.join(' AND ')}` : '', params }
}

/** A run as the API and the script show it. */
export function runView (r) {
  let slowest = []
  try { slowest = JSON.parse(r.slowest_tools_json ?? '[]') } catch { /* a damaged cell shows no tools */ }
  const { slowest_tools_json: _json, ...rest } = r
  return {
    ...rest, delivered: r.delivered === null ? null : r.delivered === 1, delivery_held: r.delivery_held === null || r.delivery_held === undefined ? null : r.delivery_held === 1, slowest_tools: slowest
  }
}

/** Runs newest first. `limit`/`offset` page them; `total` counts all that match. */
export function listExecuteRuns (db, filters = {}, { limit = 50, offset = 0 } = {}) {
  const w = where(filters)
  const total = db.prepare(`SELECT COUNT(*) AS n FROM execute_runs ${w.sql}`).get(...w.params).n
  const items = db.prepare(`SELECT * FROM execute_runs ${w.sql} ORDER BY started_at DESC, id DESC LIMIT ? OFFSET ?`).all(...w.params, limit, offset).map(runView)
  return { items, total }
}

/** Nearest-rank percentile of an ascending list; null if it is empty. */
export function percentile (sorted, p) {
  if (sorted.length === 0) return null
  return sorted[Math.min(sorted.length, Math.max(1, Math.ceil(p * sorted.length))) - 1]
}

function stats (values) {
  const v = values.filter((x) => typeof x === 'number').sort((a, b) => a - b)
  if (v.length === 0) return { n: 0, avg: null, p50: null, p95: null }
  return { n: v.length, avg: Math.round(v.reduce((a, b) => a + b, 0) / v.length), p50: percentile(v, 0.5), p95: percentile(v, 0.95) }
}

/**
 * Figures of a period: average, p50 and p95 of every phase, cost, delivery rate, rate of «already resolved»
 * (`outcome = 'investigated'` over all the runs of the period, failed ones included) and the ten slowest calls.
 */
export function summarizeExecuteRuns (db, filters = {}) {
  const w = where(filters)
  const rows = db.prepare(`SELECT * FROM execute_runs ${w.sql} ORDER BY started_at`).all(...w.params).map(runView)
  const costs = rows.map((r) => r.cost_usd).filter((c) => typeof c === 'number')
  const held = rows.filter((r) => r.delivery_held === true).length // waits for a person: neither delivered nor failed (UD-266)
  const known = rows.filter((r) => r.delivered !== null && r.delivery_held !== true)
  const delivered = known.filter((r) => r.delivered === true).length
  const investigated = rows.filter((r) => r.outcome === 'investigated').length
  const slowest = rows.flatMap((r) => (r.slowest_tools ?? []).map((t) => ({ ...t, job_id: r.job_id, message_id: r.message_id })))
    .sort((a, b) => b.duration_ms - a.duration_ms).slice(0, SLOWEST_TOOLS_KEPT)
  const sum = (key) => rows.reduce((a, r) => a + (r[key] ?? 0), 0)
  return {
    runs: rows.length,
    failed: rows.filter((r) => r.error_code).length,
    from: rows.length ? rows[0].started_at : null,
    to: rows.length ? rows.at(-1).started_at : null,
    phases: Object.fromEntries(PHASES.map((p) => [p, stats(rows.map((r) => r[p]))])),
    cost: { n: costs.length, avg_usd: costs.length ? Math.round((costs.reduce((a, b) => a + b, 0) / costs.length) * 1e4) / 1e4 : null, total_usd: Math.round(costs.reduce((a, b) => a + b, 0) * 1e4) / 1e4 },
    tokens: { input: sum('input_tokens'), output: sum('output_tokens'), cache_read: sum('cache_read_tokens'), cache_write: sum('cache_write_tokens') },
    delivery: { known: known.length, delivered, held, rate: known.length ? delivered / known.length : null },
    resolved: { runs: rows.length, investigated, rate: rows.length ? investigated / rows.length : null },
    slowest_tools: slowest
  }
}
