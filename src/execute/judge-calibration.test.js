// B3 of the second audit of the method: the job judge counts for a decision only while it has been compared with people. Krippendorff's alpha (ordinal) per axis between the judge and the
// people, an interval by bootstrap over jobs, a threshold with its source, and the rule that a judgement of an uncalibrated judge is shown marked and decides nothing.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { run } from '../db/index.js'
import { makeEnv } from '../testing/helpers.js'
import { ALPHA_FLOOR, ALPHA_MIN, alphaInterval, calibrationOf, judgeCalibration, judgmentsForDecisions, krippendorffAlpha, parseReference } from './judge-calibration.js'
import { AXES, KPIS, axisScores, judgmentOfMessage, judgmentsOfMessage } from './judge.js'

// A small deterministic generator for the data of the tests (not the one of the bootstrap).
const rng = (seed) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }
const SCALE = [-2, -1, 0, 1, 2]

/** Alpha from its definition, on the values and not on the coincidence matrix: the independent check of the implementation. */
function bruteForceAlpha (units) {
  const pairable = units.map((u) => u.filter((v) => v !== null)).filter((u) => u.length >= 2)
  const pooled = pairable.flat()
  const n = pooled.length
  const count = (v) => pooled.filter((x) => x === v).length
  const delta2 = (a, b) => {
    if (a === b) return 0
    const [lo, hi] = a < b ? [a, b] : [b, a]
    let between = 0
    for (const v of SCALE) if (v >= lo && v <= hi) between += count(v)
    return (between - (count(lo) + count(hi)) / 2) ** 2
  }
  let observed = 0
  for (const u of pairable) for (let i = 0; i < u.length; i++) for (let j = 0; j < u.length; j++) if (i !== j) observed += delta2(u[i], u[j]) / (u.length - 1)
  let expected = 0
  for (let p = 0; p < n; p++) for (let q = 0; q < n; q++) if (p !== q) expected += delta2(pooled[p], pooled[q])
  return 1 - (observed / n) / (expected / (n * (n - 1)))
}

describe('Krippendorff alpha, ordinal', () => {
  it('matches its definition on data with three raters and missing values', () => {
    const next = rng(7)
    const units = Array.from({ length: 60 }, () => Array.from({ length: 3 }, () => (next() < 0.2 ? null : SCALE[Math.floor(next() * 5)])))
    assert.ok(Math.abs(krippendorffAlpha(units) - bruteForceAlpha(units)) < 1e-9)
    const near = Array.from({ length: 60 }, () => { const v = SCALE[Math.floor(next() * 5)]; return [v, next() < 0.8 ? v : SCALE[Math.floor(next() * 5)], next() < 0.1 ? null : v] })
    assert.ok(Math.abs(krippendorffAlpha(near) - bruteForceAlpha(near)) < 1e-9)
  })

  it('is 1 for raters that always agree, near 0 for raters that do not look at the work, and negative for raters that disagree on purpose', () => {
    const next = rng(11)
    const values = Array.from({ length: 200 }, () => SCALE[Math.floor(next() * 5)])
    assert.equal(krippendorffAlpha(values.map((v) => [v, v, v])), 1)
    const independent = krippendorffAlpha(values.map((v) => [v, SCALE[Math.floor(next() * 5)], SCALE[Math.floor(next() * 5)]]))
    assert.ok(Math.abs(independent) < 0.25, `alpha ${independent}`)
    assert.ok(krippendorffAlpha(values.map((v) => [v, -v])) < -0.5)
  })

  it('is not defined without a pairable unit or without any variation, and the ordinal metric counts a near miss as closer than a far one', () => {
    assert.equal(krippendorffAlpha([]), null)
    assert.equal(krippendorffAlpha([[1, null], [null, 2]]), null, 'no unit has two values')
    assert.equal(krippendorffAlpha([[1, 1], [1, 1]]), null, 'everyone said the same thing everywhere')
    const base = [[-2, -2], [-1, -1], [0, 0], [1, 1], [2, 2]]
    const near = krippendorffAlpha([...base, [0, 1]])
    const far = krippendorffAlpha([...base, [-2, 2]])
    assert.ok(near > far, `${near} > ${far}`)
  })

  it('the interval is the same for the same data, brackets alpha for a set that agrees partly, and is wider with fewer jobs', () => {
    const next = rng(3)
    const jobs = (n) => Array.from({ length: n }, () => Array.from({ length: 3 }, () => { const v = SCALE[Math.floor(next() * 5)]; return [v, next() < 0.6 ? v : SCALE[Math.floor(next() * 5)]] }))
    const many = jobs(40)
    const [lo, hi] = alphaInterval(many)
    assert.deepEqual(alphaInterval(many), [lo, hi])
    const alpha = krippendorffAlpha(many.flat())
    assert.ok(lo <= alpha && alpha <= hi, `${lo} ≤ ${alpha} ≤ ${hi}`)
    const [slo, shi] = alphaInterval(many.slice(0, 6))
    assert.ok(shi - slo > hi - lo, 'fewer jobs, a wider interval')
    assert.deepEqual(alphaInterval([]), [null, null])
  })

  it('the threshold is the one of its source: 0.80, and 0.667 for the lower end of the interval', () => {
    assert.equal(ALPHA_MIN, 0.8)
    assert.equal(ALPHA_FLOOR, 0.667)
  })
})

