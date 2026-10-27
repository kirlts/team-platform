#!/usr/bin/env node
// Derives the limits of the light model (`EXECUTE_LIGHT_LIMITS`) from judged jobs.
//
// Criterion (third audit of the method, 2026-10-27, H-5). The measurement of 2026-10-25 on the light model (docs/investigaciones/mediciones/) showed that the estimates of the analyzer do
// NOT separate the one failure from the closes: two tasks had the same estimates and different ends. So the criterion no longer asks the ranges of what closed and what failed to stay apart
// (with real noise they always cross and the limits would never leave their origin value). It is the one UD-295 cites from the routing literature (Triage, arXiv 2604.07494): the light
// model pays off where its rate of closing is higher than the ratio between its cost and the larger one's. Going light first costs c_l + (1 - p) c_s against c_s straight, so it pays when
// p > c_l / c_s. The rate is read with the lower end of a Wilson interval (`wilson`, area-method.mjs), so a handful of closes does not pass for a rate. The limit of a dimension is then the
// largest estimate such that the jobs at or below it (at or above it, for certainty) close at a rate whose lower end exceeds the ratio.
//
//   node scripts/light-limits.mjs jobs.jsonl [--min-jobs 20] [--cost-ratio 0.05]
//
// `jobs.jsonl`: one line per job of the light model, `{ job, closed, understand_vs_create, irreversibility, certainty }`, where `closed` is the stored fact of the job
// (`execute_judgments.closed`: it did not say it could not close, did not end blocked, left work on its branch and its delivery did not stay red) and the three numbers are the estimates
// of the message. `node scripts/light-jobs.mjs --db /data/team.db > jobs.jsonl` writes it from the database of the installation. The output is the value of the variable, with the
// dimensions that could not be fixed left at their origin value and the reason.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { wilson } from './area-method.mjs'

// The installation starts with limits that let everything through (`create=1 irreversibility=1 certainty=0`, src/config.js): the light model takes every message until a measurement says otherwise.
const ORIGIN = Object.freeze({ create: 1, irreversibility: 1, certainty: 0 })
// 20 judged jobs: the criterion of the measurement of 2026-10-25, which the first measurement of the light model could not meet with one job per task.
export const MIN_JOBS = 20
// Cost of the light model over the larger one: 0.05, from the published prices (Haiku 5.5 is 5 % of Sonnet 5.5 in input and output, read 2026-10-25 at platform.claude.com/docs/en/about-claude/pricing,
// UD-295). The cost of the CLI measured the same day was higher for Haiku (0.241 against 0.149 USD in T1, steps and minutes included): the installation that measures its own ratio passes it with --cost-ratio.
export const COST_RATIO = 0.05

const DIMENSIONS = [['create', 'understand_vs_create', 'above'], ['irreversibility', 'irreversibility', 'above'], ['certainty', 'certainty', 'below']]

/** The limits and, for each dimension, whether it was fixed and why not. `above`: the light model does not take it above the limit; `below`: not below it (certainty). */
export function deriveLightLimits (jobs, { minJobs = MIN_JOBS, costRatio = COST_RATIO } = {}) {
  const limits = { ...ORIGIN }
  const detail = {}
  if (jobs.length < minJobs) return { limits, detail: Object.fromEntries(DIMENSIONS.map(([name]) => [name, { fixed: false, reason: `${jobs.length} judged jobs, ${minJobs} needed` }])), jobs: jobs.length }
  for (const [name, field, side] of DIMENSIONS) {
    const values = [...new Set(jobs.map((j) => j[field]))].sort((a, b) => (side === 'above' ? a - b : b - a))
    let best = null
    for (const value of values) {
      const inside = jobs.filter((j) => (side === 'above' ? j[field] <= value : j[field] >= value))
      const w = wilson(inside.filter((j) => j.closed).length, inside.length)
      if (w.lower > costRatio) best = { value, n: inside.length, rate: w.p, lower: w.lower }
    }
    if (!best) { detail[name] = { fixed: false, reason: `at no limit does the light model close at a rate whose lower end exceeds the cost ratio ${costRatio}` }; continue }
    limits[name] = Math.round(best.value * 100) / 100
    detail[name] = { fixed: true, jobs_inside: best.n, closed_rate: Math.round(best.rate * 1000) / 1000, lower_end: Math.round(best.lower * 1000) / 1000, cost_ratio: costRatio }
  }
  return { limits, detail, jobs: jobs.length }
}

export const asVariable = (limits) => `create=${limits.create} irreversibility=${limits.irreversibility} certainty=${limits.certainty}`

function main (argv) {
  const [file, ...rest] = argv
  if (!file) { console.error('Uso: node scripts/light-limits.mjs jobs.jsonl [--min-jobs 20] [--cost-ratio 0.05]'); process.exit(2) }
  const flag = (name) => { const at = rest.indexOf(name); return at >= 0 ? Number(rest[at + 1]) : undefined }
  const jobs = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
  const result = deriveLightLimits(jobs, { ...(flag('--min-jobs') ? { minJobs: flag('--min-jobs') } : {}), ...(flag('--cost-ratio') ? { costRatio: flag('--cost-ratio') } : {}) })
  process.stdout.write(`${JSON.stringify({ EXECUTE_LIGHT_LIMITS: asVariable(result.limits), ...result }, null, 2)}\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2))
