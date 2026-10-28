// Capability «Instalación con imagen Docker» (docs/CAPACIDADES-1.0.md), the part of the backup: `scripts/backup.sh` and the restoration that docs/INSTALACION.md
// describes. A clean server (src/testing/servidor-limpio.js: a `docker:dind` container with its own daemon) gets the installation by `scripts/install.sh`; the first
// Editor sends a text, a reply carries an attachment; `WITH_FILES=1 scripts/backup.sh` makes the backup; the volume is destroyed (`docker compose down -v`); the
// commands of the section «Respaldo» of docs/INSTALACION.md are taken from the document itself and run as written; and the restored instance gives back the same
// message, the same reply and the same attachment byte for byte, the same master key file, and the same Editor signs in with the same password.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { requires } from '../../src/testing/requires.js'
import { ADMIN_EMAIL, ATTACHMENT_NAME, attachmentBytes, CleanServer, PEOPLE_SCRIPT, ROOT, sha256 } from '../../src/testing/servidor-limpio.js'

const server = new CleanServer('respaldo')
after(() => server.remove())

before(async () => { if (!requires('docker')) await server.start() }, { timeout: 300_000 })

/** The commands of the first code block after «Restaurar una copia» in docs/INSTALACION.md, as written there. */
function restoreCommands () {
  const text = readFileSync(path.join(ROOT, 'docs/INSTALACION.md'), 'utf8')
  const from = text.indexOf('Restaurar una copia')
  assert.ok(from > 0, 'docs/INSTALACION.md has the section «Restaurar una copia»')
  const block = /```sh\n([\s\S]*?)```/.exec(text.slice(from))
  assert.ok(block, 'the restoration is a code block')
  return block[1]
}

test('scripts/backup.sh and the restoration of docs/INSTALACION.md: a destroyed volume comes back with the same message, reply, attachment and Editor', { skip: requires('docker', 'network'), timeout: 2_700_000 }, async () => {
  const timings = {}
  const lap = (what, since) => { timings[what] = Number(((Date.now() - since) / 1000).toFixed(1)) }
  let t = Date.now()
  server.install()
  lap('install.sh (image build included)', t)
  const { count, password } = server.editorPassword()
  assert.equal(count, 1)

  const env = { ADMIN_EMAIL, ADMIN_PASSWORD: password, ATTACHMENT_NAME, ATTACHMENT_B64: attachmentBytes().toString('base64') }
  const before = server.act(PEOPLE_SCRIPT, { ...env, MODE: 'seed' })
  assert.equal(before.login, 200)
  assert.equal(before.sent, 202)
  assert.equal(before.reply, 201)
  assert.deepEqual(before.thread.replies.map((r) => r.attachments), [[{ name: ATTACHMENT_NAME, size: attachmentBytes().length }]])
  assert.equal(before.attachment.sha256, sha256(attachmentBytes()), 'the instance serves the bytes that were sent')
  const keyBefore = server.inClone('docker compose exec -T team-platform sha256sum /data/secrets.key').split(' ')[0]

  // The backup.
  t = Date.now()
  const made = server.inClone('WITH_FILES=1 scripts/backup.sh')
  lap('backup.sh WITH_FILES=1', t)
  const stamp = /backups\/team-(\d{8}T\d{6}Z)\.db/.exec(made)?.[1]
  assert.ok(stamp, made)
  assert.match(server.inClone('ls -l backups'), new RegExp(`-rw-------.*files-${stamp}\\.tar`))
  const members = server.inClone(`tar -tf backups/files-${stamp}.tar`).split('\n')
  assert.ok(members.some((m) => m.startsWith('attachments/')), 'the tar carries the attachments')
  assert.ok(members.includes('secrets.key'), 'the tar carries the master key of the stored keys')

  // The volume is destroyed: the service, its volume and its data are gone; the clone, `.env`, the image and the backup remain.
  server.inClone('docker compose down -v')
  assert.equal(server.sh('docker volume ls -q | wc -l'), '0')
  assert.equal(server.inClone('docker compose ps -aq | wc -l'), '0')

  // The restoration, as docs/INSTALACION.md writes it.
  t = Date.now()
  server.inClone('set -e\n' + restoreCommands().replaceAll('<fecha>', stamp), { timeout: 600_000 })
  lap('restoration of the document', t)
  console.log(`# ${Object.entries(timings).map(([k, v]) => `${k}: ${v} s`).join('; ')}`)
  assert.equal(server.inClone("docker compose ps --format '{{.Health}}' team-platform"), 'healthy')
  assert.equal(server.health().status, 'ok')

  const after = server.act(PEOPLE_SCRIPT, { ...env, MODE: 'read', MESSAGE_ID: before.messageId })
  assert.equal(after.login, 200, 'the same Editor signs in with the same password')
  assert.deepEqual(after.me, before.me)
  assert.deepEqual(after.thread, before.thread)
  assert.deepEqual(after.attachment, before.attachment)
  assert.equal(after.attachment.sha256, sha256(attachmentBytes()))
  assert.equal(server.inClone('docker compose exec -T team-platform sha256sum /data/secrets.key').split(' ')[0], keyBefore)
  assert.equal(server.editorPassword().count, 0, 'the restored instance does not create another first Editor')
})
