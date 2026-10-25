// UD-240 (H-3702): DELETE /inputs/:id?confirm=true deletes an input for real, with its attachments, jobs and proposal.
// The messages published from it stay with their files unless `with_messages=true`; the volume only loses what nothing
// references any more.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { test } from 'node:test'
import { all, get } from '../db/index.js'
import { blobPath } from '../domain/storage.js'
import { addAgent, addMember, login, makeEnv, postInput, until } from '../testing/helpers.js'

const PNG = (nameValue, content = 'PNG!') => ({ field: 'files', name: nameValue, type: 'image/png', content })

async function team (opts = {}) {
  const env = await makeEnv({ config: { identity: { login: { ipMax: 1000 } } }, ...opts })
  await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' })
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  await addMember(env, { email: 'beto@x.org', name: 'Beto' })
  env.c = { ed: await login(env, 'ed@x.org'), ana: await login(env, 'ana@x.org'), beto: await login(env, 'beto@x.org') }
  env.api = (method, url, cookie, payload) => env.app.inject({ method, url: `/api${url}`, headers: { cookie, 'x-team-request': 'panel' }, payload })
  env.status = async (id, cookie = env.c.ana) => (await env.api('GET', `/inputs/${id}`, cookie)).json().status
  env.waitFor = (id, wanted) => until(async () => (await env.status(id)) === wanted)
  env.blobs = (id) => all(env.db, "SELECT sha256 FROM attachments WHERE input_id = ? AND kind <> 'link'", id).map((a) => blobPath(env.config, a.sha256))
  return env
}

const DELETE = (id, extra = '') => `/inputs/${id}?confirm=true${extra}`

test('deletion: only the sender or an Editor, and only with confirm=true', async () => {
  const env = await team()
  const { input_id: id } = (await postInput(env, env.c.ana, { text: 'mío' })).json()
  assert.equal((await env.api('DELETE', `/inputs/${id}`, env.c.ana)).statusCode, 400)
  assert.equal((await env.api('DELETE', `/inputs/${id}`, env.c.ana)).json().code, 'confirm_required')
  assert.equal((await (await addAgent(env, env.c.ed))('DELETE', DELETE(id))).statusCode, 404) // an agent that did not send it: the input does not exist
  assert.ok(get(env.db, 'SELECT 1 AS x FROM inputs WHERE id = ?', id))
  const byEditor = await env.api('DELETE', DELETE(id), env.c.ed)
  assert.equal(byEditor.statusCode, 200, byEditor.body)
  assert.equal(byEditor.json().input_id, String(id))
  assert.equal((await env.api('GET', `/inputs/${id}`, env.c.ana)).statusCode, 404)
  assert.equal((await env.api('DELETE', DELETE(id), env.c.ed)).statusCode, 404)
  await env.close()
})

test('deletion: attachments, jobs, events and proposal go, the unreferenced file leaves the volume and the audit says how much', async () => {
  const env = await team({ worker: true })
  const { input_id: id, job_id: jobId } = (await postInput(env, env.c.ana, { text: 'con captura', links: ['https://example.org/x'] }, [PNG('captura.png', 'contenido único')])).json()
  await env.waitFor(id, 'proposed')
  const [file] = env.blobs(id)
  assert.ok(existsSync(file))
  assert.ok(get(env.db, 'SELECT 1 AS x FROM proposals WHERE input_id = ?', id))
  assert.ok(all(env.db, 'SELECT 1 AS x FROM job_events WHERE job_id = ?', jobId).length > 0)

  const res = await env.api('DELETE', DELETE(id), env.c.ana)
  assert.equal(res.statusCode, 200, res.body)
  assert.deepEqual(res.json().deleted, { attachments: 2, jobs: 1, messages: 0 })
  assert.equal(res.json().freed_bytes, Buffer.byteLength('contenido único'))
  assert.ok(!existsSync(file))
  for (const table of ['attachments', 'jobs', 'proposals']) assert.equal(all(env.db, `SELECT 1 AS x FROM ${table} WHERE input_id = ?`, id).length, 0, table)
  assert.equal(all(env.db, 'SELECT 1 AS x FROM job_events WHERE job_id = ?', jobId).length, 0)
  const row = get(env.db, "SELECT * FROM audit_log WHERE action = 'input.delete' AND entity_id = ?", id)
  assert.ok(row)
  const detail = JSON.parse(row.detail_json)
  assert.equal(detail.attachments, 2)
  assert.equal(detail.jobs, 1)
  assert.equal(detail.messages, 0)
  assert.equal(detail.with_messages, false)
  await env.close()
})

test('deletion: a job that is running is cancelled before its row goes, and the worker applies nothing', async () => {
  const analyze = (bundle, { signal }) => new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted'))) })
  const env = await team({ worker: true, modules: { analyze } })
  const { input_id: id, job_id: jobId } = (await postInput(env, env.c.ana, { text: 'lento' })).json()
  await until(() => get(env.db, 'SELECT status FROM jobs WHERE id = ?', jobId).status === 'running')
  let cancelledSignal = null
  env.queue.signals.once('cancelled', (j) => { cancelledSignal = j })
  const res = await env.api('DELETE', DELETE(id), env.c.ana)
  assert.equal(res.statusCode, 200, res.body)
  assert.equal(res.json().deleted.jobs, 1)
  assert.equal(cancelledSignal, Number(jobId)) // the worker learns of it through the signal
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM jobs WHERE id = ?', jobId).n, 0)
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM inputs WHERE id = ?', id).n, 0)
  await env.close()
})

