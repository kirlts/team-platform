// API gaps of the panel (UD-025): editing the text of an input, retrying one's own failed analysis, the tray with failed inputs.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { all, get } from '../db/index.js'
import { addMember, fakeAnalyze, login, makeEnv, postInput, until } from '../testing/helpers.js'

/** Team with an analyzer that fails permanently while `env.failing` is true and records the text it analyzed. */
async function team () {
  const seen = []
  const state = { failing: false }
  const env = await makeEnv({
    worker: true,
    config: { identity: { login: { ipMax: 1000 } } },
    modules: {
      analyze: async (bundle, opts) => {
        seen.push(bundle.text)
        if (state.failing) throw Object.assign(new Error('the model rejected the submission'), { code: 'refusal', retryable: false })
        return fakeAnalyze(bundle, opts)
      }
    }
  })
  await addMember(env, { email: 'ana@x.org' })
  await addMember(env, { email: 'beto@x.org' })
  await addMember(env, { email: 'ed@x.org', role: 'editor' })
  env.c = { ana: await login(env, 'ana@x.org'), beto: await login(env, 'beto@x.org'), ed: await login(env, 'ed@x.org') }
  env.seen = seen
  env.state = state
  env.api = (method, url, cookie, payload) => env.app.inject({ method, url: `/api${url}`, headers: { cookie, 'x-team-request': 'panel' }, payload })
  env.statusOf = (id) => get(env.db, 'SELECT status FROM inputs WHERE id = ?', id).status
  env.send = async (cookie, text, files = []) => Number((await postInput(env, cookie, { text }, files)).json().input_id)
  return env
}

test('PATCH /inputs/:id: the author changes the text of a proposed input and the analysis runs again with the new text', async () => {
  const env = await team()
  const id = await env.send(env.c.ana, 'texto original', [{ field: 'files', name: 'a.txt', type: 'text/plain', content: 'adjunto' }])
  await until(() => env.statusOf(id) === 'proposed')
  const before = get(env.db, 'SELECT content_hash FROM inputs WHERE id = ?', id).content_hash
  const res = await env.api('PATCH', `/inputs/${id}`, env.c.ana, { text: 'texto corregido' })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().text, 'texto corregido')
  assert.equal(res.json().status, 'queued')
  assert.equal(res.json().proposed_count, 0)
  assert.equal(res.json().attachments.length, 1)
  await until(() => env.statusOf(id) === 'proposed')
  assert.equal(env.seen.at(-1), 'texto corregido')
  assert.equal(all(env.db, 'SELECT id FROM attachments WHERE input_id = ?', id).length, 1) // the attachment stays
  assert.notEqual(get(env.db, 'SELECT content_hash FROM inputs WHERE id = ?', id).content_hash, before)
  const row = get(env.db, "SELECT member_id, entity_id FROM audit_log WHERE action = 'input.edit'")
  assert.equal(row.entity_id, id)
  assert.equal(JSON.parse(get(env.db, "SELECT detail_json FROM audit_log WHERE action = 'input.edit'").detail_json).chars, 'texto corregido'.length)
  await env.close()
})

test('PATCH /inputs/:id: a failed input is edited and analyzed again; the error is cleared', async () => {
  const env = await team()
  env.state.failing = true
  const id = await env.send(env.c.ana, 'se rechaza')
  await until(() => env.statusOf(id) === 'failed')
  env.state.failing = false
  const res = await env.api('PATCH', `/inputs/${id}`, env.c.ana, { text: 'se acepta' })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().error, null)
  await until(() => env.statusOf(id) === 'proposed')
  await env.close()
})

test('PATCH /inputs/:id: only the author, only while proposed or failed, never an empty or duplicated input', async () => {
  const env = await team()
  const id = await env.send(env.c.ana, 'uno')
  const other = await env.send(env.c.ana, 'dos')
  await until(() => env.statusOf(id) === 'proposed' && env.statusOf(other) === 'proposed')
  const patch = (cookie, target, text) => env.api('PATCH', `/inputs/${target}`, cookie, { text })
  assert.equal((await patch(env.c.beto, id, 'x')).statusCode, 404) // of someone else
  assert.equal((await patch(env.c.ed, id, 'x')).statusCode, 404) // not even the editor
  assert.equal((await patch(env.c.ana, id, '   ')).statusCode, 400) // empty, no attachments
  const dup = await patch(env.c.ana, id, 'dos')
  assert.equal(dup.statusCode, 409)
  assert.equal(dup.json().code, 'duplicate_input')
  assert.equal((await env.api('PATCH', `/inputs/${id}`, env.c.ana, { text: 'x', extra: 1 })).statusCode, 400)
  assert.equal((await env.api('PATCH', `/inputs/${id}`, env.c.ana, {})).statusCode, 400)
  assert.equal((await patch(env.c.ana, 99999, 'x')).statusCode, 404)
  // The proposal of the rejected edits is untouched.
  assert.equal(env.statusOf(id), 'proposed')
  // Published: no longer editable.
  const v = (await env.api('GET', `/inputs/${id}`, env.c.ana)).json()
  await env.api('POST', `/inputs/${id}/publish`, env.c.ana, { messages: v.proposal.messages })
  const published = await patch(env.c.ana, id, 'tarde')
  assert.equal(published.statusCode, 409)
  assert.equal(published.json().code, 'not_editable')
  // In flight: queued is not editable either.
  await env.worker.stop()
  const queued = await env.send(env.c.ana, 'en cola')
  assert.equal((await patch(env.c.ana, queued, 'cambio')).json().code, 'not_editable')
  await env.close()
})

