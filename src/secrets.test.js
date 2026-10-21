// HP-007 (docs/TEST.md), the repository half: no credential in the repository (MASTER-SPEC section 4.6). The scanner
// must recognize the shape of the keys the project handles, the tracked files must be clean and the pre-commit hook
// must refuse a commit that contains one. The schema half (no column stores a key) is in src/static.test.js.

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { accessSync, constants, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { findSecrets } from './testing/secrets.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Samples are assembled at run time so that this file does not contain what the scanner looks for.
const fake = {
  anthropic: ['sk-ant', 'api03', 'x'.repeat(30)].join('-'),
  groq: `gsk_${'a1'.repeat(15)}`,
  aws: `AKIA${'B2'.repeat(8)}`,
  pem: `-----BEGIN ${'RSA '}PRIVATE KEY-----`,
  assigned: `ANTHROPIC_API_KEY=${'q9'.repeat(12)}`
}

test('HP-007: the scanner recognizes the keys the project handles and ignores empty variables', () => {
  for (const [name, sample] of Object.entries(fake)) assert.ok(findSecrets(`x = ${sample}`).length > 0, name)
  for (const harmless of ['ANTHROPIC_API_KEY=', '# ANTHROPIC_API_KEY=', 'GROQ_API_KEY=${GROQ_API_KEY}', 'const key = process.env.ANTHROPIC_API_KEY', 'password_hash TEXT NOT NULL']) {
    assert.deepEqual(findSecrets(harmless), [], harmless)
  }
  // A made-up value in a test file is allowed, a key-shaped one is not.
  assert.deepEqual(findSecrets(fake.assigned, { isTest: true }), [])
  assert.ok(findSecrets(fake.anthropic, { isTest: true }).length > 0)
})

test('HP-007: no tracked file of the repository contains a credential', () => {
  const run = spawnSync(process.execPath, [path.join(root, 'scripts', 'check-secrets.mjs')], { cwd: root, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
})

test('HP-007: the pre-commit hook refuses a commit with a credential and accepts one without', () => {
  accessSync(path.join(root, '.githooks', 'pre-commit'), constants.X_OK)
  const repo = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), 'team-platform-hook-'))
  try {
    const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
    git('init', '-q')
    mkdirSync(path.join(repo, 'scripts'))
    mkdirSync(path.join(repo, 'src', 'testing'), { recursive: true })
    for (const file of ['scripts/check-secrets.mjs', 'src/testing/secrets.js']) {
      writeFileSync(path.join(repo, file), execFileSync('cat', [path.join(root, file)]))
    }
    writeFileSync(path.join(repo, 'package.json'), '{"type":"module"}\n')
    const hook = () => spawnSync(path.join(root, '.githooks', 'pre-commit'), { cwd: repo, encoding: 'utf8' })
    writeFileSync(path.join(repo, 'notes.txt'), 'nothing secret here\n')
    git('add', 'notes.txt')
    assert.equal(hook().status, 0)
    writeFileSync(path.join(repo, 'config.txt'), `token ${fake.anthropic}\n`)
    git('add', 'config.txt')
    const refused = hook()
    assert.equal(refused.status, 1)
    assert.match(refused.stderr, /config\.txt:1: Anthropic key/)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})
