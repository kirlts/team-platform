// HP-010 (docs/TEST.md): every number that governs operation is born declared (MASTER-SPEC section 4.9). The
// criterion is written in docs/TEST.md ("Criterio de HP-010") and implemented in src/testing/numbers.js: the literals
// reaching a timer, a multipart limit or a knob of the config files must cite their source in a comment on the same
// line or on the previous one.

import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { findUncitedNumbers } from './testing/numbers.js'

const src = path.dirname(fileURLToPath(import.meta.url))

const isProduction = (file) => /\.m?js$/.test(file) &&
  !/\.(test|live\.test|bench)\.m?js$/.test(file) &&
  !file.split(path.sep).some((part) => part === 'testing' || part === 'test')

function walk (p) {
  return statSync(p).isDirectory() ? readdirSync(p).flatMap((f) => walk(path.join(p, f))) : [p]
}

// Files where the by-name criterion (limit, max, timeout, retries, lease, concurrency) and the knob readers apply.
const KNOB_FILES = ['config.js', path.join('extract', 'config.js'), path.join('analyze', 'config.js')]
const KNOB_DIRS = ['queue', 'api']
const isKnobFile = (relative) => KNOB_FILES.includes(relative) || KNOB_DIRS.some((d) => relative.startsWith(`${d}${path.sep}`))

test('HP-010: every reviewed numeric literal in src/ cites its source (section 4.9)', () => {
  const files = walk(src).filter(isProduction)
  assert.ok(files.length > 50)
  const problems = []
  let reviewedKnobFiles = 0
  for (const file of files) {
    const relative = path.relative(src, file)
    const knobs = isKnobFile(relative)
    if (knobs) reviewedKnobFiles++
    for (const hit of findUncitedNumbers(readFileSync(file, 'utf8'), { knobs })) {
      problems.push(`src/${relative}:${hit.line}: ${hit.value} (${hit.context}) has no source`)
    }
  }
  assert.ok(reviewedKnobFiles >= KNOB_FILES.length, 'the knob files must be part of the review')
  assert.deepEqual(problems, [])
})

test('HP-010: the criterion detects a number without source and accepts the ones that cite one', () => {
  const uncited = (code, knobs = true) => findUncitedNumbers(code, { knobs }).map((h) => h.value)
  // Timers: a literal, and a constant of the same file that reaches the timer.
  assert.deepEqual(uncited('setTimeout(run, 2500)', false), ['2500'])
  assert.deepEqual(uncited('const DELAY = 700\nsetInterval(tick, DELAY)', false), ['700'])
  assert.deepEqual(uncited('setTimeout(run, 2500) // I03 §12: measured', false), [])
  assert.deepEqual(uncited('// cortesía declarada: not measured\nsetTimeout(run, 2500)', false), [])
  // A comment two lines above is not enough.
  assert.deepEqual(uncited('// I03 §12\n\nsetTimeout(run, 2500)', false), ['2500'])
  // Multipart limits.
  assert.deepEqual(uncited('register(m, { limits: { files: 12 } })', false), ['12'])
  // Knobs by name, and knob readers whatever the name.
  assert.deepEqual(uncited('const cfg = { maxAttempts: 4 }'), ['4'])
  assert.deepEqual(uncited("const cfg = { pageSize: intVar(env, 'PAGE', 50, { min: 2 }) }"), ['50'])
  assert.deepEqual(uncited("const cfg = { pageSize: intVar(env, 'PAGE', 50, { min: 2 }) } // MS §7.8"), [])
  assert.deepEqual(uncited("const cfg = { retries: 3 } // medición 2026-10-20"), [])
  assert.deepEqual(uncited("const cfg = { retries: 3 } // informe 5"), [])
  // The by-name criterion applies only inside the knob files.
  assert.deepEqual(uncited('const cfg = { maxAttempts: 4 }', false), [])
  // Exempt: neutral values, unit conversions, HTTP codes and indexes.
  assert.deepEqual(uncited('const cfg = { max: 1, timeoutMs: 1000, lease: 60 * 1000, cap: 1024 * 1024 }'), [])
  assert.deepEqual(uncited("const MULTIPART = { FST_FILES_LIMIT: [413, 'too_many_files'] }"), [])
  assert.deepEqual(uncited('const first = items[2]\nconst status = reply.code(404)'), [])
  // Literals inside strings and comments never count.
  assert.deepEqual(uncited("const cfg = { maxAttempts: 'tres' }\n// timeout: 99"), [])
})
