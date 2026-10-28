// src/testing/requires.js: answers with a reason when the environment lacks something, and false when it has it; the answer comes from a probe, not from a variable.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { demanded, probe, requires, REQUIREMENTS } from './requires.js'

test('every requirement has a probe and an unknown one is an error, not a silent pass', () => {
  assert.deepEqual([...REQUIREMENTS].sort(), ['chromium', 'docker', 'git-hooks', 'git-identity', 'network'])
  assert.throws(() => requires('floppy-disk'), /unknown requirement «floppy-disk»/)
  assert.throws(() => requires(), /name at least one requirement/)
})

test('the answer is false or a reason that starts with «requires <name>:» for each missing one', () => {
  for (const name of REQUIREMENTS) {
    const answer = requires(name)
    if (answer === false) assert.equal(probe(name), null, `${name} holds`)
    else assert.match(answer, new RegExp(`^requires ${name}: .+`), name)
  }
  const both = requires('docker', 'chromium')
  if (both !== false) for (const part of both.split('; ')) assert.match(part, /^requires (docker|chromium): /)
})

test('a probe is the real question: with no docker, no git identity and no hooksPath in a child process, the answer is a reason', () => {
  const env = { PATH: '/nonexistent', HOME: '/nonexistent', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
  const script = "import('./src/testing/requires.js').then((m) => console.log(JSON.stringify([m.requires('docker'), m.requires('git-identity')])))"
  const r = spawnSync(process.execPath, ['-e', script], { cwd: new URL('../..', import.meta.url).pathname, env, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  const [docker, identity] = JSON.parse(r.stdout)
  assert.match(docker, /^requires docker: `docker info` did not run \(ENOENT\)/)
  assert.match(identity, /^requires git-identity: git did not run \(ENOENT\)/)
})

test('a demanded requirement is not skipped: the test runs and fails on its own if the environment is missing', () => {
  assert.deepEqual([...demanded({ TEAM_REQUIRE_ENV: 'docker, chromium' })], ['docker', 'chromium'])
  assert.deepEqual([...demanded({})], [])
  const env = { PATH: '/nonexistent', HOME: '/nonexistent', TEAM_REQUIRE_ENV: 'docker' }
  const script = "import('./src/testing/requires.js').then((m) => console.log(JSON.stringify([m.requires('docker'), m.requires('chromium')])))"
  const r = spawnSync(process.execPath, ['-e', script], { cwd: new URL('../..', import.meta.url).pathname, env, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  const [docker, chromium] = JSON.parse(r.stdout)
  assert.equal(docker, false, 'docker is demanded: it is not skipped')
  assert.match(chromium, /^requires chromium: /, 'chromium is not demanded: it is skipped')
})