test('POST /inputs/:id/reprocess: the author retries their own failed analysis, others cannot, the editor can', async () => {
  const env = await team()
  env.state.failing = true
  const id = await env.send(env.c.ana, 'falla primero')
  await until(() => env.statusOf(id) === 'failed')
  env.state.failing = false
  assert.equal((await env.api('POST', `/inputs/${id}/reprocess`, env.c.beto)).statusCode, 404)
  const res = await env.api('POST', `/inputs/${id}/reprocess`, env.c.ana)
  assert.equal(res.statusCode, 202)
  await until(() => env.statusOf(id) === 'proposed')
  assert.equal(get(env.db, "SELECT member_id FROM audit_log WHERE action = 'input.reprocess'").member_id, get(env.db, 'SELECT id FROM members WHERE email = ?', 'ana@x.org').id)
  assert.equal((await env.api('POST', `/inputs/${id}/reprocess`, env.c.ed)).statusCode, 202)
  await until(() => env.statusOf(id) === 'proposed')
  await env.close()
})

test('tray: a failed input appears with its error, proposed_count 0 and job percent and phrase', async () => {
  const env = await team()
  env.state.failing = true
  const failed = await env.send(env.c.ana, 'falla')
  await until(() => env.statusOf(failed) === 'failed')
  env.state.failing = false
  const proposed = await env.send(env.c.ana, 'sale bien')
  await until(() => env.statusOf(proposed) === 'proposed')
  const body = (await env.api('GET', '/inputs?mine=1&status=queued,extracting,analyzing,proposed,failed', env.c.ana)).json()
  assert.deepEqual(body.items.map((i) => [i.id, i.status, i.proposed_count]), [[String(failed), 'failed', 0], [String(proposed), 'proposed', 1]])
  assert.equal(body.items[0].error, 'the model rejected the submission')
  assert.equal(body.items[0].error_code, 'refusal')
  assert.equal(typeof body.items[0].job.percent, 'number')
  assert.equal(typeof body.items[0].job.phrase, 'string')
  assert.equal(body.items[1].job.percent, 100)
  assert.equal(body.items[1].job.phrase, 'Borrador listo')
  await env.close()
})

test('GET /areas: unresolved_count counts open plus answered messages, open_count only open', async () => {
  const env = await team()
  const id = await env.send(env.c.ana, 'una pregunta')
  await until(() => env.statusOf(id) === 'proposed')
  const v = (await env.api('GET', `/inputs/${id}`, env.c.ana)).json()
  await env.api('POST', `/inputs/${id}/publish`, env.c.ana, { messages: v.proposal.messages })
  const areaId = v.proposal.messages[0].area_id
  const countsOf = async () => (await env.api('GET', '/areas', env.c.ana)).json().find((a) => a.id === areaId)
  const mid = get(env.db, 'SELECT id FROM messages WHERE input_id = ?', id).id
  assert.deepEqual([(await countsOf()).open_count, (await countsOf()).unresolved_count], [1, 1])
  env.db.exec(`UPDATE messages SET status = 'answered' WHERE id = ${mid}`)
  assert.deepEqual([(await countsOf()).open_count, (await countsOf()).unresolved_count], [0, 1])
  env.db.exec(`UPDATE messages SET status = 'closed' WHERE id = ${mid}`)
  assert.deepEqual([(await countsOf()).open_count, (await countsOf()).unresolved_count], [0, 0])
  await env.close()
})

test('POST /inputs/:id/cancel and /restore: a failed analysis can be discarded, and a discard is undone with its edits (J1-B-26)', async () => {
  const env = await team()
  // A failed analysis is discarded (it used to be a 409: failed could only go back to queued) and restored as failed.
  env.state.failing = true
  const bad = await env.send(env.c.ana, 'este falla')
  await until(() => env.statusOf(bad) === 'failed')
  assert.equal((await env.api('POST', `/inputs/${bad}/cancel`, env.c.ana)).statusCode, 200)
  assert.equal(env.statusOf(bad), 'cancelled')
  assert.equal((await env.api('POST', `/inputs/${bad}/restore`, env.c.ana)).json().status, 'failed')
  assert.equal(env.statusOf(bad), 'failed')

  // A proposed input comes back proposed, with the draft the person had edited and without analyzing again.
  env.state.failing = false
  const id = await env.send(env.c.ana, 'este se descarta y se recupera')
  await until(() => env.statusOf(id) === 'proposed')
  const view = (await env.api('GET', `/inputs/${id}`, env.c.ana)).json()
  const edited = { ...view.proposal, messages: view.proposal.messages.map((m) => ({ ...m, title: 'Título editado antes de descartar' })) }
  assert.equal((await env.api('PATCH', `/inputs/${id}/proposal`, env.c.ana, edited)).statusCode, 200)
  const analyzed = env.seen.length
  assert.equal((await env.api('POST', `/inputs/${id}/cancel`, env.c.ana)).statusCode, 200)
  const back = await env.api('POST', `/inputs/${id}/restore`, env.c.ana)
  assert.equal(back.statusCode, 200)
  assert.equal(back.json().status, 'proposed')
  assert.equal((await env.api('GET', `/inputs/${id}`, env.c.ana)).json().proposal.messages[0].title, 'Título editado antes de descartar')
  assert.equal(env.seen.length, analyzed, 'restoring does not analyze again')

  // Only a cancelled input, and only its sender.
  assert.equal((await env.api('POST', `/inputs/${id}/restore`, env.c.ana)).json().code, 'not_cancelled')
  await env.api('POST', `/inputs/${id}/cancel`, env.c.ana)
  assert.equal((await env.api('POST', `/inputs/${id}/restore`, env.c.beto)).statusCode, 404)
  await env.close()
})
