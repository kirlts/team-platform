// docs/VERIFICATION.md names, for every check marked as implemented, the test file and the test name that verify it.
// This file keeps those references true: a renamed or deleted test makes the document fail here (DT-010).
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => readFileSync(path.join(root, file), 'utf8')
const verification = read('docs/VERIFICATION.md')
const lines = verification.split('\n')
const ID = /\[([A-Z]{3}\.[A-Z]{2}\.\d{2}\.(?:LLM|HUM|MIX))\]/

const checks = lines.filter((l) => /^(🤖|🧑|🤖🧑) `\[/.test(l)).map((l) => ID.exec(l)[1])

test('VERIFICATION: every check ID appears once and its verifier matches its suffix', () => {
  assert.ok(checks.length > 0)
  assert.deepEqual(checks.filter((id, i) => checks.indexOf(id) !== i), [])
  const symbols = { LLM: '🤖', HUM: '🧑', MIX: '🤖🧑' }
  for (const l of lines.filter((x) => /^(🤖|🧑|🤖🧑) `\[/.test(x))) {
    const id = ID.exec(l)[1]
    assert.ok(l.startsWith(`${symbols[id.slice(-3)]} \``), id)
  }
})

test('VERIFICATION: every implemented check carries a timestamp and names tests that exist', () => {
  let implemented = 0
  for (const l of lines.filter((x) => x.startsWith('✅ Implemented ('))) {
    implemented += 1
    assert.match(l, /; \d{4}-\d{2}-\d{2} \d{2}:\d{2}\)$/, l.slice(0, 80))
    const body = l.slice(l.indexOf('Verified by ') + 'Verified by '.length)
    for (const segment of body.split(/; (?=`)/)) {
      const file = /^`([^`]+)`/.exec(segment)?.[1]
      assert.ok(file && existsSync(path.join(root, file)), `file ${file}`)
      const source = read(file)
      const names = [...segment.matchAll(/«([^»]+)»/g)].map((m) => m[1])
      assert.ok(names.length > 0, `${file} names no test`)
      for (const name of names) assert.ok(source.includes(name), `${file} has no test «${name}»`)
    }
  }
  assert.ok(implemented > 0)
})

test('VERIFICATION: docs/TODO.md cites only check IDs that exist', () => {
  const cited = [...read('docs/TODO.md').matchAll(/\[([A-Z]{3}\.[A-Z]{2}\.\d{2}\.(?:LLM|HUM|MIX))\]/g)].map((m) => m[1])
  assert.ok(cited.length > 0)
  assert.deepEqual([...new Set(cited)].filter((id) => !checks.includes(id)), [])
})

test('VERIFICATION: every HP-NNN row of docs/TEST.md is covered by at least one check', () => {
  const rows = [...read('docs/TEST.md').matchAll(/^\| (HP-\d{3}) /gm)].map((m) => m[1])
  assert.deepEqual(rows.filter((id, i) => rows.indexOf(id) !== i), [], 'an HP id is repeated in TEST.md')
  const cited = verification.split('\n').filter((l) => /^(🤖|🧑|🤖🧑) `\[/.test(l)).join('\n')
  assert.deepEqual(rows.filter((hp) => !cited.includes(`${hp},`) && !cited.includes(`${hp})`)), [])
})
