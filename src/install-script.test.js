// scripts/install.sh (HALLAZGOS H-42 and H-43): the pre-commit hook is activated in the clone, and the list of blocked
// passwords is installed in the data volume once, verified by SHA-256 and filtered to the minimum password length.
// Runs the real script in a temporary git clone with a stub `docker` that executes the commands locally, with DATA_DIR
// pointing at a temporary directory instead of the volume.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const work = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), 'team-platform-install-'))
after(() => rmSync(work, { recursive: true, force: true }))

const sha256 = (text) => createHash('sha256').update(text).digest('hex')

/** A git clone with the script, `.env.example` and the hooks, and a `docker` that runs `compose run ... -c <cmd>` with sh. */
function makeClone (name) {
  const clone = path.join(work, name)
  mkdirSync(path.join(clone, 'scripts'), { recursive: true })
  copyFileSync(path.join(root, 'scripts/install.sh'), path.join(clone, 'scripts/install.sh'))
  copyFileSync(path.join(root, '.env.example'), path.join(clone, '.env.example'))
  cpSync(path.join(root, '.githooks'), path.join(clone, '.githooks'), { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: clone })
  const bin = path.join(work, `${name}-bin`)
  mkdirSync(bin)
  const data = path.join(work, `${name}-data`)
  mkdirSync(data)
  // `docker compose run --rm -T --no-deps --entrypoint sh team-platform -c CMD`: CMD runs here, with DATA_DIR in the environment.
  writeFileSync(path.join(bin, 'docker'), `#!/bin/sh
[ "$1" = compose ] || exit 1
shift
case "$1" in
  version|build|up) exit 0 ;;
  run) while [ "$1" != "-c" ]; do shift; done; shift; DATA_DIR="${data}" exec sh -c "$1" ;;
esac
exit 1
`)
  chmodSync(path.join(bin, 'docker'), 0o755)
  return { clone, bin, data }
}

function install ({ clone, bin }, env = {}, args = []) {
  return spawnSync('sh', ['scripts/install.sh', ...args], {
    cwd: clone,
    encoding: 'utf8',
    env: { PATH: `${bin}:${process.env.PATH}`, HOME: work, ADMIN_EMAIL: 'ed@x.org', ...env },
    stdin: 'ignore'
  })
}

const gitConfig = (clone) => spawnSync('git', ['config', 'core.hooksPath'], { cwd: clone, encoding: 'utf8' }).stdout.trim()

test('H-42: install.sh activates the pre-commit hook of the clone, also with --no-start', () => {
  const env = makeClone('hooks')
  assert.equal(gitConfig(env.clone), '')
  const run = install(env, {}, ['--no-start'])
  assert.equal(run.status, 0, run.stderr)
  assert.equal(gitConfig(env.clone), '.githooks')
  assert.match(run.stdout, /core\.hooksPath=\.githooks/)
  assert.equal(existsSync(path.join(env.data, 'password-blocklist.txt')), false, '--no-start does not touch the volume')
})

test('H-43: install.sh installs the list once, verified by SHA-256 and with only the entries of the minimum length', () => {
  const env = makeClone('lista')
  const source = path.join(work, 'fuente.txt')
  const content = 'a\r\n123456\r\n1qaz2wsx3edc4rfv\r\nUna contraseña de veinte\r\n'
  writeFileSync(source, content)
  const vars = { BLOCKLIST_URL: `file://${source}`, BLOCKLIST_SHA256: sha256(content) }
  const first = install(env, vars)
  assert.equal(first.status, 0, first.stderr)
  assert.match(first.stdout, /installed: 2 entries of 15 or more characters/)
  const file = path.join(env.data, 'password-blocklist.txt')
  assert.equal(readFileSync(file, 'utf8'), '1qaz2wsx3edc4rfv\nUna contraseña de veinte\n')
  // The second run finds it and does not download again: a source that no longer exists does not matter.
  const second = install(env, { ...vars, BLOCKLIST_URL: 'file:///no/existe' })
  assert.match(second.stdout, /already in the volume/)
  assert.equal(second.stderr.includes("Warning"), false)
})

test('H-43: a list that does not match its SHA-256 is not installed, and the installation goes on with a warning', () => {
  const env = makeClone('hash')
  const source = path.join(work, 'otra.txt')
  writeFileSync(source, 'contenido distinto\n')
  const run = install(env, { BLOCKLIST_URL: `file://${source}`, BLOCKLIST_SHA256: sha256('lo esperado') })
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stderr, /does not match the expected SHA-256/)
  assert.equal(existsSync(path.join(env.data, 'password-blocklist.txt')), false)
  assert.match(run.stdout, /Service up at/)
})

test('H-43: the pinned source is the SecLists commit and file that were read, and the default is not changed by accident', () => {
  const script = readFileSync(path.join(root, 'scripts/install.sh'), 'utf8')
  assert.match(script, /BLOCKLIST_COMMIT=0c03d70db30ceedb941ac58b0ec910eb85906d6f/)
  assert.match(script, /xato-net-10-million-passwords-1000000\.txt/)
  assert.match(script, /424a3e03a17df0a2bc2b3ca749d81b04e79d59cb7aeec8876a5a3f308d0caf51/)
  assert.match(script, /MIT license/)
})
