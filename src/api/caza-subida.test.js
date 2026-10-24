// Hunt for the failures of the upload and the volume (2026-10-24): the form a browser sends, the formats people send, a disk that cannot be written,
// an orphan sweep that races an upload, a client that goes silent. Each case was reproduced before it was fixed.
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, readdirSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { all, get } from '../db/index.js'
import { classify } from '../domain/attachments.js'
import { holdBlob, releaseBlobs, sweepOrphans } from '../domain/storage.js'
import { addMember, login, makeEnv, postInput, until } from '../testing/helpers.js'

const fast = { identity: { login: { ipMax: 1000 } }, worker: { retryBaseMs: 5, retryMaxMs: 20 } }
const textFile = (name = 'a.txt', content = 'contenido') => ({ field: 'files', name, type: 'text/plain', content })

async function setup (opts = {}) {
  const env = await makeEnv({ ...opts, config: { ...fast, ...(opts.config ?? {}), worker: { ...fast.worker, ...(opts.config?.worker ?? {}) } } })
  await addMember(env, { email: 'ana@x.org' })
  env.ana = await login(env, 'ana@x.org')
  env.submit = async (text, files = []) => (await postInput(env, env.ana, { text }, files)).json()
  env.input = (id) => get(env.db, 'SELECT * FROM inputs WHERE id = ?', id)
  env.attempts = (jobId) => get(env.db, 'SELECT attempts FROM jobs WHERE id = ?', jobId).attempts
  return env
}


describe('the formats people send', () => {
  it('H-3817: a WhatsApp voice note (.opus) and a photo typed image/jpg are accepted by what they are; an SVG still is not', () => {
    for (const [mime, name, kind] of [['audio/opus', 'nota.opus', 'audio'], ['application/octet-stream', 'PTT-2026.opus', 'audio'], ['audio/x-opus+ogg', 'nota.opus', 'audio'], ['image/jpg', 'foto.jpg', 'image'], ['image/pjpeg', 'foto.jpeg', 'image']]) {
      assert.equal(classify(mime, name)?.kind, kind, `${mime} ${name}`)
    }
    assert.equal(classify('image/svg+xml', 'dibujo.svg'), null)
    assert.equal(classify('application/x-msdownload', 'foto.png'), null)
  })
})


describe('the volume', () => {
  let env
  before(async () => { env = await setup() })
  after(async () => { await env.close() })

  it('H-3813: the orphan sweep leaves the blob an upload in flight holds, and a file that vanishes during the sweep does not stop it', async () => {
    mkdirSync(env.config.attachmentsDir, { recursive: true })
    const old = (name) => { const p = path.join(env.config.attachmentsDir, name); writeFileSync(p, 'x'); utimesSync(p, 1, 1); return p }
    const held = old('a'.repeat(64))
    const orphan = old('b'.repeat(64))
    holdBlob('a'.repeat(64))
    symlinkSync(path.join(env.config.dataDir ?? env.dir, 'no-such-file'), path.join(env.config.attachmentsDir, 'dangling'))
    const removed = await sweepOrphans(env.db, env.config, 1000)
    assert.ok(existsSync(held), 'the blob held by an upload in flight stays')
    assert.ok(!existsSync(orphan), 'the sweep went on past the entry that could not be read')
    assert.equal(removed, 1)
    await releaseBlobs(env.db, env.config, [{ sha256: 'a'.repeat(64) }], { discard: false })
  })

  it('H-3814: a form with no file chosen (an empty part with no name) is not a refused format', async () => {
    const r = await postInput(env, env.ana, { text: 'sin archivo elegido' }, [{ field: 'files', name: '', type: 'application/octet-stream', content: '' }])
    assert.equal(r.statusCode, 202, r.body)
    assert.equal(all(env.db, 'SELECT id FROM attachments WHERE input_id = ?', r.json().input_id).length, 0)
  })

  it('H-3815: a volume that cannot be written answers with a reason the sender reads, not an internal error, and leaves no temporary file', async () => {
    mkdirSync(env.config.tmpDir, { recursive: true })
    chmodSync(env.config.tmpDir, 0o555)
    try {
      const r = await postInput(env, env.ana, { text: 'volumen sin escritura' }, [textFile('b.txt', 'contenido nuevo')])
      assert.equal(r.statusCode, 503, r.body)
      assert.equal(r.json().code, 'storage_unavailable')
    } finally {
      chmodSync(env.config.tmpDir, 0o755)
    }
    assert.deepEqual(readdirSync(env.config.tmpDir), [])
  })
})


describe('an upload that stops arriving', () => {
  it('H-3820: a client that goes silent half way (a phone that lost its network without closing the connection) is cut at the idle limit and leaves no temporary file', async () => {
    const env = await setup({ config: { uploads: { idleTimeoutMs: 300 } } })
    await env.app.listen({ host: '127.0.0.1', port: 0 })
    const boundary = 'XBOUND'
    const head = `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="a.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n`
    const socket = net.connect(env.app.server.address().port, '127.0.0.1')
    socket.on('error', () => {})
    await new Promise((resolve) => socket.on('connect', resolve))
    socket.write(`POST /api/inputs HTTP/1.1\r\nHost: x\r\nCookie: ${env.ana}\r\nx-team-request: panel\r\nContent-Type: multipart/form-data; boundary=${boundary}\r\nContent-Length: 5000000\r\n\r\n${head}`)
    socket.write(Buffer.alloc(100000, 1))
    try {
      await until(() => existsSync(env.config.tmpDir) && readdirSync(env.config.tmpDir).length === 1)
      // The client says nothing more. The server must not wait for ever.
      await until(() => readdirSync(env.config.tmpDir).length === 0, { timeoutMs: 3000 })
      assert.equal(all(env.db, 'SELECT id FROM inputs').length, 0)
    } finally {
      socket.destroy()
    }
    await env.close()
  })
})
