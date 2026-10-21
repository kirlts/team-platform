#!/usr/bin/env node
// `npm run test:rapido`: runs only the tests a change since the last green run can affect (logic and criteria in
// src/testing/quick.js). `npm test` keeps running everything and, when it passes, records the mark this script
// compares against (the `posttest` step).
//
//   npm run test:rapido            only what changed since the last green run
//   npm run test:rapido -- --list  prints the tests it would run and does not run them
//   npm run test:rapido -- --all   runs everything and records the mark
//   node scripts/test-quick.mjs --mark   records the mark (what `npm test` does when it passes)

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { affectedTests, allTests, changedSinceMark, writeMark } from '../src/testing/quick.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = new Set(process.argv.slice(2))

if (args.has('--mark')) {
  writeMark(root)
  process.exit(0)
}

const everything = allTests(root)
const changed = args.has('--all') ? null : changedSinceMark(root)
const selected = changed === null ? everything : affectedTests(root, changed, everything)

if (changed === null) console.error(args.has('--all') ? 'Running everything (--all).' : 'No mark from a green run yet: running everything.')
else console.error(`${changed.length} file(s) changed since the last green run: ${selected.length} of ${everything.length} test file(s) affected.`)
if (changed?.some((file) => file.startsWith('bench/') || file.startsWith('panel/'))) console.error('Changes in bench/ or panel/: also run `npm run test:bench` or the panel tests; this script covers src/.')

if (args.has('--list')) {
  console.log(selected.join('\n'))
  process.exit(0)
}
if (selected.length === 0) {
  console.error('Nothing to run.')
  writeMark(root)
  process.exit(0)
}
const run = spawnSync(process.execPath, ['--test', ...selected], { cwd: root, stdio: 'inherit' })
if (run.status === 0) writeMark(root)
process.exit(run.status ?? 1)
