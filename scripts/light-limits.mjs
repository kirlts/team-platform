#!/usr/bin/env node
// Derives the limits of the light model (`EXECUTE_LIGHT_LIMITS`) from judged jobs, with the criterion written in docs/investigaciones/mediciones/2026-10-25-los-limites-del-modelo-ligero.md:
// the limit of a dimension is the middle value between the largest estimate of what the light model closed and the smallest estimate of what it did not close, and it is fixed only
// when those two ranges do not cross and there are at least 20 judged jobs.
//
//   node scripts/light-limits.mjs jobs.jsonl [--min-jobs 20]
//
// `jobs.jsonl`: one line per job of the light model, `{ job, closed, understand_vs_create, irreversibility, certainty }`, where `closed` is whether the light attempt closed the work (its
// judgement is not `no_cerro`) and the three numbers are the estimates of the message. Collecting that file from the installation is a manual step: the method has no script that
// reads the judgements out of the database. The output is the value of the variable, with the dimensions that could not be fixed left at their origin value and the reason.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// The installation starts with limits that let everything through (`create=1 irreversibility=1 certainty=0`, src/config.js): the light model takes every message until a measurement says otherwise.
const ORIGIN = Object.freeze({ create: 1, irreversibility: 1, certainty: 0 })
// 20 judged jobs: the criterion of the measurement of 2026-10-25, which the first measurement of the light model could not meet with one job per task.
export const MIN_JOBS = 20

const DIMENSIONS = [['create', 'understand_vs_create', 'above'], ['irreversibility', 'irreversibility', 'above'], ['certainty', 'certainty', 'below']]

/** The limits and, for each dimension, whether it was fixed and why not. `above`: the light model does not take it above the limit; `below`: not below it (certainty). */
export function deriveLightLimits (jobs, { minJobs = MIN_JOBS } = {}) {
  const limits = { ...ORIGIN }
  const detail = {}
  if (jobs.length < minJobs) return { limits, detail: Object.fromEntries(DIMENSIONS.map(([name]) => [name, { fixed: false, reason: `${jobs.length} judged jobs, ${minJobs} needed` }])), jobs: jobs.length }
  for (const [name, field, side] of DIMENSIONS) {
    const closed = jobs.filter((j) => j.closed).map((j) => j[field])
    const open = jobs.filter((j) => !j.closed).map((j) => j[field])
    if (!closed.length || !open.length) { detail[name] = { fixed: false, reason: closed.length ? 'every job closed: nothing to separate' : 'no job closed: nothing to separate' }; continue }
    const inner = side === 'above' ? [Math.max(...closed), Math.min(...open)] : [Math.min(...closed), Math.max(...open)]
    const crossed = side === 'above' ? inner[0] >= inner[1] : inner[0] <= inner[1]
    if (crossed) { detail[name] = { fixed: false, reason: `the ranges cross: the light model closed up to ${inner[0]} and failed from ${inner[1]}` }; continue }
    limits[name] = Math.round(((inner[0] + inner[1]) / 2) * 100) / 100
    detail[name] = { fixed: true, closed_edge: inner[0], failed_edge: inner[1] }
  }
  return { limits, detail, jobs: jobs.length }
}

export const asVariable = (limits) => `create=${limits.create} irreversibility=${limits.irreversibility} certainty=${limits.certainty}`

function main (argv) {
  const [file, ...rest] = argv
  if (!file) { console.error('Uso: node scripts/light-limits.mjs jobs.jsonl [--min-jobs 20]'); process.exit(2) }
  const at = rest.indexOf('--min-jobs')
  const jobs = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
  const result = deriveLightLimits(jobs, at >= 0 ? { minJobs: Number(rest[at + 1]) } : {})
  process.stdout.write(`${JSON.stringify({ EXECUTE_LIGHT_LIMITS: asVariable(result.limits), ...result }, null, 2)}\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2))
