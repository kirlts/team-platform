// POST /messages/:id/replies with media (multipart): same limits and storage as POST /inputs; the attachments are
// stored and served, never analyzed. UD-016 draws one icon per media kind in each reply.

import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { test } from 'node:test'
import { all, get } from '../db/index.js'
import { sweepOrphans } from '../domain/storage.js'
import { addMember, login, makeEnv, multipart, postInput, until } from '../testing/helpers.js'

const noIpLimit = { identity: { login: { ipMax: 1000 } } }

async function team (opts = {}) {
  const env = await makeEnv({ ...opts, config: { ...noIpLimit, ...(opts.config ?? {}) } })
  await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' })
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  await addMember(env, { email: 'beto@x.org', name: 'Beto' })
  env.c = { ed: await login(env, 'ed@x.org'), ana: await login(env, 'ana@x.org'), beto: await login(env, 'beto@x.org') }
  env.api = (method, url, cookie, payload) => env.app.inject({ method, url: `/api${url}`, headers: { cookie, 'x-team-request': 'panel' }, payload })
  env.reply = async (messageId, cookie, fields, files = []) => {
    const { payload, headers } = await multipart(fields, files)
    return env.app.inject({ method: 'POST', url: `/api/messages/${messageId}/replies`, payload, headers: { ...headers, cookie, 'x-team-request': 'panel' } })
  }
  return env
}

/** A message of Ana, open. */
async function openMessage (env) {
  const { input_id: id } = (await postInput(env, env.c.ana, { text: 'algo' })).json()
  const view = await until(async () => {
    const v = (await env.api('GET', `/inputs/${id}`, env.c.ana)).json()
    return v.status === 'proposed' ? v : null
  })
  const r = await env.api('POST', `/inputs/${id}/publish`, env.c.ana, { messages: view.proposal.messages })
  return r.json().message_ids[0]
}

const PNG = { field: 'files', name: 'captura.png', type: 'image/png', content: 'PNG-bytes-0123456789' }
const PDF = { field: 'files', name: 'informe.pdf', type: 'application/pdf', content: '%PDF-1.4 contenido' }

test('a reply carries files and links: stored, listed with their kinds, and served to the whole team', async () => {
  const env = await team({ worker: true })
  const messageId = await openMessage(env)
  const r = await env.reply(messageId, env.c.beto, { body: 'Mira la captura', kind: 'clarification', links: 'https://example.org/ticket' }, [PNG, PDF])
  assert.equal(r.statusCode, 201, r.body)
  const mine = r.json().replies[0]
  assert.equal(mine.body, 'Mira la captura')
  assert.equal(mine.kind, 'clarification')
  assert.deepEqual(mine.attachments.map((a) => a.kind), ['image', 'document', 'link'])
  assert.deepEqual(mine.attachment_kinds, ['image', 'document', 'link'])
  assert.equal(mine.attachments[0].name, 'captura.png')
  assert.equal(mine.attachments[0].size, PNG.content.length)
  assert.equal(r.json().status, 'answered')
  assert.deepEqual(r.json().attachment_kinds, []) // the message's own media are untouched
  assert.deepEqual(r.json().last_reply.attachment_kinds, ['image', 'document', 'link'])

  // The thread, the card and the detail all show them.
  assert.deepEqual((await env.api('GET', `/messages/${messageId}`, env.c.ed)).json().replies[0].attachments, mine.attachments)
  assert.deepEqual((await env.api('GET', '/messages', env.c.ed)).json().items[0].last_reply.attachment_kinds, ['image', 'document', 'link'])

  // The file is served from its own route, with Range, to every member with a session.
  const png = mine.attachments[0]
  const ask = (cookie, headers = {}) => env.app.inject({ url: `/api/replies/attachments/${png.id}`, headers: { cookie, ...headers } })
  for (const who of ['ed', 'ana', 'beto']) assert.equal((await ask(env.c[who])).body, PNG.content)
  const range = await ask(env.c.ana, { range: 'bytes=0-2' })
  assert.equal(range.statusCode, 206)
  assert.equal(range.body, 'PNG')
  assert.equal((await ask(env.c.ana)).headers['content-type'], 'image/png')
  assert.equal((await env.app.inject({ url: `/api/replies/attachments/${png.id}` })).statusCode, 401)
  assert.equal((await env.app.inject({ url: '/api/replies/attachments/999', headers: { cookie: env.c.ana } })).statusCode, 404)
  const link = mine.attachments[2]
  assert.equal((await env.app.inject({ url: `/api/replies/attachments/${link.id}`, headers: { cookie: env.c.ana } })).statusCode, 404) // a link is not a file
  await env.close()
})

test('a reply with media may have no text; a reply with neither is 400 in Spanish', async () => {
  const env = await team({ worker: true })
  const messageId = await openMessage(env)
  const mediaOnly = await env.reply(messageId, env.c.beto, {}, [PNG])
  assert.equal(mediaOnly.statusCode, 201, mediaOnly.body)
  assert.equal(mediaOnly.json().replies[0].body, '')
  const empty = await env.reply(messageId, env.c.beto, { body: '   ' })
  assert.equal(empty.statusCode, 400)
  assert.equal(empty.json().code, 'reply_empty')
  assert.match(empty.json().message, /vacía/)
  const jsonEmpty = await env.api('POST', `/messages/${messageId}/replies`, env.c.beto, { body: '' })
  assert.equal(jsonEmpty.statusCode, 400)
  assert.equal((await env.reply(messageId, env.c.beto, { body: 'x', kind: 'inventado' })).json().code, 'reply_kind_invalid')
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM replies').n, 1)
  await env.close()
})

