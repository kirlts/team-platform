// The attachments directory can live on another filesystem than tmpDir: on a host site it is a Cloud
// Storage bucket mounted under /data/attachments while /data/tmp stays on the local volume. A plain
// rename() there fails with EXDEV and the upload answered 500 (measured on a host site,
// 2026-10-22). /dev/shm is a tmpfs on Linux, so it and the home directory are two filesystems.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, readFileSync, readdirSync, statSync, rmSync } from 'node:fs'
import { Readable } from 'node:stream'
import os from 'node:os'
import path from 'node:path'
import { ingest, commit } from './storage.js'

const shm = '/dev/shm'
const otherDevice = existsSync(shm) && statSync(shm).dev !== statSync(os.homedir()).dev

test('commit moves a blob to an attachments directory on another filesystem', { skip: !otherDevice && 'no second filesystem here' }, async (t) => {
  const tmpDir = mkdtempSync(path.join(shm, 'tp-tmp-'))
  const attachmentsDir = mkdtempSync(path.join(os.homedir(), '.tp-attachments-'))
  t.after(() => { rmSync(tmpDir, { recursive: true, force: true }); rmSync(attachmentsDir, { recursive: true, force: true }) })
  const config = { tmpDir, attachmentsDir }
  const { tmp, sha256 } = await ingest(config, Readable.from([Buffer.from('contenido del adjunto')]), { maxBytes: 1000, tooLargeMessage: 'x' })
  assert.deepEqual(await commit(config, tmp, sha256), { existed: false })
  assert.equal(readFileSync(path.join(attachmentsDir, sha256), 'utf8'), 'contenido del adjunto')
  assert.deepEqual(readdirSync(attachmentsDir), [sha256])
  assert.deepEqual(readdirSync(tmpDir), [])
})
