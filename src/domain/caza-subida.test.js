// Hunt for the failures of the path of a send (2026-10-24), part of the pipeline: what an extraction failure looks like to the queue and to the person who sent.
// Each case was reproduced before it was fixed. A transient failure is retried, a permanent one fails at once, and the reason is one its sender can read.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { describe, it } from 'node:test'
import { get } from '../db/index.js'
import { createAudioBudget, estimateAudioSeconds, extract } from '../extract/index.js'
import { addMember, login, makeEnv, postInput, until } from '../testing/helpers.js'

// A test that needs a binary says so and skips when it is missing: the deployment machine does not carry ffmpeg (the image of Team Platform does).
const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0

const fast = { identity: { login: { ipMax: 1000 } }, worker: { retryBaseMs: 5, retryMaxMs: 20 } }
const textFile = (name = 'a.txt', content = 'contenido') => ({ field: 'files', name, type: 'text/plain', content })
const extractError = (code, message, details = {}) => Object.assign(new Error(message), { name: 'ExtractError', code, details })

async function setup (opts = {}) {
  const env = await makeEnv({ ...opts, config: { ...fast, ...(opts.config ?? {}), worker: { ...fast.worker, ...(opts.config?.worker ?? {}) } } })
  await addMember(env, { email: 'ana@x.org' })
  env.ana = await login(env, 'ana@x.org')
  env.submit = async (text, files = []) => (await postInput(env, env.ana, { text }, files)).json()
  env.input = (id) => get(env.db, 'SELECT * FROM inputs WHERE id = ?', id)
  env.attempts = (jobId) => get(env.db, 'SELECT attempts FROM jobs WHERE id = ?', jobId).attempts
  return env
}


describe('the extraction jobs classify what fails', () => {
  it('H-3800: an audio that cannot be read fails at once, with its name, instead of being retried by the measurement of its length', { skip: hasFfmpeg ? false : 'ffmpeg is not installed on this machine' }, async () => {
    const env = await setup({
      worker: true,
      modules: { extract, estimateAudioSeconds, audioBudget: createAudioBudget(), getProviders: () => ({ speech: { transcribe: async () => ({ text: 'x', segments: [] }) } }) }
    })
    const { input_id: id, job_id: jobId } = await env.submit('nota', [{ field: 'files', name: 'nota.mp3', type: 'audio/mpeg', content: 'esto no es audio, son bytes cualquiera'.repeat(50) }])
    await until(() => env.input(id).status === 'failed')
    assert.equal(env.attempts(jobId), 1, 'a damaged file does not improve on retry')
    assert.equal(env.input(id).error_code, 'ffmpeg_failed')
    assert.match(env.input(id).error, /«nota\.mp3»/)
    await env.close()
  })

  it('H-3801: a site that answers 503, 429 or 502 is retried; one that answers 404 fails at once', async () => {
    for (const [status, retried] of [[503, true], [429, true], [502, true], [404, false], [403, false]]) {
      let calls = 0
      const env = await setup({
        worker: true,
        modules: { extract: async () => { calls++; if (calls < 2 && retried) throw extractError('link_http_error', `El enlace respondió con el código ${status}.`, { status }); if (retried) return { text: 'página', meta: {} }; throw extractError('link_http_error', `El enlace respondió con el código ${status}.`, { status }) } }
      })
      const { input_id: id, job_id: jobId } = await env.submit('mira', [])
      // A link attachment is what carries the extractor; the text-only send has none, so the link goes in the JSON body.
      const r = await env.app.inject({ method: 'POST', url: '/api/inputs', headers: { cookie: env.ana, 'x-team-request': 'panel' }, payload: { text: `enlace ${status}`, links: ['https://ejemplo.org/pagina'] } })
      const linked = r.json()
      await until(() => ['proposed', 'failed'].includes(env.input(linked.input_id).status))
      assert.equal(env.input(linked.input_id).status, retried ? 'proposed' : 'failed', `status ${status}`)
      assert.equal(env.attempts(linked.job_id), retried ? 2 : 1, `status ${status}`)
      void id; void jobId
      await env.close()
    }
  })

  it('H-3802: a failure of an extractor that carries no code of its own reaches the sender with the attachment name and a code the panel translates', async () => {
    const env = await setup({ worker: true, modules: { extract: async () => { throw new TypeError("Cannot read properties of undefined (reading 'width')") } } })
    const { input_id: id } = await env.submit('x', [textFile('foto.txt')])
    await until(() => env.input(id).status === 'failed')
    assert.equal(env.input(id).error_code, 'extract_failed')
    assert.match(env.input(id).error, /^«foto\.txt»: no se pudo leer el adjunto/)
    await env.close()
  })
})


describe('the hourly audio budget', () => {
  it('H-3819: an audio added to a published message spends the hourly budget and waits when it is spent, like the audio of a send', async () => {
    const budget = createAudioBudget({ secondsPerHour: 1000 })
    let extracted = 0
    const env = await setup({
      worker: true,
      modules: { audioBudget: budget, estimateAudioSeconds: async () => 600, extract: async () => { extracted++; return { text: 'transcripción', meta: {} } } }
    })
    const { input_id: id } = await env.submit('nota', [{ field: 'files', name: 'a.mp3', type: 'audio/mpeg', content: 'bytes' }])
    await until(() => env.input(id).status === 'proposed')
    assert.equal(budget.used(), 600, 'the send spent 600 s')
    const attachmentId = get(env.db, 'SELECT id FROM attachments WHERE input_id = ?', id).id
    const jobId = env.queue.enqueue('extract', { attachment_id: attachmentId })
    await until(() => env.queue.getJob(jobId).status === 'queued' && env.queue.getJob(jobId).run_at > Date.now() + 1000)
    assert.equal(extracted, 1, 'the second audio did not fit in the hour: it did not transcribe')
    assert.equal(env.queue.getJob(jobId).attempts, 0, 'waiting does not spend an attempt')
    await env.close()
  })
})


