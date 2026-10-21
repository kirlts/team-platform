// HP-018 (docs/TEST.md): a video longer than 20 minutes or an attachment over its size cap is rejected with its code
// and never reaches a provider (MASTER-SPEC section 7.4).
//
// What the code does, which is what these tests pin down:
//   - A file over the cap of its kind is refused at upload with 413 and the extractor's code (`<kind>_too_large`), and
//     leaves no input, job, attachment or file behind. The cap of a kind is the smaller of the upload's and the
//     extractor's, so a document between 24 and 25 MiB no longer uploads to fail later (DT-005).
//   - A video longer than 20 minutes is refused at upload (422, `video_too_long`) after a cheap ffprobe of its
//     header, with the same guarantees. Nothing reaches the queue or a provider in either case.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readdirSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { get } from './db/index.js'
import { extract } from './extract/index.js'
import { addMember, login, makeEnv, postInput, until } from './testing/helpers.js'

const MIB = 1024 * 1024

/** Environment with the real extractors and providers that count their calls. */
async function realExtractEnv (config = {}) {
  const calls = { vision: 0, speech: 0 }
  const providers = {
    vision: { describe: async () => { calls.vision++; return { json: { description: 'x', frames: [] }, usage: {} } } },
    speech: { transcribe: async () => { calls.speech++; return { text: 'x', segments: [] } } }
  }
  const env = await makeEnv({ worker: true, config: { identity: { login: { ipMax: 1000 } }, ...config }, modules: { extract, getProviders: () => providers } })
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  env.cookie = await login(env, 'ana@x.org')
  env.calls = calls
  return env
}

const failedInput = (env, id) => until(() => {
  const row = get(env.db, 'SELECT status, error_code FROM inputs WHERE id = ?', id)
  return row.status === 'failed' ? row : null
}, { timeoutMs: 20_000 })

test('HP-018: a file over the cap of its kind is refused at upload with 413 and leaves nothing behind', async () => {
  const env = await realExtractEnv({ uploads: { maxImageBytes: 10, maxAudioBytes: 10, maxDocumentBytes: 10, maxVideoBytes: 1000 } })
  try {
    // The cap of the kind (11 bytes over 10) and, for the video, the multipart limit that is the largest of the caps.
    for (const [name, type, size] of [['a.png', 'image/png', 11], ['a.mp3', 'audio/mpeg', 11], ['a.pdf', 'application/pdf', 11], ['a.mp4', 'video/mp4', 1001]]) {
      const res = await postInput(env, env.cookie, { text: 'x' }, [{ field: 'files', name, type, content: 'x'.repeat(size) }])
      assert.equal(res.statusCode, 413, name)
      assert.equal(typeof res.json().code, 'string', name)
    }
    for (const table of ['inputs', 'jobs', 'attachments']) assert.equal(get(env.db, `SELECT COUNT(*) AS n FROM ${table}`).n, 0, table)
  } finally { await env.close() }
})

/** Nothing of the rejected upload is left: no rows, no job, no file in the volume, no provider call. */
const nothingLeft = (env) => {
  for (const table of ['inputs', 'jobs', 'attachments']) assert.equal(get(env.db, `SELECT COUNT(*) AS n FROM ${table}`).n, 0, table)
  assert.deepEqual(readdirSync(env.config.attachmentsDir), [])
  assert.deepEqual(readdirSync(env.config.tmpDir), [])
  assert.deepEqual(env.calls, { vision: 0, speech: 0 })
}

test('HP-018: a document over 24 MiB is refused at upload with document_too_large, before anything is queued', async () => {
  const env = await realExtractEnv()
  try {
    const big = Buffer.alloc(24 * MIB + 1, 97)
    const sent = await postInput(env, env.cookie, { text: 'x' }, [{ field: 'files', name: 'big.txt', type: 'text/plain', content: big }])
    assert.equal(sent.statusCode, 413)
    assert.equal(sent.json().code, 'document_too_large')
    assert.match(sent.json().message, /big\.txt.*24 MB/)
    nothingLeft(env)
    // Exactly 24 MiB is accepted: the cap is a limit, not a bound just under it.
    const edge = await postInput(env, env.cookie, { text: 'y' }, [{ field: 'files', name: 'edge.txt', type: 'text/plain', content: Buffer.alloc(24 * MIB, 97) }])
    assert.equal(edge.statusCode, 202, edge.body)
  } finally { await env.close() }
})

