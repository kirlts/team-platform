// UD-240 (H-3702), UD-253: DELETE /inputs/:id?confirm=true deletes an input reversibly (POST /inputs/:id/restore brings it back); with `purge=true` it deletes
// it for real, with its attachments, jobs and proposal. The messages published from it stay with their files unless `with_messages=true`; the volume only loses
// what nothing references any more (purge).

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
const PURGE = (id, extra = '') => DELETE(id, `&purge=true${extra}`)

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

test('purge: attachments, jobs, events and proposal go, the unreferenced file leaves the volume and the audit says how much', async () => {
  const env = await team({ worker: true })
  const { input_id: id, job_id: jobId } = (await postInput(env, env.c.ana, { text: 'con captura', links: ['https://example.org/x'] }, [PNG('captura.png', 'contenido único')])).json()
  await env.waitFor(id, 'proposed')
  const [file] = env.blobs(id)
  assert.ok(existsSync(file))
  assert.ok(get(env.db, 'SELECT 1 AS x FROM proposals WHERE input_id = ?', id))
  assert.ok(all(env.db, 'SELECT 1 AS x FROM job_events WHERE job_id = ?', jobId).length > 0)

  const res = await env.api('DELETE', PURGE(id), env.c.ana)
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

test('purge: a job that is running is cancelled before its row goes, and the worker applies nothing', async () => {
  const analyze = (bundle, { signal }) => new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted'))) })
  const env = await team({ worker: true, modules: { analyze } })
  const { input_id: id, job_id: jobId } = (await postInput(env, env.c.ana, { text: 'lento' })).json()
  await until(() => get(env.db, 'SELECT status FROM jobs WHERE id = ?', jobId).status === 'running')
  let cancelledSignal = null
  env.queue.signals.once('cancelled', (j) => { cancelledSignal = j })
  const res = await env.api('DELETE', PURGE(id), env.c.ana)
  assert.equal(res.statusCode, 200, res.body)
  assert.equal(res.json().deleted.jobs, 1)
  assert.equal(cancelledSignal, Number(jobId)) // the worker learns of it through the signal
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM jobs WHERE id = ?', jobId).n, 0)
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM inputs WHERE id = ?', id).n, 0)
  await env.close()
})

test('purge: the published messages stay with their files; with_messages=true takes them too and frees the file', async () => {
  const env = await team({ worker: true, autoPublish: true })
  const { input_id: id } = (await postInput(env, env.c.ana, { text: 'publicado con captura' }, [PNG('captura.png', 'archivo del mensaje')])).json()
  await env.waitFor(id, 'published')
  const [file] = env.blobs(id)
  const messageIds = (await env.api('GET', `/inputs/${id}`, env.c.ana)).json().message_ids
  assert.equal(messageIds.length, 1)
  const attachmentId = get(env.db, 'SELECT attachment_id FROM message_attachments WHERE message_id = ?', messageIds[0]).attachment_id

  const kept = await env.api('DELETE', PURGE(id), env.c.ana)
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
  const withMessages = await env.api('DELETE', PURGE(second, '&with_messages=true'), env.c.ana)
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
  const last = await env.api('DELETE', PURGE(third, '&with_messages=true'), env.c.ana)
  assert.equal(last.statusCode, 200, last.body)
  assert.equal(last.json().freed_bytes, Buffer.byteLength('archivo del mensaje'))
  assert.ok(!existsSync(file))
  await env.close()
})

test('purge: a file shared with another send stays on disk until the last send that has it goes', async () => {
  const env = await team()
  const first = (await postInput(env, env.c.ana, { text: 'uno' }, [PNG('a.png', 'compartido')])).json().input_id
  const second = (await postInput(env, env.c.beto, { text: 'dos' }, [PNG('b.png', 'compartido')])).json().input_id
  const [file] = env.blobs(first)
  assert.deepEqual(env.blobs(second), [file])
  const r1 = await env.api('DELETE', PURGE(first), env.c.ana)
  assert.equal(r1.json().freed_bytes, 0)
  assert.ok(existsSync(file))
  const r2 = await env.api('DELETE', PURGE(second), env.c.beto)
  assert.equal(r2.json().freed_bytes, Buffer.byteLength('compartido'))
  assert.ok(!existsSync(file))
  await env.close()
})

// ---- UD-253: the deletion is reversible

test('deletion: it is reversible: the send leaves every list and its read, and restoring it brings it back as it was, with the file still on disk', async () => {
  const env = await team({ worker: true })
  const { input_id: id } = (await postInput(env, env.c.ana, { text: 'con captura' }, [PNG('captura.png', 'contenido que se queda')])).json()
  await env.waitFor(id, 'proposed')
  const [file] = env.blobs(id)
  const proposal = (await env.api('GET', `/inputs/${id}`, env.c.ana)).json().proposal

  const res = await env.api('DELETE', DELETE(id), env.c.ana)
  assert.equal(res.statusCode, 200, res.body)
  assert.equal(res.json().restorable, true)
  assert.equal(res.json().freed_bytes, 0)
  assert.ok(existsSync(file), 'nothing leaves the volume while the deletion can be undone')
  assert.equal((await env.api('GET', `/inputs/${id}`, env.c.ana)).statusCode, 404)
  const listed = (await env.api('GET', '/inputs?mine=1&order=desc', env.c.ana)).json().items
  assert.ok(!listed.some((i) => String(i.id) === String(id)), 'the list of the sender does not hold it')
  const queue = (await env.api('GET', '/inputs?everyone=1', env.c.ed)).json().items ?? []
  assert.ok(!queue.some((i) => String(i.id) === String(id)), 'the queue of the team does not hold it')
  assert.equal((await env.api('POST', `/inputs/${id}/publish`, env.c.ana, {})).statusCode, 404, 'a deleted proposal is not published')
  assert.equal((await env.api('POST', `/inputs/${id}/cancel`, env.c.ana)).statusCode, 404)
  assert.equal((await env.api('DELETE', DELETE(id), env.c.ana)).statusCode, 404, 'it is not deleted twice')

  const back = await env.api('POST', `/inputs/${id}/restore`, env.c.ana)
  assert.equal(back.statusCode, 200, back.body)
  assert.equal(back.json().status, 'proposed')
  const view = (await env.api('GET', `/inputs/${id}`, env.c.ana)).json()
  assert.equal(view.status, 'proposed')
  assert.deepEqual(view.proposal, proposal, 'the proposal is the one it had')
  assert.equal(view.attachments.length, 1)
  assert.equal((await env.api('POST', `/inputs/${id}/restore`, env.c.ana)).statusCode, 409, 'a send that is not deleted is not restored')
  const row = JSON.parse(get(env.db, "SELECT detail_json FROM audit_log WHERE action = 'input.restore' AND entity_id = ?", id).detail_json)
  assert.equal(row.deletion, true)
  await env.close()
})

test('deletion: the published messages lose their send while it is deleted and get it back; with_messages=true they go to the trash with it and come back with it', async () => {
  const env = await team({ worker: true, autoPublish: true })
  const mine = (await postInput(env, env.c.ana, { text: 'Primera idea para el equipo.' })).json().input_id
  const both = (await postInput(env, env.c.ana, { text: 'Segunda idea distinta para el equipo.' })).json().input_id
  await env.waitFor(mine, 'published')
  await env.waitFor(both, 'published')
  const idsOf = (input) => all(env.db, 'SELECT id FROM messages WHERE input_id = ? OR unlinked_input_id = ? ORDER BY id', input, input).map((m) => m.id)
  const keptIds = idsOf(mine)
  const goneIds = idsOf(both)
  assert.ok(keptIds.length > 0 && goneIds.length > 0)

  assert.equal((await env.api('DELETE', DELETE(mine), env.c.ana)).statusCode, 200)
  assert.equal((await env.api('DELETE', DELETE(both, '&with_messages=true'), env.c.ana)).json().deleted.messages, goneIds.length)
  for (const id of keptIds) {
    const m = get(env.db, 'SELECT input_id, unlinked_input_id, deleted_at FROM messages WHERE id = ?', id)
    assert.equal(m.input_id, null)
    assert.equal(String(m.unlinked_input_id), String(mine))
    assert.equal(m.deleted_at, null, 'without with_messages the messages stay in the list')
  }
  for (const id of goneIds) assert.notEqual(get(env.db, 'SELECT deleted_at FROM messages WHERE id = ?', id).deleted_at, null)

  assert.equal((await env.api('POST', `/inputs/${mine}/restore`, env.c.ana)).statusCode, 200)
  assert.equal((await env.api('POST', `/inputs/${both}/restore`, env.c.ana)).statusCode, 200)
  for (const id of [...keptIds, ...goneIds]) {
    const m = get(env.db, 'SELECT input_id, unlinked_input_id, deleted_at FROM messages WHERE id = ?', id)
    assert.notEqual(m.input_id, null, 'the message has its send again')
    assert.equal(m.unlinked_input_id, null)
    assert.equal(m.deleted_at, null, 'and is out of the trash')
  }
  await env.close()
})

test('deletion: a message that was in the trash before its send was deleted stays there when the send comes back', async () => {
  const env = await team({ worker: true, autoPublish: true })
  const { input_id: id } = (await postInput(env, env.c.ana, { text: 'Una idea que se borra antes.' })).json()
  await env.waitFor(id, 'published')
  const [message] = idsOf(env, id)
  assert.equal((await env.api('DELETE', `/messages/${message}?confirm=true`, env.c.ana)).statusCode, 204)
  assert.equal((await env.api('DELETE', DELETE(id, '&with_messages=true'), env.c.ana)).statusCode, 200)
  assert.equal((await env.api('POST', `/inputs/${id}/restore`, env.c.ana)).statusCode, 200)
  const m = get(env.db, 'SELECT deleted_at FROM messages WHERE id = ?', message)
  assert.notEqual(m.deleted_at, null, 'the message the person had deleted by itself is still deleted')
  await env.close()
})

function idsOf (env, input) {
  return all(env.db, 'SELECT id FROM messages WHERE input_id = ? ORDER BY id', input).map((m) => m.id)
}

test('deletion: a send in flight is left cancelled and comes back as a discard is undone; the worker does not bring it back by itself', async () => {
  const analyze = (bundle, { signal }) => new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted'))) })
  const env = await team({ worker: true, modules: { analyze } })
  const { input_id: id, job_id: jobId } = (await postInput(env, env.c.ana, { text: 'lento' })).json()
  await until(() => get(env.db, 'SELECT status FROM jobs WHERE id = ?', jobId).status === 'running')
  assert.equal((await env.api('DELETE', DELETE(id), env.c.ana)).statusCode, 200)
  assert.equal(get(env.db, 'SELECT status FROM inputs WHERE id = ?', id).status, 'cancelled')
  const back = await env.api('POST', `/inputs/${id}/restore`, env.c.ana)
  assert.equal(back.statusCode, 200, back.body)
  assert.equal(back.json().status, 'failed')
  assert.equal((await env.api('GET', `/inputs/${id}`, env.c.ana)).json().status, 'failed')
  await env.close()
})

test('deletion: restoring is for the sender or the team, and sending the same content again after deleting is a new send', async () => {
  const env = await team({ worker: true })
  const { input_id: id } = (await postInput(env, env.c.ana, { text: 'mismo texto' })).json()
  await env.waitFor(id, 'proposed')
  assert.equal((await env.api('DELETE', DELETE(id), env.c.ana)).statusCode, 200)
  assert.equal((await env.api('POST', `/inputs/${id}/restore`, env.c.beto)).statusCode, 200, 'a person of the team restores it')
  assert.equal((await env.api('DELETE', DELETE(id), env.c.ana)).statusCode, 200)
  const again = (await postInput(env, env.c.ana, { text: 'mismo texto' })).json()
  assert.notEqual(String(again.input_id), String(id), 'the same content after a deletion is not the deleted send')
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM inputs WHERE id = ?', id).n, 0, 'the deleted one is superseded')
  assert.equal((await env.api('POST', `/inputs/${id}/restore`, env.c.ana)).statusCode, 404)
  await env.close()
})

test('deletion: purge=true on a deleted send takes it for good', async () => {
  const env = await team({ worker: true })
  const { input_id: id } = (await postInput(env, env.c.ana, { text: 'para siempre' })).json()
  await env.waitFor(id, 'proposed')
  assert.equal((await env.api('DELETE', DELETE(id), env.c.ana)).statusCode, 200)
  const purged = await env.api('DELETE', PURGE(id), env.c.ana)
  assert.equal(purged.statusCode, 200, purged.body)
  assert.equal(purged.json().restorable, false)
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM inputs WHERE id = ?', id).n, 0)
  await env.close()
})
