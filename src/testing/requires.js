// What a test needs from the environment it runs in, declared in one place.
//
// The battery of a publication runs inside the pinned image (the `battery` stage of the Dockerfile), which has no Docker daemon, no Chromium,
// no identity for git and no network promise. A test that needs one of those used to fail there for a reason that said nothing about the code.
// It declares what it needs and is skipped, with the reason written, when the environment does not have it:
//
//   import { requires } from '../testing/requires.js'
//   test('a real machine is created', { skip: requires('docker') }, async () => { ... })
//   describe('the driver', { skip: requires('docker', 'git-identity') }, () => { ... })
//
// `requires()` answers `false` (the test runs) or a string (the test is skipped and `node --test` prints that string as the reason and counts
// the test as skipped). Each requirement is checked for real, once per process, never read from a variable: `docker info` answers, `git config`
// returns a name and an email, the Chromium file exists, the name resolves. What does not need an environment is not declared here: it is
// written so that it runs anywhere (a toy repository sets its own identity with `-c user.name=... -c user.email=...`).
//
// A requirement that must hold (a change touched what a test walks, and a skip would let it pass unseen) is demanded with
// TEAM_REQUIRE_ENV=docker,chromium (a comma list): `requires()` then answers `false` for those and the test runs and fails on its own if the
// environment is missing, which is the rule of the daemon tests of `src/testing/areas.json` («a skipped test did not pass»).
//
// The skip reasons all start with `requires <name>:` so that the summary of a battery can count them by requirement.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const first = (text) => String(text ?? '').trim().split('\n')[0].slice(0, 160)

// Each probe answers null when the requirement holds, or the reason it does not. The timeouts only bound a probe that hangs (a daemon that
// accepts and never answers, a resolver without a network); they are not tuned values.
const PROBE_TIMEOUT_MS = 20_000 // bound of a probe that hangs, not a measured value
const probes = {
  // A daemon this process can talk to: the same question the tests ask before they build or run anything.
  docker () {
    const r = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS })
    if (r.error) return `\`docker info\` did not run (${r.error.code ?? first(r.error.message)})`
    return r.status === 0 ? null : `\`docker info\` failed (${first(r.stderr) || `exit ${r.status}`})`
  },
  // A commit without `-c user.name=... -c user.email=...`: the configuration of the user has both.
  'git-identity' () {
    const get = (key) => spawnSync('git', ['config', '--get', key], { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS })
    const git = get('user.name')
    if (git.error) return `git did not run (${git.error.code ?? first(git.error.message)})`
    const missing = ['user.name', 'user.email'].filter((key) => get(key).stdout.trim() === '')
    return missing.length === 0 ? null : `git has no ${missing.join(' and ')} in its configuration`
  },
  // The hooks of this checkout (.githooks/) are the ones git runs: `core.hooksPath` points at an existing directory with the pre-push hook.
  'git-hooks' () {
    const r = spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd: root, encoding: 'utf8', timeout: PROBE_TIMEOUT_MS })
    if (r.error) return `git did not run (${r.error.code ?? first(r.error.message)})`
    const path = r.stdout.trim()
    if (path === '') return 'the checkout has no core.hooksPath: its hooks are not active'
    return existsSync(resolve(root, path, 'pre-push')) ? null : `core.hooksPath (${path}) has no pre-push hook`
  },
  // The headless Chromium that the Playwright of the panel launches: it is launched and closed, because the file that `executablePath()` names
  // is the full browser and a headless launch uses another (chrome-headless-shell), so checking a path says nothing.
  chromium () {
    const script = `const { chromium } = require('playwright'); chromium.launch({ headless: true }).then((b) => b.close()).then(() => process.exit(0), (e) => { console.error(e.message); process.exit(1) })`
    const r = spawnSync(process.execPath, ['-e', script], { cwd: join(root, 'panel'), encoding: 'utf8', timeout: PROBE_TIMEOUT_MS })
    if (r.status === 0) return null
    if (r.error) return `a headless Chromium did not start (${r.error.code ?? first(r.error.message)})`
    return `the headless Chromium of the panel's Playwright does not start (${first(r.stderr) || `exit ${r.status}`})`
  },
  // The name of a public registry resolves: the machine has a network that answers. Asked in a child so that the probe stays synchronous.
  network () {
    const r = spawnSync(process.execPath, ['-e', "require('node:dns').lookup('registry.npmjs.org', (e) => process.exit(e ? 1 : 0))"], { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS })
    return r.status === 0 ? null : 'the name registry.npmjs.org does not resolve'
  },
}

export const REQUIREMENTS = Object.freeze(Object.keys(probes))

const cache = new Map()

/** null when `name` holds in this environment, else the reason it does not (checked once per process). */
export function probe (name) {
  if (!Object.hasOwn(probes, name)) throw new Error(`requires(): unknown requirement «${name}» (known: ${REQUIREMENTS.join(', ')})`)
  if (!cache.has(name)) cache.set(name, probes[name]())
  return cache.get(name)
}

/** The requirements that must hold, from TEAM_REQUIRE_ENV (comma list). */
export function demanded (env = process.env) {
  return new Set(String(env.TEAM_REQUIRE_ENV ?? '').split(',').map((s) => s.trim()).filter(Boolean))
}

/**
 * `false` when every requirement holds (or is demanded, see above); otherwise the reason to skip, one string with every one that is missing.
 * Use it as the `skip` option of a test or a suite.
 */
export function requires (...names) {
  if (names.length === 0) throw new Error('requires(): name at least one requirement')
  const must = demanded()
  const missing = []
  for (const name of names) {
    const reason = probe(name)
    if (reason !== null && !must.has(name)) missing.push(`requires ${name}: ${reason}`)
  }
  return missing.length === 0 ? false : missing.join('; ')
}
