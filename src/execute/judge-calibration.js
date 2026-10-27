// Whether the job judge (judge.js) can be believed: its scores against the scores of people on the same jobs (second audit of the method, 2026-10-27, B3).
//
// A judgement moves an area to the larger model and fixes the limits of the light one (a person does it, reading the judgements). Until the judge has been compared with people it is an opinion
// of one model about the work of another. So a judgement is always shown, and counts for a decision only while the judge is calibrated: `judgmentsForDecisions` returns none otherwise, and the
// ones that are shown carry `calibrated: false` («sin calibrar»).
//
// The reference is a file of scores that people gave, without seeing the judge's, to jobs the judge also judged (EXECUTE_JUDGE_REFERENCE_FILE):
//   { "version": 1, "units": [ { "job_id": 12, "ratings": { "<person>": { "1.1": 1, "1.2": null, "2.1": 0, … }, "<other person>": { … } } } ] }
// A score is an integer from -2 to +2, or null when that person judged the indicator does not apply to that job. The judge's side comes from `execute_judgments`, by `job_id`: `applies: false` is null.
//
// The measure is Krippendorff's alpha (ordinal, the scale being ordered), per axis, over the people and the judge as raters. The interval is a bootstrap over jobs (a job's indicators are
// not independent of each other). An axis is calibrated when alpha reaches ALPHA_MIN and the lower end of its interval reaches ALPHA_FLOOR; the judge is calibrated when every axis the reference covers is,
// and the reference has at least two people (the agreement among people is the ceiling of what a judge can be asked: with one person there is no ceiling to read).
import { readFileSync, statSync } from 'node:fs'
import { all } from '../db/index.js'
import { AXES, KPIS } from './judge.js'

// Krippendorff, K. (2004), Content Analysis: An Introduction to Its Methodology, 2nd ed., Sage, p. 241: «rely only on variables with reliabilities above α = .800» and, where tentative
// conclusions are still acceptable, α ≥ .667. The same 0.80 is the bar the validation of an instrument of this kind sets for its raters.
export const ALPHA_MIN = 0.8
export const ALPHA_FLOOR = 0.667
// Bootstrap of the interval of alpha: Krippendorff (2011), «Computing Krippendorff's Alpha-Reliability», University of Pennsylvania ScholarlyCommons, and Hayes and Krippendorff (2007); the
// percentile method of Efron and Tibshirani (1993), the one the kappa of the rows already uses in this repository (1,000 resamples). The seed fixes the answer for the same reference.
export const BOOTSTRAP_RESAMPLES = 1000
export const BOOTSTRAP_SEED = 20261027 // declared courtesy: any fixed value; the date of the audit that asked for the calibration
export const INTERVAL_LEVEL = 0.95 // the conventional level of a confidence interval; the repository's kappa interval uses it too
const SCORES = Object.freeze([-2, -1, 0, 1, 2])
const AXIS_OF = Object.fromEntries(KPIS.map((k) => [k.id, k.axis]))

/** The pseudo-random generator of the bootstrap (mulberry32): a small deterministic one, so the same file gives the same interval. */
function generator (seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Krippendorff's alpha, ordinal metric. `units`: an array of arrays, each the values the raters gave one unit (null when a rater gave none). A unit with fewer than two values pairs
 * with nothing and is left out. Returns a number, or null when it is not defined (no pairable unit, or no variation at all: everyone said the same thing everywhere).
 */
export function krippendorffAlpha (units) {
  const index = new Map(SCORES.map((v, i) => [v, i]))
  const o = SCORES.map(() => SCORES.map(() => 0)) // coincidence matrix
  for (const unit of units) {
    const values = unit.filter((v) => index.has(v))
    const m = values.length
    if (m < 2) continue
    for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) if (i !== j) o[index.get(values[i])][index.get(values[j])] += 1 / (m - 1)
  }
  const marginal = o.map((row) => row.reduce((a, b) => a + b, 0))
  const n = marginal.reduce((a, b) => a + b, 0)
  if (n <= 1) return null
  const delta2 = (c, k) => {
    if (c === k) return 0
    const [lo, hi] = c < k ? [c, k] : [k, c]
    let between = 0
    for (let g = lo; g <= hi; g++) between += marginal[g]
    return (between - (marginal[lo] + marginal[hi]) / 2) ** 2
  }
  let observed = 0
  let expected = 0
  for (let c = 0; c < SCORES.length; c++) {
    for (let k = 0; k < SCORES.length; k++) {
      const d = delta2(c, k)
      observed += o[c][k] * d
      expected += marginal[c] * marginal[k] * d
    }
  }
  if (expected === 0) return null
  return 1 - (observed / n) / (expected / (n * (n - 1)))
}

