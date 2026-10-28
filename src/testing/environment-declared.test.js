// A test that needs an environment says so (src/testing/requires.js). The battery of a publication runs in an image with no Docker daemon,
// no git identity and no Chromium; a test that needs one of those and does not declare it fails there for a reason that says nothing about
// the code (2026-10-27: eleven tests of the publication door and three of the conformance, red in the image and green on the notebook).
// This guard reads the test files and fails on the two uses that cannot work anywhere:
//   - a Docker call (`execFileSync('docker', ...)`, `spawn('docker', ...)`) in a file that does not declare `requires('docker')`;
//   - a git call that makes a commit in a file that neither sets an identity (`-c user.name=`, `user.email`, GIT_AUTHOR_*, GIT_COMMITTER_*)
//     nor declares `requires('git-identity')`. A test that can set its own identity does that; it does not skip.
// And a browser: a file that launches Chromium through Playwright declares `requires('chromium')` (or is run by the pool of the panel,
// which asks for the browser once before it starts: `*.browser.test.mjs`).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const SPAWNS = (tool) => new RegExp(`\\b(?:execFileSync|execFile|spawnSync|spawn|execSync|exec)\\(\\s*['"\`]${tool}['"\`]`)
const DECLARES = (name) => new RegExp(`\\brequires\\([^)]*['"]${name}['"]`)
const MAKES_A_COMMIT = /['"]commit['"]|['"]commit-tree['"]|\bgit\b[^\n'"`]*\bcommit\b(?!s)/
const HAS_IDENTITY = /user\.name|user\.email|GIT_AUTHOR_|GIT_COMMITTER_|GIT_CONFIG_GLOBAL/
const LAUNCHES_CHROMIUM = /\bchromium\.launch\b|\.chromium\.executablePath\b|\bplaywright\b[^\n]*\bchromium\b/i

/** What a test file uses without declaring it: an array of messages, empty when it is fine. */
export function undeclared (name, text) {
  const problems = []
  if (SPAWNS('docker').test(text) && !DECLARES('docker').test(text)) problems.push(`${name} calls docker and does not declare requires('docker')`)
  if (SPAWNS('git').test(text) && MAKES_A_COMMIT.test(text) && !HAS_IDENTITY.test(text) && !DECLARES('git-identity').test(text)) {
    problems.push(`${name} makes git commits and neither sets an identity (-c user.name=... -c user.email=...) nor declares requires('git-identity')`)
  }
  if (!name.endsWith('.browser.test.mjs') && LAUNCHES_CHROMIUM.test(text) && !DECLARES('chromium').test(text)) problems.push(`${name} launches Chromium and does not declare requires('chromium')`)
  return problems
}

test('no test file uses Docker, a git commit or Chromium without declaring what it needs', () => {
  const files = execFileSync('git', ['ls-files', '-z', '--', '*.test.js', '*.test.mjs'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
    .filter((f) => !f.startsWith('panel/') && !f.startsWith('packages/') && !f.startsWith('e2e/') && f !== 'src/testing/environment-declared.test.js' && f !== 'src/testing/requires.test.js')
  const problems = files.flatMap((f) => undeclared(f, readFileSync(join(root, f), 'utf8')))
  assert.deepEqual(problems, [], `A test that needs an environment declares it with requires() from src/testing/requires.js, or is written to run anywhere:\n${problems.join('\n')}`)
})

test('the guard sees an undeclared use and lets a declared one or one that sets its own identity', () => {
  assert.deepEqual(undeclared('a.test.js', "execFileSync('docker', ['info'])"), ["a.test.js calls docker and does not declare requires('docker')"])
  assert.deepEqual(undeclared('a.test.js', "import { requires } from './requires.js'\ndescribe('x', { skip: requires('docker') }, () => { spawnSync('docker', []) })"), [])
  assert.equal(undeclared('b.test.js', "const git = (...a) => execFileSync('git', a)\ngit('commit', '-qm', 'x')").length, 1)
  assert.deepEqual(undeclared('b.test.js', "const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', ...a])\ngit('commit', '-qm', 'x')"), [])
  assert.deepEqual(undeclared('b.test.js', "spawnSync('git', ['commit'], { env: { GIT_AUTHOR_NAME: 't' } })"), [])
  assert.deepEqual(undeclared('b.test.js', "test('x', { skip: requires('git-identity') }, () => spawnSync('git', ['commit']))"), [])
  assert.deepEqual(undeclared('c.test.js', "assert.equal(refuseCommand('git commit -m x'), null)"), [], 'a string that mentions git is not a call')
  assert.equal(undeclared('d.test.mjs', "const b = await chromium.launch()").length, 1)
  assert.deepEqual(undeclared('d.browser.test.mjs', "const b = await chromium.launch()"), [])
})