describe('the reference file', () => {
  const good = { version: 1, units: [{ job_id: 3, ratings: { ana: { '1.1': 1, '4.3': null }, luis: { '1.1': 0 } } }] }
  it('is validated: the version, the jobs, the persons and the scores', () => {
    assert.deepEqual(parseReference(JSON.stringify(good)), good)
    assert.throws(() => parseReference('no'), /not JSON/)
    assert.throws(() => parseReference(JSON.stringify({ ...good, version: 2 })), /version/)
    assert.throws(() => parseReference(JSON.stringify({ version: 1, units: [] })), /non-empty/)
    assert.throws(() => parseReference(JSON.stringify({ version: 1, units: [{ job_id: 'x', ratings: {} }] })), /job_id/)
    assert.throws(() => parseReference(JSON.stringify({ version: 1, units: [good.units[0], good.units[0]] })), /repeated/)
    assert.throws(() => parseReference(JSON.stringify({ version: 1, units: [{ job_id: 1, ratings: { ana: { '9.9': 1 } } }] })), /not an indicator/)
    assert.throws(() => parseReference(JSON.stringify({ version: 1, units: [{ job_id: 1, ratings: { ana: { '1.1': 3 } } }] })), /from -2 to 2/)
    assert.throws(() => parseReference(JSON.stringify({ version: 1, units: [{ job_id: 1, ratings: {} }] })), /at least one person/)
  })
})

