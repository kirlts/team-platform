// UD-305: what a session holds back of the day's cap is measured from the finished jobs of its model, and the knob rules when declared.
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { loadConfig } from '../config.js'
import { makeEnv } from '../testing/helpers.js'
import { admitSession, percentile, sessionReserve } from './budget.js'

const DAY = 24 * 3600 * 1000
const MODEL = 'claude-sonnet-5-5'

describe('session reserve (UD-305)', () => {
  let env
  const now = Date.now()
  const x = { runner: 'local', machineCostUsd: 0, sessionReserveUsd: null, sessionReserveFallbackUsd: 10, maxBudgetUsd: 10 }
  before(async () => { env = await makeEnv() })
  after(async () => { await env.close() })
  beforeEach(() => { env.db.prepare("DELETE FROM jobs WHERE kind = 'execute'").run() })
  const finished = (cost, { ago = DAY, model = MODEL, status = 'done' } = {}) => {
    const at = now - ago
    env.db.prepare("INSERT INTO jobs (kind, payload_json, status, run_at, created_at, finished_at, cost_usd, model) VALUES ('execute', '{}', ?, ?, ?, ?, ?, ?)").run(status, at, at, at, cost, model)
  }
  // Starts sessions one after the other against a day, as the worker does, and says how many fit.
  function fit (reserveUsd, dailyUsd) {
    const held = []
    for (let n = 1; n <= 1000; n++) {
      const a = admitSession({ remaining: dailyUsd, held: held.reduce((s, h) => s + h, 0), sessions: held.length, reserveUsd, maxBudgetUsd: 10 })
      if (!a.ok) return held.length
      held.push(a.holdUsd)
    }
    return held.length
  }

  it('the 90th percentile is the nearest rank', () => {
    assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9), 9)
    assert.equal(percentile([5], 0.9), 5)
    assert.equal(percentile([], 0.9), null)
  })

  it('with 4 jobs of 1 USD measured and 40 USD of budget, 40 sessions fit, 30 among them, and not the 4 that a reserve of 10 gave', () => {
    for (let i = 0; i < 4; i++) finished(1)
    const reserve = sessionReserve(env.db, x, MODEL, now)
    assert.deepEqual(reserve, { usd: 1, basis: 'measured', samples: 4 })
    assert.ok(fit(reserve.usd, 40) >= 30)
    assert.equal(fit(reserve.usd, 40), 40)
    assert.equal(fit(10, 40), 4, 'the old reserve: four sessions')
  })

  it('with fewer than 10 jobs it takes the highest; with 10 or more in the last 7 days, the 90th percentile', () => {
    for (const c of [0.5, 0.7, 3.1]) finished(c)
    assert.equal(sessionReserve(env.db, x, MODEL, now).usd, 3.1)
    env.db.prepare("DELETE FROM jobs WHERE kind = 'execute'").run()
    for (let i = 1; i <= 10; i++) finished(i / 10) // 0.1 .. 1.0
    finished(50, { ago: 8 * DAY }) // older than 7 days and not needed: the window already has 10
    assert.deepEqual(sessionReserve(env.db, x, MODEL, now), { usd: 0.9, basis: 'measured', samples: 10 })
  })

  it('a window with fewer than 10 jobs grows backwards up to the latest 10, whatever their age', () => {
    for (let i = 0; i < 3; i++) finished(1)
    for (let i = 0; i < 7; i++) finished(2, { ago: 9 * DAY })
    finished(40, { ago: 20 * DAY }) // the 11th: out
    const r = sessionReserve(env.db, x, MODEL, now)
    assert.equal(r.samples, 10)
    assert.equal(r.usd, 2)
  })

  it('only jobs of the same model with a measured cost count; unfinished and zero-cost ones do not', () => {
    finished(1)
    finished(30, { model: 'claude-haiku-5-5' })
    finished(30, { status: 'queued' })
    finished(0)
    assert.equal(sessionReserve(env.db, x, MODEL, now).usd, 1)
  })

  it('without any datum the declared fallback is used, and a machine adds its fixed cost', () => {
    assert.deepEqual(sessionReserve(env.db, x, MODEL, now), { usd: 10, basis: 'fallback', samples: 0 })
    assert.equal(sessionReserve(env.db, { ...x, runner: 'machine', machineCostUsd: 0.07 }, MODEL, now).usd, 10.07)
  })

  it('the knob EXECUTE_SESSION_RESERVE_USD rules over the measurement', () => {
    for (let i = 0; i < 4; i++) finished(1)
    assert.deepEqual(sessionReserve(env.db, { ...x, sessionReserveUsd: 5 }, MODEL, now), { usd: 5, basis: 'knob', samples: 0 })
    assert.equal(loadConfig({ ...process.env, EXECUTE_SESSION_RESERVE_USD: '2.5' }).execute.sessionReserveUsd, 2.5)
    assert.equal(loadConfig({ ...process.env, EXECUTE_SESSION_RESERVE_USD: '' }).execute.sessionReserveUsd, null)
    assert.equal(loadConfig({ ...process.env }).execute.sessionReserveFallbackUsd, 10)
  })

  it('the first session starts while anything is left, with its own cap; the next ones need their reserve', () => {
    const first = admitSession({ remaining: 0.5, held: 0, sessions: 0, reserveUsd: 3, maxBudgetUsd: 10 })
    assert.deepEqual(first, { ok: true, available: 0.5, budgetUsd: 0.5, holdUsd: 0.5 })
    assert.equal(admitSession({ remaining: 4, held: 2.5, sessions: 3, reserveUsd: 2, maxBudgetUsd: 10 }).ok, false)
    const ok = admitSession({ remaining: 4, held: 1, sessions: 1, reserveUsd: 2, maxBudgetUsd: 10 })
    assert.deepEqual(ok, { ok: true, available: 3, budgetUsd: 3, holdUsd: 2 })
  })
})