test('HP-018: the upload cap of a document is the extractor cap (DT-005), and each kind refuses with its own code', async () => {
  const { DEFAULTS } = await import('./extract/config.js')
  const { loadConfig } = await import('./config.js')
  const caps = loadConfig({}).uploads
  assert.equal(caps.maxDocumentBytes, DEFAULTS.document.maxBytes)
  assert.equal(caps.maxImageBytes, DEFAULTS.image.maxBytes)
  assert.equal(caps.maxAudioBytes, DEFAULTS.audio.maxBytes)
  const env = await realExtractEnv({ uploads: { maxImageBytes: 10, maxAudioBytes: 10, maxDocumentBytes: 10, maxVideoBytes: 1000 } })
  try {
    for (const [name, type, size, code] of [['a.png', 'image/png', 11, 'image_too_large'], ['a.mp3', 'audio/mpeg', 11, 'audio_too_large'], ['a.pdf', 'application/pdf', 11, 'document_too_large']]) {
      const res = await postInput(env, env.cookie, { text: 'x' }, [{ field: 'files', name, type, content: 'x'.repeat(size) }])
      assert.equal(res.json().code, code, name)
    }
    // A configured cap larger than the extractor's is brought down to it.
    const high = await realExtractEnv({ uploads: { maxDocumentBytes: 30 * MIB } })
    try {
      const res = await postInput(high, high.cookie, { text: 'x' }, [{ field: 'files', name: 'big.txt', type: 'text/plain', content: Buffer.alloc(24 * MIB + 1, 97) }])
      assert.equal(res.json().code, 'document_too_large')
    } finally { await high.close() }
  } finally { await env.close() }
})

test('HP-018: a video longer than 20 minutes is refused at upload with video_too_long, before anything is queued', async () => {
  const env = await realExtractEnv()
  try {
    const file = path.join(env.dir, 'long.mp4')
    // 21 minutes of a 64 x 64 black screen at one frame per second: a few hundred KB, a couple of seconds to make.
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=1', '-t', String(21 * 60), '-c:v', 'libx264', '-g', '60', '-pix_fmt', 'yuv420p', file])
    const sent = await postInput(env, env.cookie, { text: 'x' }, [{ field: 'files', name: 'long.mp4', type: 'video/mp4', content: await readFile(file) }])
    assert.equal(sent.statusCode, 422)
    assert.equal(sent.json().code, 'video_too_long')
    assert.match(sent.json().message, /21 minutos.*20/)
    nothingLeft(env)
    // A video within the limit is probed and queued as usual.
    const short = path.join(env.dir, 'short.mp4')
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=1', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', short])
    const ok = await postInput(env, env.cookie, { text: 'corto' }, [{ field: 'files', name: 'short.mp4', type: 'video/mp4', content: await readFile(short) }])
    assert.equal(ok.statusCode, 202, ok.body)
  } finally { await env.close() }
})

test('HP-018: a file that is not a readable video is not refused by the probe: the job reports it with its own code', async () => {
  const env = await realExtractEnv()
  try {
    const sent = await postInput(env, env.cookie, { text: 'x' }, [{ field: 'files', name: 'roto.mp4', type: 'video/mp4', content: 'esto no es un video' }])
    assert.equal(sent.statusCode, 202)
    const row = await failedInput(env, sent.json().input_id)
    assert.ok(['video_unreadable', 'ffmpeg_failed'].includes(row.error_code), row.error_code)
  } finally { await env.close() }
})

test('H-21: a real HEIC photo is refused at upload with image_heic_unsupported, judged by its brand and not by its name', async () => {
  const env = await realExtractEnv()
  try {
    // 1.2 KB written by libheif (brand `heic`, HEVC payload): the container is real, not a fabricated header.
    const heic = await readFile(new URL('./extract/test/fixtures/libheif.heic', import.meta.url))
    for (const [name, type] of [['IMG_0001.HEIC', 'image/heic'], ['foto.jpg', 'image/jpeg']]) {
      const sent = await postInput(env, env.cookie, { text: 'x' }, [{ field: 'files', name, type, content: heic }])
      assert.equal(sent.statusCode, 422, name)
      assert.equal(sent.json().code, 'image_heic_unsupported', name)
    }
    nothingLeft(env)
  } finally { await env.close() }
})