test('HP-009 · the sender cannot reply with media either, and nothing is stored; a closed message refuses too', async () => {
  const env = await team({ worker: true })
  const messageId = await openMessage(env)
  const before = readdirSync(env.config.attachmentsDir).length
  const own = await env.reply(messageId, env.c.ana, { body: 'yo' }, [PNG])
  assert.equal(own.statusCode, 403)
  assert.equal(own.json().code, 'author_cannot_reply')
  assert.equal(readdirSync(env.config.attachmentsDir).length, before) // refused before the upload was stored
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM reply_attachments').n, 0)
  await env.api('POST', `/messages/${messageId}/close`, env.c.ed)
  const closed = await env.reply(messageId, env.c.beto, { body: 'tarde' }, [PNG])
  assert.equal(closed.statusCode, 409)
  assert.equal(closed.json().code, 'message_closed')
  assert.equal((await env.reply(9999, env.c.beto, { body: 'x' })).statusCode, 404)
  await env.close()
})

test('a reply upload has the limits of an input upload: size per kind, number of files and of links, accepted formats', async () => {
  const env = await team({ worker: true, config: { uploads: { maxImageBytes: 10, maxFiles: 2, maxLinks: 1 } } })
  const messageId = await openMessage(env)
  const big = await env.reply(messageId, env.c.beto, { body: 'x' }, [{ ...PNG, content: 'x'.repeat(11) }])
  assert.equal(big.statusCode, 413)
  assert.match(big.json().message, /supera el máximo/)
  const three = await env.reply(messageId, env.c.beto, { body: 'x' }, [PDF, PDF, PDF])
  assert.equal(three.statusCode, 413)
  const links = await env.reply(messageId, env.c.beto, { body: 'x', links: ['https://a.example', 'https://b.example'] })
  assert.equal(links.statusCode, 413)
  const svg = await env.reply(messageId, env.c.beto, { body: 'x' }, [{ field: 'files', name: 'a.svg', type: 'image/svg+xml', content: '<svg/>' }])
  assert.equal(svg.statusCode, 415)
  const badLink = await env.reply(messageId, env.c.beto, { body: 'x', links: 'ftp://a.example' })
  assert.equal(badLink.statusCode, 400)
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM replies').n, 0) // no half-made reply
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM reply_attachments').n, 0)
  await env.close()
})

test('a reply is not analyzed: no job is queued and the extractor never runs for its media', async () => {
  const extracted = []
  const env = await team({ worker: true, modules: { extract: async (a) => { extracted.push(a.kind); return { text: 't', meta: { calls: [] } } } } })
  const messageId = await openMessage(env)
  const jobsBefore = get(env.db, 'SELECT COUNT(*) AS n FROM jobs').n
  const before = extracted.length
  await env.reply(messageId, env.c.beto, { body: 'x' }, [PNG, PDF])
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM jobs').n, jobsBefore)
  assert.equal(extracted.length, before)
  const columns = all(env.db, "SELECT name FROM pragma_table_info('reply_attachments')").map((c) => c.name)
  assert.deepEqual(columns.filter((n) => /extract/.test(n)), []) // the table has nowhere to put an extraction
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM reply_attachments').n, 2)
  await env.close()
})

test('the orphan sweep keeps a file that only a reply references', async () => {
  const env = await team({ worker: true })
  const messageId = await openMessage(env)
  const r = await env.reply(messageId, env.c.beto, { body: 'x' }, [PNG])
  assert.equal(r.statusCode, 201)
  const removed = await sweepOrphans(env.db, env.config, 0, Date.now() + 1000)
  assert.equal(removed, 0)
  const png = r.json().replies[0].attachments[0]
  assert.equal((await env.app.inject({ url: `/api/replies/attachments/${png.id}`, headers: { cookie: env.c.ana } })).statusCode, 200)
  await env.close()
})

test('the contract documents JSON and multipart for a reply and the file route', async () => {
  const env = await makeEnv()
  const doc = (await env.app.inject({ url: '/api/openapi.json' })).json()
  const content = doc.paths['/api/messages/{id}/replies'].post.requestBody.content
  assert.deepEqual(Object.keys(content).sort(), ['application/json', 'multipart/form-data'])
  assert.deepEqual(Object.keys(content['multipart/form-data'].schema.properties).sort(), ['body', 'files', 'kind', 'links'])
  assert.equal(content['application/json'].schema.additionalProperties, false)
  assert.ok(doc.paths['/api/replies/attachments/{id}'].get.responses['200'])
  const replySchema = doc.paths['/api/messages/{id}/replies'].post.responses['201'].content['application/json'].schema.properties.replies.items.properties
  assert.ok(replySchema.attachments && replySchema.attachment_kinds)
  await env.close()
})