test('deletion: the published messages stay with their files; with_messages=true takes them too and frees the file', async () => {
  const env = await team({ worker: true, autoPublish: true })
  const { input_id: id } = (await postInput(env, env.c.ana, { text: 'publicado con captura' }, [PNG('captura.png', 'archivo del mensaje')])).json()
  await env.waitFor(id, 'published')
  const [file] = env.blobs(id)
  const messageIds = (await env.api('GET', `/inputs/${id}`, env.c.ana)).json().message_ids
  assert.equal(messageIds.length, 1)
  const attachmentId = get(env.db, 'SELECT attachment_id FROM message_attachments WHERE message_id = ?', messageIds[0]).attachment_id

  const kept = await env.api('DELETE', DELETE(id), env.c.ana)
  assert.equal(kept.statusCode, 200, kept.body)
  assert.deepEqual(kept.json().deleted, { attachments: 0, jobs: 1, messages: 0 }) // the one attachment is the message's now
  assert.equal(kept.json().freed_bytes, 0)
  assert.ok(existsSync(file))
  const detail = (await env.api('GET', `/messages/${messageIds[0]}`, env.c.beto))
  assert.equal(detail.statusCode, 200)
  assert.equal(detail.json().input_id, null)
  assert.deepEqual(detail.json().attachments.map((a) => a.id), [String(attachmentId)])
  assert.equal(detail.json().attachments[0].input_id, null)
  assert.equal((await env.api('GET', `/attachments/${attachmentId}`, env.c.beto)).statusCode, 200) // the team still reads the file
  assert.equal(get(env.db, 'SELECT input_id FROM attachments WHERE id = ?', attachmentId).input_id, null)

  // A second send with the same photo, published and deleted with its messages: the file goes, as nothing references it.
  const { input_id: second } = (await postInput(env, env.c.ana, { text: 'otro con la misma captura' }, [PNG('captura.png', 'archivo del mensaje')])).json()
  await env.waitFor(second, 'published')
  const secondMessages = (await env.api('GET', `/inputs/${second}`, env.c.ana)).json().message_ids
  await env.api('POST', `/messages/${secondMessages[0]}/replies`, env.c.beto, { body: 'respuesta', kind: 'answer' })
  const withMessages = await env.api('DELETE', DELETE(second, '&with_messages=true'), env.c.ana)
  assert.equal(withMessages.statusCode, 200, withMessages.body)
  assert.deepEqual(withMessages.json().deleted, { attachments: 1, jobs: 1, messages: 1 })
  assert.equal(withMessages.json().freed_bytes, 0) // the first message still references the same file
  assert.ok(existsSync(file))
  assert.equal((await env.api('GET', `/messages/${secondMessages[0]}`, env.c.beto)).statusCode, 404)
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM replies WHERE message_id = ?', secondMessages[0]).n, 0)
  assert.equal(JSON.parse(get(env.db, "SELECT detail_json FROM audit_log WHERE action = 'input.delete' AND entity_id = ?", second).detail_json).messages, 1)

  // Deleting the first message's row (the message was deleted elsewhere) and nothing else: the file is now an orphan the next deletion frees.
  const { input_id: third } = (await postInput(env, env.c.ana, { text: 'tercero, misma captura' }, [PNG('captura.png', 'archivo del mensaje')])).json()
  await env.waitFor(third, 'published')
  env.db.exec(`DELETE FROM messages WHERE id = ${Number(messageIds[0])}`)
  const last = await env.api('DELETE', DELETE(third, '&with_messages=true'), env.c.ana)
  assert.equal(last.statusCode, 200, last.body)
  assert.equal(last.json().freed_bytes, Buffer.byteLength('archivo del mensaje'))
  assert.ok(!existsSync(file))
  await env.close()
})

test('deletion: a file shared with another send stays on disk until the last send that has it goes', async () => {
  const env = await team()
  const first = (await postInput(env, env.c.ana, { text: 'uno' }, [PNG('a.png', 'compartido')])).json().input_id
  const second = (await postInput(env, env.c.beto, { text: 'dos' }, [PNG('b.png', 'compartido')])).json().input_id
  const [file] = env.blobs(first)
  assert.deepEqual(env.blobs(second), [file])
  const r1 = await env.api('DELETE', DELETE(first), env.c.ana)
  assert.equal(r1.json().freed_bytes, 0)
  assert.ok(existsSync(file))
  const r2 = await env.api('DELETE', DELETE(second), env.c.beto)
  assert.equal(r2.json().freed_bytes, Buffer.byteLength('compartido'))
  assert.ok(!existsSync(file))
  await env.close()
})
