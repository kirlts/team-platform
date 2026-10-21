// HP-018 (docs/TEST.md): a video longer than 20 minutes or an attachment over its size cap is rejected with its code
// and never reaches a provider (MASTER-SPEC section 7.4).
//
// What the code does today, which is what these tests pin down:
//   - A file over the cap of its kind is refused at upload with 413 and leaves no input, job or attachment behind.
//   - A document between 24 MiB and the 25 MiB upload cap, and a video longer than 20 minutes, are accepted at upload
//     (the size of a document for the provider and the duration of a video are only known by the extractor) and fail
//     as the first step of the job, permanently (one attempt), before any provider call.
// The wording "before queueing" of HP-018 therefore holds for the size caps of the upload and not for the 24 MiB
// document cap nor for the 20 minutes of a video: see the state recorded in docs/TEST.md.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
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

test('HP-018: a document over 24 MiB is rejected by the extractor with its code, in one attempt and with no provider call', async () => {
  const env = await realExtractEnv()
  try {
    const big = Buffer.alloc(24 * MIB + 1, 97)
    const sent = await postInput(env, env.cookie, { text: 'x' }, [{ field: 'files', name: 'big.txt', type: 'text/plain', content: big }])
    assert.equal(sent.statusCode, 202)
    const row = await failedInput(env, sent.json().input_id)
    assert.equal(row.error_code, 'document_too_large')
    assert.equal(get(env.db, 'SELECT attempts FROM jobs WHERE id = ?', sent.json().job_id).attempts, 1)
    assert.deepEqual(env.calls, { vision: 0, speech: 0 })
  } finally { await env.close() }
})

test('HP-018: a video longer than 20 minutes is rejected by the extractor with its code, in one attempt and with no provider call', async () => {
  const env = await realExtractEnv()
  try {
    const file = path.join(env.dir, 'long.mp4')
    // 21 minutes of a 64 x 64 black screen at one frame per second: a few hundred KB, a couple of seconds to make.
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=1', '-t', String(21 * 60), '-c:v', 'libx264', '-g', '60', '-pix_fmt', 'yuv420p', file])
    const sent = await postInput(env, env.cookie, { text: 'x' }, [{ field: 'files', name: 'long.mp4', type: 'video/mp4', content: await readFile(file) }])
    assert.equal(sent.statusCode, 202)
    const row = await failedInput(env, sent.json().input_id)
    assert.equal(row.error_code, 'video_too_long')
    assert.equal(get(env.db, 'SELECT attempts FROM jobs WHERE id = ?', sent.json().job_id).attempts, 1)
    assert.deepEqual(env.calls, { vision: 0, speech: 0 })
  } finally { await env.close() }
})