/** The percentile interval of alpha, resampling `groups` (arrays of units: all the units of one job) with replacement. `[null, null]` when no resample has a defined alpha. */
export function alphaInterval (groups, { resamples = BOOTSTRAP_RESAMPLES, level = INTERVAL_LEVEL, seed = BOOTSTRAP_SEED } = {}) {
  const next = generator(seed)
  const draws = []
  for (let r = 0; r < resamples; r++) {
    const sample = []
    for (let i = 0; i < groups.length; i++) sample.push(...groups[Math.floor(next() * groups.length)])
    const a = krippendorffAlpha(sample)
    if (a !== null) draws.push(a)
  }
  if (draws.length === 0) return [null, null]
  draws.sort((x, y) => x - y)
  const at = (p) => draws[Math.min(draws.length - 1, Math.max(0, Math.floor(p * draws.length)))]
  return [at((1 - level) / 2), at(1 - (1 - level) / 2)]
}

const isScore = (v) => v === null || SCORES.includes(v)

/** The reference file, validated: `{ units: [{ job_id, ratings: { person: { kpiId: score|null } } }] }`. Throws an Error that says what is wrong. */
export function parseReference (text) {
  let file
  try { file = JSON.parse(text) } catch (error) { throw new Error(`it is not JSON (${error.message})`) }
  if (file?.version !== 1) throw new Error('«version» must be 1')
  if (!Array.isArray(file.units) || file.units.length === 0) throw new Error('«units» must be a non-empty list')
  const seen = new Set()
  for (const [i, u] of file.units.entries()) {
    if (!Number.isInteger(u?.job_id)) throw new Error(`units[${i}].job_id must be the id of a job`)
    if (seen.has(u.job_id)) throw new Error(`units[${i}].job_id ${u.job_id} is repeated`)
    seen.add(u.job_id)
    const people = Object.entries(u.ratings ?? {})
    if (people.length === 0) throw new Error(`units[${i}].ratings must name at least one person`)
    for (const [person, scores] of people) {
      for (const [id, score] of Object.entries(scores ?? {})) {
        if (!(id in AXIS_OF)) throw new Error(`units[${i}].ratings.${person} names «${id}», which is not an indicator`)
        if (!isScore(score)) throw new Error(`units[${i}].ratings.${person}.${id} must be an integer from -2 to 2, or null`)
      }
    }
  }
  return file
}

const judgeScores = (db, jobId) => {
  const row = all(db, 'SELECT scores_json FROM execute_judgments WHERE job_id = ?', jobId)[0]
  if (!row) return null
  try {
    const { kpis } = JSON.parse(row.scores_json)
    return Object.fromEntries(kpis.map((k) => [k.id, k.applies ? k.score : null]))
  } catch { return null }
}

/**
 * The calibration of the judge against a reference: `{ calibrated, reason, threshold, floor, people, jobs, axes: [{ axis, name, units, alpha, interval, alpha_people, calibrated }] }`.
 * `reason` says why not, in a sentence, when it is not calibrated. A job of the reference that the judge never judged is left out of the count and named.
 */
