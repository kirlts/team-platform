// Two test files with the same hard-coded port collide with EADDRINUSE when they run in parallel (2026-10-26: forward and idea-se-muestra on 8645,
// host-notices and member-retirement on 8610; the second one failed or hung the run). A port that a test needs is asked from the system (0).
// This guard lists the literal ports the test files declare and fails when two files declare the same one.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DECLARES = /(?:\b[A-Z_]*PORT[A-Z_]*\s*=\s*|\bport:\s*|\blisten\(\s*)(\d{4,5})\b/g

export function portsByFile(files, read = (f) => readFileSync(join(root, f), 'utf8')) {
  const byPort = new Map()
  for (const f of files) {
    for (const [, port] of read(f).matchAll(DECLARES)) byPort.set(port, [...new Set([...(byPort.get(port) ?? []), f])])
  }
  return byPort
}

test('no two test files declare the same literal port', () => {
  const files = execFileSync('git', ['ls-files', '-z', '--', '*.test.js', '*.test.mjs'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
  const shared = [...portsByFile(files)].filter(([, fs]) => fs.length > 1).map(([port, fs]) => `${port}: ${fs.join(', ')}`)
  assert.deepEqual(shared, [], `Ports declared by more than one test file:\n${shared.join('\n')}`)
})

test('the guard sees a port that two files declare and lets one that only one declares', () => {
  const read = (f) => ({ 'a.test.js': 'const PORT = 8645\n', 'b.test.js': "app.listen({ port: 8645 })\n", 'c.test.js': 'const JWKS_PORT = 8610\n', 'd.test.js': 'let PORT = 0\n' })[f]
  const shared = [...portsByFile(['a.test.js', 'b.test.js', 'c.test.js', 'd.test.js'], read)].filter(([, fs]) => fs.length > 1)
  assert.deepEqual(shared, [['8645', ['a.test.js', 'b.test.js']]])
})