describe('the calibration of the judge', () => {
  let env, dir
  const jobs = 24
  // The judge's score of each job and indicator is stored as a judgement of that job. `judgeOf(job, id)` gives it.
  const next = rng(5)
  const truth = Array.from({ length: jobs }, () => Object.fromEntries(KPIS.map((k) => [k.id, SCALE[Math.floor(next() * 5)]])))
  const noisy = (rate) => (job) => Object.fromEntries(KPIS.map((k) => [k.id, next() < rate ? SCALE[Math.floor(next() * 5)] : truth[job][k.id]]))
  const store = (judge) => {
    run(env.db, 'DELETE FROM execute_judgments')
    truth.forEach((_, job) => {
      const kpis = KPIS.map((k) => ({ id: k.id, applies: k.id !== '4.3', score: judge(job)[k.id], quote: 'q', claim: 'c', reasoning: 'r' }))
      run(env.db, 'INSERT INTO execute_judgments (job_id, message_id, judge_model, worked_with, quadrant, scores_json, summary, cost_usd, created_at) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)',
        100 + job, 'claude-haiku-5-5', 'claude-haiku-5-5', 'execute', JSON.stringify({ kpis, axes: axisScores(kpis, 'execute') }), 's', 0, 1000 + job)
    })
  }
  const reference = (people) => ({ version: 1, units: truth.map((_, job) => ({ job_id: 100 + job, ratings: Object.fromEntries(people.map(([name, rate]) => [name, noisy(rate)(job)])) })) })

  before(async () => {
    env = await makeEnv({})
    env.db.exec('PRAGMA foreign_keys = OFF') // the rows of the judgements point at a message that these tests do not create
    dir = mkdtempSync(join(tmpdir(), 'judge-reference-'))
  })
  after(async () => { rmSync(dir, { recursive: true, force: true }); await env.close() })

  it('a judge that agrees with two people reaches the threshold in every axis: calibrated, with the interval of each axis', () => {
    store(noisy(0.02))
    const result = calibrationOf(env.db, reference([['ana', 0.02], ['luis', 0.02]]))
    assert.equal(result.calibrated, true, JSON.stringify(result.axes))
    assert.equal(result.reason, null)
    assert.deepEqual([result.people, result.jobs], [2, jobs])
    assert.deepEqual(result.axes.map((a) => a.axis), AXES.map((a) => a.axis))
    for (const a of result.axes) {
      assert.ok(a.alpha >= ALPHA_MIN && a.interval[0] >= ALPHA_FLOOR && a.interval[0] <= a.alpha && a.alpha <= a.interval[1], JSON.stringify(a))
      assert.ok(a.alpha_people >= ALPHA_MIN)
    }
    assert.equal(result.axes.find((a) => a.axis === 4).units > 0, true, 'the axis 4 is read over the indicators that were scored: the 4.3 is not there')
  })

  it('a judge that does not look at the work is not calibrated, and the reason names the axes', () => {
    store(noisy(1))
    const result = calibrationOf(env.db, reference([['ana', 0.02], ['luis', 0.02]]))
    assert.equal(result.calibrated, false)
    assert.match(result.reason, /Alpha stays under 0\.8[\s\S]*the axes 1, 2, 3, 4/)
    assert.ok(result.axes.every((a) => a.alpha < ALPHA_MIN))
  })

  it('people who disagree among themselves cannot calibrate anyone, and one person is no ceiling to read', () => {
    store(noisy(0.02))
    assert.equal(calibrationOf(env.db, reference([['ana', 0.02], ['luis', 1]])).calibrated, false)
    const one = calibrationOf(env.db, reference([['ana', 0.02]]))
    assert.equal(one.calibrated, false)
    assert.match(one.reason, /fewer than two people/)
  })

  it('a reference whose jobs the judge never judged calibrates nothing', () => {
    run(env.db, 'DELETE FROM execute_judgments')
    const result = calibrationOf(env.db, reference([['ana', 0.02], ['luis', 0.02]]))
    assert.equal(result.calibrated, false)
    assert.match(result.reason, /None of the jobs/)
  })

  it('without a file, or with one that cannot be read, the judge is not calibrated and the reason says which', () => {
    const none = judgeCalibration(env.db, { execute: { judgeReferenceFile: '' } })
    assert.equal(none.calibrated, false)
    assert.match(none.reason, /EXECUTE_JUDGE_REFERENCE_FILE/)
    assert.match(judgeCalibration(env.db, { execute: { judgeReferenceFile: join(dir, 'missing.json') } }).reason, /cannot be read \(ENOENT\)/)
    const broken = join(dir, 'broken.json')
    writeFileSync(broken, '{"version":1,"units":[{"job_id":1,"ratings":{"ana":{"1.1":9}}}]}')
    assert.match(judgeCalibration(env.db, { execute: { judgeReferenceFile: broken } }).reason, /from -2 to 2/)
  })

  it('the file is read from the config, and the answer follows the file and the judgements it is read against', () => {
    store(noisy(0.02))
    const file = join(dir, 'reference.json')
    writeFileSync(file, JSON.stringify(reference([['ana', 0.02], ['luis', 0.02]])))
    const config = { execute: { judgeReferenceFile: file } }
    assert.equal(judgeCalibration(env.db, config).calibrated, true)
    assert.equal(judgeCalibration(env.db, config), judgeCalibration(env.db, config), 'the same file and the same judgements: the bootstrap is not run again')
    store(noisy(1))
    assert.equal(judgeCalibration(env.db, config).calibrated, false, 'other judgements: another answer')
  })

  it('a judgement of an uncalibrated judge is shown marked «sin calibrar» and decides nothing; a calibrated one is marked and counts', () => {
    store(noisy(0.02))
    run(env.db, 'UPDATE execute_judgments SET message_id = 1')
    assert.equal(judgmentOfMessage(env.db, 1).calibrated, false, 'a caller that does not say gets the cautious answer')
    assert.equal(judgmentOfMessage(env.db, 1, { calibrated: true }).calibrated, true)
    const shown = judgmentsOfMessage(env.db, 1)
    assert.equal(shown.length, jobs)
    assert.ok(shown.every((j) => j.calibrated === false))
    assert.deepEqual(judgmentsForDecisions(shown, { calibrated: false }), [])
    assert.deepEqual(judgmentsForDecisions(shown, null), [])
    const calibration = calibrationOf(env.db, reference([['ana', 0.02], ['luis', 0.02]]))
    assert.equal(judgmentsForDecisions(judgmentsOfMessage(env.db, 1, { calibrated: true }), calibration).length, jobs)
    assert.deepEqual(judgmentsForDecisions(judgmentsOfMessage(env.db, 1, { calibrated: true }), { calibrated: true }), [], 'a calibration with no axes decides nothing')
  })

  it('third audit, H-3: a reference that scores only some axes does not calibrate the judge, and a decision reads only the axes that passed', () => {
    store(noisy(0.02))
    run(env.db, 'UPDATE execute_judgments SET message_id = 1')
    const full = reference([['ana', 0.02], ['luis', 0.02]])
    const onlyOneAndTwo = { ...full, units: full.units.map((u) => ({ ...u, ratings: Object.fromEntries(Object.entries(u.ratings).map(([person, scores]) => [person, Object.fromEntries(Object.entries(scores).filter(([id]) => id.startsWith('1.') || id.startsWith('2.')))])) })) }
    const result = calibrationOf(env.db, onlyOneAndTwo)
    assert.equal(result.calibrated, false, 'axes 3 and 4 were never compared with people')
    assert.match(result.reason, /does not cover the axes 3, 4/)
    assert.deepEqual(result.axes.filter((a) => a.calibrated).map((a) => a.axis), [1, 2])
    const read = judgmentsForDecisions(judgmentsOfMessage(env.db, 1, { calibrated: false }), result)
    assert.equal(read.length, jobs)
    for (const j of read) {
      assert.deepEqual(j.axes.map((a) => a.axis), [1, 2])
      assert.ok(j.kpis.every((k) => k.id.startsWith('1.') || k.id.startsWith('2.')))
    }
  })

  it('the target of an axis is read over the indicators that were scored, and the axis says how many', () => {
    const kpis = KPIS.map((k) => ({ id: k.id, applies: k.id !== '4.3', score: k.axis === 4 ? 2 : 0, quote: '', claim: '', reasoning: '' }))
    const axis4 = axisScores(kpis, 'choose').find((a) => a.axis === 4)
    assert.deepEqual([axis4.score, axis4.target, axis4.meets, axis4.kpis, axis4.defined, axis4.partial], [2, 2, true, 2, 3, true])
    const complete = axisScores(KPIS.map((k) => ({ id: k.id, applies: true, score: 1, quote: '', claim: '', reasoning: '' })), 'execute').find((a) => a.axis === 1)
    assert.deepEqual([complete.kpis, complete.defined, complete.partial], [3, 3, false])
  })
})
