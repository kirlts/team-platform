// The day's spending cap of the `execute` jobs (UD-256), shared by the worker that enforces it and by the thread that hides «Reintentar» when it is spent.
import { all, get } from '../db/index.js'

/** Start of the server's local day (TZ; UTC when unset) that contains `t`, and the start of the next one. */
export function localDay (t) {
  const start = new Date(t)
  start.setHours(0, 0, 0, 0)
  const next = new Date(start)
  next.setDate(next.getDate() + 1)
  return { start: start.getTime(), next: next.getTime() }
}

/**
 * The daily spend cap (UD-256): what the `execute` jobs that ran today cost (`jobs.cost_usd`) plus the fixed cost of
 * each one that ran on a machine. A job counts on the day it started (`jobs.run_at` of its last attempt).
 */
export function dailyBudget (db, x, t) {
  const { start, next } = localDay(t)
  const row = get(db, "SELECT COALESCE(SUM(cost_usd), 0) AS cost, COALESCE(SUM(runner = 'machine'), 0) AS machines FROM jobs WHERE kind = 'execute' AND runner IS NOT NULL AND run_at >= ? AND run_at < ?", start, next)
  const spent = row.cost + row.machines * x.machineCostUsd
  return { spent, remaining: x.dailyBudgetUsd - spent, nextDayMs: next - t }
}

// UD-305: what a session that starts holds back from the day's cap comes from what the sessions of its model cost, not from a chosen number.
const RESERVE_PERCENTILE = 0.9 // UD-305, Martín's brief of 2026-10-25: the 90th percentile of the finished jobs
const RESERVE_WINDOW_MS = 7 * 24 * 3600 * 1000 // UD-305: the finished jobs of the last 7 days (a calendar span)
const RESERVE_MIN_SAMPLES = 10 // UD-305: the window grows backwards up to this many jobs; with fewer in all, the highest one

/** Nearest-rank percentile of a list of numbers; `p` in (0, 1]. */
export function percentile (values, p) {
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 0) return null
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]
}

/**
 * The reserve of one session (UD-305), in USD, with its basis:
 * `knob`      EXECUTE_SESSION_RESERVE_USD, when declared: it rules.
 * `measured`  the 90th percentile of `jobs.cost_usd` of the `execute` jobs of this model that ended in the last 7 days (at least the latest 10,
 *             whatever their age); with fewer than 10 in all, the highest of them.
 * `fallback`  no finished job of this model has a cost yet: EXECUTE_SESSION_RESERVE_FALLBACK_USD (declared courtesy, the value of UD-255).
 * A machine adds its fixed cost, which `jobs.cost_usd` does not hold and the day's cap counts.
 */
export function sessionReserve (db, x, model, t) {
  const machine = x.runner === 'machine' ? x.machineCostUsd : 0
  if (typeof x.sessionReserveUsd === 'number') return { usd: x.sessionReserveUsd + machine, basis: 'knob', samples: 0 }
  const since = t - RESERVE_WINDOW_MS
  const rows = all(db, "SELECT cost_usd, finished_at FROM jobs WHERE kind = 'execute' AND model = ? AND status IN ('done', 'failed') AND cost_usd > 0 ORDER BY finished_at DESC, id DESC", model)
  const recent = rows.filter((r) => r.finished_at >= since)
  const sample = (recent.length >= RESERVE_MIN_SAMPLES ? recent : rows.slice(0, RESERVE_MIN_SAMPLES)).map((r) => r.cost_usd)
  if (sample.length === 0) return { usd: x.sessionReserveFallbackUsd + machine, basis: 'fallback', samples: 0 }
  const usd = sample.length < RESERVE_MIN_SAMPLES ? Math.max(...sample) : percentile(sample, RESERVE_PERCENTILE)
  return { usd: usd + machine, basis: 'measured', samples: sample.length }
}

/**
 * Whether a session starts now (UD-305). `held` is what the sessions that run now hold. The first session always starts while something is left;
 * the others start only if the day leaves at least their reserve. The `--max-budget-usd` of the session stays its own cap (`maxBudgetUsd`, or what is
 * left when that is less): the reserve is what it is expected to spend, the cap is what it may.
 */
export function admitSession ({ remaining, held, sessions, reserveUsd, maxBudgetUsd }) {
  const available = remaining - held
  const need = sessions === 0 ? 0.01 : Math.min(reserveUsd, remaining)
  if (available < need) return { ok: false, available }
  const budgetUsd = Math.round(Math.min(maxBudgetUsd, available) * 100) / 100 || 0.01
  return { ok: true, available, budgetUsd, holdUsd: Math.min(reserveUsd, budgetUsd) }
}