export function calibrationOf (db, reference) {
  const base = { threshold: ALPHA_MIN, floor: ALPHA_FLOOR, people: 0, jobs: 0, axes: [] }
  if (!reference) return { ...base, calibrated: false, reason: 'No file of judgements by people is declared (EXECUTE_JUDGE_REFERENCE_FILE): the judge was never compared with anyone.' }
  const people = [...new Set(reference.units.flatMap((u) => Object.keys(u.ratings)))].sort()
  const joined = reference.units.map((u) => ({ u, judge: judgeScores(db, u.job_id) })).filter((x) => x.judge !== null)
  const result = { ...base, people: people.length, jobs: joined.length }
  if (people.length < 2) return { ...result, calibrated: false, reason: 'The reference has fewer than two people: the agreement among people is the ceiling of what the judge can be asked, and with one person it cannot be read.' }
  if (joined.length === 0) return { ...result, calibrated: false, reason: 'None of the jobs of the reference has a judgement of the judge.' }
  const axes = AXES.map(({ axis, name }) => {
    const ids = KPIS.filter((k) => k.axis === axis).map((k) => k.id)
    // One group per job, one unit per indicator: the values of the judge and then those of each person.
    const groups = joined.map(({ u, judge }) => ids.map((id) => [judge[id] ?? null, ...people.map((p) => u.ratings[p]?.[id] ?? null)]))
    const units = groups.flat()
    const peopleOnly = groups.map((g) => g.map((unit) => unit.slice(1)))
    const alpha = krippendorffAlpha(units)
    const interval = alphaInterval(groups)
    const covered = units.some((unit) => unit.filter((v) => v !== null).length >= 2)
    const calibrated = alpha !== null && interval[0] !== null && alpha >= ALPHA_MIN && interval[0] >= ALPHA_FLOOR
    return { axis, name, units: units.filter((unit) => unit.filter((v) => v !== null).length >= 2).length, covered, alpha, interval, alpha_people: krippendorffAlpha(peopleOnly.flat()), calibrated }
  })
  const covered = axes.filter((a) => a.covered)
  const failing = covered.filter((a) => !a.calibrated)
  const calibrated = covered.length > 0 && failing.length === 0
  const reason = calibrated ? null : covered.length === 0
    ? 'No indicator of the reference was scored by two raters at once.'
    : `Alpha stays under ${ALPHA_MIN} (or its interval under ${ALPHA_FLOOR}) in the axes ${failing.map((a) => a.axis).join(', ')}.`
  return { ...result, axes: axes.map(({ covered: _covered, ...a }) => a), calibrated, reason }
}

// The answer for the same file and the same number of judgements is the same: the bootstrap is not run again on every request.
let memo = { key: null, value: null }

/** The calibration of this instance: the reference named by EXECUTE_JUDGE_REFERENCE_FILE against the judgements stored. A file that cannot be read or does not fit says so as the reason; it never throws. */
export function judgeCalibration (db, config) {
  const file = config.execute.judgeReferenceFile
  if (!file) return calibrationOf(db, null)
  let key
  try {
    const stat = statSync(file)
    const count = all(db, 'SELECT COUNT(*) AS n, COALESCE(MAX(id), 0) AS last FROM execute_judgments')[0]
    key = `${file}:${stat.mtimeMs}:${count.n}:${count.last}`
  } catch (error) {
    return { ...calibrationOf(db, null), reason: `The file of judgements by people cannot be read (${error.code ?? error.message}).` }
  }
  if (memo.key === key) return memo.value
  let value
  try { value = calibrationOf(db, parseReference(readFileSync(file, 'utf8'))) } catch (error) { value = { ...calibrationOf(db, null), reason: `EXECUTE_JUDGE_REFERENCE_FILE (${file}): ${error.message}` } }
  memo = { key, value }
  return value
}

/**
 * The judgements that may move an area to the larger model or fix the limits of the light one: all of them while the judge is calibrated, none otherwise. Every consumer that decides something
 * from judgements goes through here; the ones that only show them take them as they are, marked.
 */
export function judgmentsForDecisions (judgments, calibration) {
  return calibration?.calibrated === true ? judgments : []
}
