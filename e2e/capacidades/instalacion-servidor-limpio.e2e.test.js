// Capability «Instalación con imagen Docker» (docs/CAPACIDADES-1.0.md), the part that the image test does not walk: `scripts/install.sh` in a clean server.
// The server is a privileged `docker:dind` container with its own Docker daemon, where there is no clone, no `.env`, no volume and no image of Team Platform
// (src/testing/servidor-limpio.js). The tree under test is cloned inside it with git, `scripts/install.sh` runs non-interactively (answers from the environment),
// builds the image there and starts the service; then the first Editor, with the password that the log showed once, signs in through the API, sends a text
// and reads the thread. Needs Docker and network (the base images, the ffmpeg source and the npm packages are downloaded by the inner daemon).
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { requires } from '../../src/testing/requires.js'
import { ADMIN_EMAIL, ATTACHMENT_NAME, attachmentBytes, CleanServer, PEOPLE_SCRIPT } from '../../src/testing/servidor-limpio.js'

const server = new CleanServer('instalar')
after(() => server.remove())

before(async () => { if (!requires('docker')) await server.start() }, { timeout: 300_000 })

test('scripts/install.sh in a clean server: the service is healthy, the first Editor password shows once and that Editor signs in, sends and reads', { skip: requires('docker', 'network'), timeout: 2_400_000 }, async () => {
  // The server is clean: nothing of Team Platform before the installation.
  assert.equal(server.sh('docker images -q | wc -l'), '0')
  assert.equal(server.sh('docker volume ls -q | wc -l'), '0')
  assert.equal(server.inClone('test -e .env && echo yes || echo no'), 'no')

  const started = Date.now()
  const installLog = server.install()
  console.log(`# scripts/install.sh in a clean server: ${((Date.now() - started) / 1000).toFixed(0)} s (image build included)`)
  assert.match(installLog, /Service up at http:\/\/127\.0\.0\.1:3000/)
  assert.match(installLog, /First editor/)

  assert.equal(server.inClone('stat -c %a .env'), '600')
  assert.equal(server.inClone("docker compose ps --format '{{.Health}}' team-platform"), 'healthy')
  const health = server.health()
  assert.equal(health.status, 'ok')

  const { count, password } = server.editorPassword()
  assert.equal(count, 1, 'the password of the first Editor shows exactly once in the log')
  assert.ok(password && password.length >= 15, 'the generated password has the minimum length')

  const seen = server.act(PEOPLE_SCRIPT, { ADMIN_EMAIL, ADMIN_PASSWORD: password, ATTACHMENT_NAME, ATTACHMENT_B64: attachmentBytes().toString('base64'), MODE: 'seed' })
  assert.equal(seen.login, 200)
  assert.deepEqual(seen.me, { email: ADMIN_EMAIL, role: 'editor' })
  assert.equal(seen.sent, 202)
  assert.equal(seen.thread.title, 'Walkthrough message')
  assert.equal(seen.health, 'ok')
})
