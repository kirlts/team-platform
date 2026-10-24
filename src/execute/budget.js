// The day's spending cap of the `execute` jobs (UD-256), shared by the worker that enforces it and by the thread that hides «Reintentar» when it is spent.
import { get } from '../db/index.js'

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
