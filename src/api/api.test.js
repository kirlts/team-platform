import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { all, get } from '../db/index.js'
import { createProviders } from '../providers/index.js'
import { addMember, fakeExtract, login, makeEnv, multipart, postInput, until } from '../testing/helpers.js'

const noIpLimit = { identity: { login: { ipMax: 1000 } } }
const TEXT_FILE = (nameValue, contents = 'contenido de prueba') => ({ field: 'files', name: nameValue, type: 'text/plain', content: contents })

/** Test team: an editor and two members with an open session. */
async function team (opts = {}) {
  const env = await makeEnv({ config: noIpLimit, ...opts })
  await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' })
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  await addMember(env, { email: 'beto@x.org', name: 'Beto' })
  env.c = {
    ed: await login(env, 'ed@x.org'),
    ana: await login(env, 'ana@x.org'),
    beto: await login(env, 'beto@x.org')
  }
  const api = (method, url, cookie, payload) => env.app.inject({ method, url: `/api${url}`, headers: { cookie, 'x-team-request': 'panel' }, payload })
  env.api = api
  return env
}

async function waitForProposal (env, cookie, inputId) {
  return until(async () => {
    const r = await env.api('GET', `/inputs/${inputId}`, cookie)
    const v = r.json()
    if (v.status === 'failed') throw new Error(`the input failed: ${v.error}`)
    return v.status === 'proposed' ? v : null
  })
}

// ---------------------------------------------------------------- full flow
test('full flow: submit, analyze, edit, publish, reply, close and reopen', async () => {
  const env = await team({ worker: true, modules: {
    extract: async (a, { onProgress }) => {
      onProgress(50, 'leyendo')
      return { text: `texto de ${a.kind}`, meta: { kind: a.kind, calls: [{ modality: 'vision', images: 1, usage: { input_tokens: 2000, output_tokens: 100 } }] } }
    }
  } })
  const r = await postInput(env, env.c.ana, { text: 'el botón de guardar no responde', links: 'https://example.org/p' }, [TEXT_FILE('nota.txt')])
  assert.equal(r.statusCode, 202)
  const { input_id: inputId, job_id: jobId, duplicate } = r.json()
  assert.equal(duplicate, false)
  assert.ok(jobId)

  const view = await waitForProposal(env, env.c.ana, inputId)
  assert.equal(view.attachments.length, 2)
  assert.ok(view.attachments.every((a) => a.extracted))
  assert.equal(view.proposal.messages.length, 1)
  const proposalObj = view.proposal.messages[0]
  assert.match(proposalObj.area_id, /^\d+$/) // every id travels as text
  assert.match(proposalObj.template_id, /^\d+$/)
  assert.deepEqual(view.units, []) // the analyzer double does not number units
  assert.equal(view.job_id, String(jobId))
  assert.match(proposalObj.body, /texto de document/)
  assert.equal(view.job.status, 'done')

  // The sender edits the proposal (title, assignee Beto) and publishes it.
  const edited = { messages: [{ ...proposalObj, title: 'Guardar no responde', assignee_ids: [3], attachment_ids: [view.attachments[0].id] }] }
  const pubRes = await env.api('POST', `/inputs/${inputId}/publish`, env.c.ana, edited)
  assert.equal(pubRes.statusCode, 200, pubRes.body)
  const [messageIdValue] = pubRes.json().message_ids
  assert.equal(pubRes.json().messages[0].status, 'open')
  assert.equal((await env.api('GET', `/inputs/${inputId}`, env.c.ana)).json().status, 'published')
  assert.equal((await env.api('POST', `/inputs/${inputId}/publish`, env.c.ana, edited)).statusCode, 409) // it is not published twice

  // Beto sees it in «para mí»; Ed (not assigned) does not.
  const forBeto = (await env.api('GET', '/messages?for=me', env.c.beto)).json()
  assert.deepEqual(forBeto.items.map((m) => m.id), [messageIdValue])
  assert.equal(forBeto.items[0].author_id, '2') // Ana
  assert.deepEqual(forBeto.items[0].assignee_ids, ['3']) // Beto
  assert.equal(forBeto.total, 1)
  assert.equal(forBeto.items[0].attachments.length, 1)
  assert.equal((await env.api('GET', '/messages?for=me', env.c.ed)).json().items.length, 0)
  assert.equal((await env.api('GET', '/messages', env.c.ed)).json().items.length, 1) // everyone sees everything in Mensajes

  // Only a member other than the sender replies.
  const ownReply = await env.api('POST', `/messages/${messageIdValue}/replies`, env.c.ana, { body: 'yo mismo' })
  assert.equal(ownReply.statusCode, 403)
  assert.equal(ownReply.json().code, 'author_cannot_reply')
  const resp = await env.api('POST', `/messages/${messageIdValue}/replies`, env.c.beto, { body: 'ya lo reviso', kind: 'clarification' })
  assert.equal(resp.statusCode, 201)
  assert.equal(resp.json().status, 'answered')
  assert.equal(resp.json().replies.length, 1)
  assert.equal(resp.json().replies[0].kind, 'clarification')
  assert.equal(resp.json().reply_count, 1)
  assert.equal(resp.json().last_reply.author_id, '3')
  assert.equal((await env.api('POST', `/messages/${messageIdValue}/replies`, env.c.ed, { body: 'otra' })).json().replies.length, 2) // a thread

  // Anyone closes and reopens; a closed one receives no replies.
  const isClosed = await env.api('POST', `/messages/${messageIdValue}/close`, env.c.ed)
  assert.equal(isClosed.json().status, 'closed')
  assert.ok(isClosed.json().closed_at)
  assert.equal((await env.api('POST', `/messages/${messageIdValue}/close`, env.c.ed)).statusCode, 409)
  assert.equal((await env.api('POST', `/messages/${messageIdValue}/replies`, env.c.beto, { body: 'x' })).statusCode, 409)
  const reopened = await env.api('POST', `/messages/${messageIdValue}/reopen`, env.c.ana)
  assert.equal(reopened.json().status, 'answered') // it has replies
  assert.equal(reopened.json().closed_at, null)
  assert.equal((await env.api('POST', `/messages/${messageIdValue}/reopen`, env.c.ana)).statusCode, 409)
  await env.close()
})

test('reopening a message without replies returns it to open', async () => {
  const env = await team({ worker: true })
  const { input_id: id } = (await postInput(env, env.c.ana, { text: 'hola' })).json()
  const v = await waitForProposal(env, env.c.ana, id)
  const pubRes = await env.api('POST', `/inputs/${id}/publish`, env.c.ana, { messages: v.proposal.messages })
  const m = pubRes.json().message_ids[0]
  await env.api('POST', `/messages/${m}/close`, env.c.beto)
  assert.equal((await env.api('POST', `/messages/${m}/reopen`, env.c.beto)).json().status, 'open')
  await env.close()
})

// ---------------------------------------------------------------- idempotency
test('the same content from the same sender returns what already exists; another sender has their own input', async () => {
  const env = await team()
  const submit = (cookie) => postInput(env, cookie, { text: '  mismo texto  \r\n' }, [TEXT_FILE('a.txt', 'abc')])
  const a = await submit(env.c.ana)
  const b = await postInput(env, env.c.ana, { text: 'mismo texto' }, [TEXT_FILE('otro-nombre.txt', 'abc')]) // normalized text and same attachment by hash
  assert.equal(a.statusCode, 202)
  assert.equal(b.statusCode, 200)
  assert.equal(b.json().duplicate, true)
  assert.equal(b.json().input_id, a.json().input_id)
  assert.equal(b.json().job_id, a.json().job_id)
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM jobs').n, 1) // not even a second job
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM attachments').n, 1)
  const c = await submit(env.c.beto)
  assert.equal(c.statusCode, 202)
  assert.notEqual(c.json().input_id, a.json().input_id)
  // A different attachment is another input.
  assert.equal((await postInput(env, env.c.ana, { text: 'mismo texto' }, [TEXT_FILE('a.txt', 'abd')])).statusCode, 202)
  await env.close()
})

test('resubmitting a failed or cancelled input retries it on the same row', async () => {
  const env = await team()
  const a = (await postInput(env, env.c.ana, { text: 'x' })).json()
  const cancel = await env.api('POST', `/inputs/${a.input_id}/cancel`, env.c.ana)
  assert.equal(cancel.statusCode, 200)
  assert.deepEqual(cancel.json().cancelled_jobs, [a.job_id])
  assert.equal((await env.api('POST', `/inputs/${a.input_id}/cancel`, env.c.ana)).statusCode, 409)
  const other = await postInput(env, env.c.ana, { text: 'x' })
  assert.equal(other.statusCode, 202)
  assert.equal(other.json().restarted, true)
  assert.equal(other.json().input_id, a.input_id)
  assert.notEqual(other.json().job_id, a.job_id)
  assert.equal((await env.api('GET', `/inputs/${a.input_id}`, env.c.ana)).json().status, 'queued')
  await env.close()
})

// ---------------------------------------------------------------- upload validation
test('upload: empty submission, unsupported format, invalid link and non-multipart body', async () => {
  const env = await team()
  const emptyBody = await postInput(env, env.c.ana, { text: '   ' })
  assert.equal(emptyBody.statusCode, 400)
  assert.equal(emptyBody.json().code, 'input_empty')
  const svg = await postInput(env, env.c.ana, { text: 'x' }, [{ field: 'files', name: 'logo.svg', type: 'image/svg+xml', content: '<svg/>' }])
  assert.equal(svg.statusCode, 415)
  const exe = await postInput(env, env.c.ana, { text: 'x' }, [{ field: 'files', name: 'a.exe', type: 'application/octet-stream', content: 'MZ' }])
  assert.equal(exe.statusCode, 415)
  assert.equal((await postInput(env, env.c.ana, { text: 'x', links: 'no es una url' })).statusCode, 400)
  assert.equal((await postInput(env, env.c.ana, { text: 'x', links: 'ftp://host/archivo' })).statusCode, 400)
  const json = await env.app.inject({ method: 'POST', url: '/api/inputs', headers: { cookie: env.c.ana, 'x-team-request': 'panel', 'content-type': 'text/plain' }, payload: 'x' })
  assert.equal(json.statusCode, 415) // JSON is accepted since UD-072; any other body type is not
  const emptyFile = await postInput(env, env.c.ana, { text: 'x' }, [TEXT_FILE('v.txt', '')])
  assert.equal(emptyFile.statusCode, 400)
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM inputs').n, 0) // nothing was left half done
  await env.close()
})

test('upload: the octet-stream type is classified by extension', async () => {
  const env = await team()
  const r = await postInput(env, env.c.ana, { text: 'x' }, [{ field: 'files', name: 'informe.pdf', type: 'application/octet-stream', content: '%PDF-1.4' }])
  assert.equal(r.statusCode, 202)
  assert.equal(get(env.db, 'SELECT kind, mime FROM attachments').kind, 'document')
  await env.close()
})

test('upload: caps per type, number of files and of links, with the configuration limits', async () => {
  const env = await team({ config: { ...noIpLimit, uploads: { maxImageBytes: 10, maxFiles: 2, maxLinks: 1 } } })
  const bigBody = await postInput(env, env.c.ana, { text: 'x' }, [{ field: 'files', name: 'a.png', type: 'image/png', content: 'x'.repeat(11) }])
  assert.equal(bigBody.statusCode, 413)
  assert.match(bigBody.json().message, /supera el máximo/)
  const longDocument = await postInput(env, env.c.ana, { text: 'x' }, [TEXT_FILE('largo.txt', 'x'.repeat(11))]) // the document cap is a different one
  assert.equal(longDocument.statusCode, 202)
  const three = await postInput(env, env.c.ana, { text: 'otro' }, [TEXT_FILE('1.txt'), TEXT_FILE('2.txt'), TEXT_FILE('3.txt')])
  assert.equal(three.statusCode, 413)
  const linkItems = await postInput(env, env.c.ana, { text: 'otro2', links: ['https://a.example', 'https://b.example'] })
  assert.equal(linkItems.statusCode, 413)
  await env.close()
})

test('upload: a large file is written to disk and named by its hash', async () => {
  const env = await team()
  const contents = Buffer.alloc(3 * 1024 * 1024, 7)
  const r = await postInput(env, env.c.ana, { text: 'x' }, [{ field: 'files', name: 'grande.mp3', type: 'audio/mpeg', content: contents }])
  assert.equal(r.statusCode, 202)
  const dbRow = get(env.db, 'SELECT * FROM attachments')
  assert.equal(dbRow.size, contents.length)
  assert.equal(dbRow.kind, 'audio')
  const { createHash } = await import('node:crypto')
  assert.equal(dbRow.sha256, createHash('sha256').update(contents).digest('hex'))
  assert.equal(dbRow.path, dbRow.sha256)
  const { statSync, readdirSync } = await import('node:fs')
  assert.equal(statSync(path.join(env.config.attachmentsDir, dbRow.sha256)).size, contents.length)
  assert.deepEqual(readdirSync(env.config.tmpDir), []) // no temporary files
  await env.close()
})

// ---------------------------------------------------------------- publication
test('publishing validates the shape: area, template of that area, members, attachments and required fields', async () => {
  const env = await team({ worker: true })
  const { input_id: id } = (await postInput(env, env.c.ana, { text: 'algo' }, [TEXT_FILE('a.txt')])).json()
  const v = await waitForProposal(env, env.c.ana, id)
  const base = v.proposal.messages[0]
  const publishIt = (edits, cookie = env.c.ana) => env.api('POST', `/inputs/${id}/publish`, cookie, { messages: [{ ...base, ...edits }] })
  const areas = (await env.api('GET', '/areas', env.c.ana)).json()
  const error = areas.find((a) => a.title === 'Error')
  const idea = areas.find((a) => a.title === 'Idea')

  assert.equal((await publishIt({ area_id: 999 })).json().code, 'area_invalid')
  assert.equal((await publishIt({ template_id: 999 })).json().code, 'template_invalid')
  assert.equal((await publishIt({ area_id: idea.id, template_id: error.templates[0].id })).json().code, 'template_invalid') // template of another area
  assert.equal((await publishIt({ assignee_ids: [999] })).json().code, 'assignee_invalid')
  assert.equal((await publishIt({ attachment_ids: [999] })).json().code, 'attachment_invalid')
  assert.equal((await publishIt({ title: '   ' })).json().code, 'message_invalid')
  assert.equal((await publishIt({ body: '' })).json().code, 'message_invalid')
  const absent = await publishIt({ area_id: error.id, template_id: error.templates[0].id, fields: {} })
  assert.equal(absent.statusCode, 422)
  assert.equal(absent.json().code, 'fields_invalid')
  assert.match(absent.json().message, /steps/)
  const extra = await publishIt({ area_id: error.id, template_id: error.templates[0].id, fields: { steps: 'a', expected: 'b', actual: 'c', invented: 'd' } })
  assert.match(extra.json().message, /invented/)
  assert.equal((await env.api('POST', `/inputs/${id}/publish`, env.c.ana, { messages: [] })).statusCode, 400)
  assert.equal((await publishIt({}, env.c.beto)).statusCode, 404) // the input belongs to Ana
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM messages').n, 0) // no half-done attempt left rows behind

  // One message per area, each with its template; optional fields may be null.
  const two = await env.api('POST', `/inputs/${id}/publish`, env.c.ana, { messages: [
    { ...base, title: 'Falla', area_id: error.id, template_id: error.templates[0].id, fields: { steps: 'a', expected: 'b', actual: 'c', where: null } },
    { ...base, title: 'Idea', area_id: idea.id, template_id: idea.templates[0].id, fields: { idea: 'i', motivation: 'm' } }
  ] })
  assert.equal(two.statusCode, 200, two.body)
  assert.deepEqual(two.json().messages.map((m) => m.area_id), [String(error.id), String(idea.id)])
  assert.deepEqual(two.json().messages[0].fields, { steps: 'a', expected: 'b', actual: 'c' })
  await env.close()
})

test('GET /inputs/:id belongs to the sender: another member gets 404', async () => {
  const env = await team()
  const { input_id: id } = (await postInput(env, env.c.ana, { text: 'x' })).json()
  assert.equal((await env.api('GET', `/inputs/${id}`, env.c.beto)).statusCode, 404)
  assert.equal((await env.api('GET', `/inputs/${id}`, env.c.ed)).statusCode, 404)
  assert.equal((await env.api('POST', `/inputs/${id}/cancel`, env.c.beto)).statusCode, 404)
  await env.close()
})

// ---------------------------------------------------------------- messages: filters
async function withMessages (env) {
  const areas = (await env.api('GET', '/areas', env.c.ana)).json()
  const make = async (textValue, area, assigned, sender = env.c.ana) => {
    const fields = area.title === 'Idea' ? { idea: textValue, motivation: 'm' } : { question: textValue }
    const { input_id: id } = (await postInput(env, sender, { text: textValue })).json()
    const v = await waitForProposal(env, sender, id)
    const r = await env.api('POST', `/inputs/${id}/publish`, sender, { messages: [{ ...v.proposal.messages[0], title: textValue, body: `cuerpo ${textValue}`, area_id: area.id, template_id: area.templates[0].id, fields, assignee_ids: assigned }] })
    return r.json().message_ids[0]
  }
  const idea = areas.find((a) => a.title === 'Idea')
  const questionArea = areas.find((a) => a.title === 'Pregunta')
  return {
    idea, questionArea,
    m1: await make('alfa uno', idea, [3]),
    m2: await make('beta dos', questionArea, [3, 2]),
    m3: await make('gamma 100% tres', questionArea, [1], env.c.beto)
  }
}

test('messages: filters by assignee, area, status, search and replies, with pagination', async () => {
  const env = await team({ worker: true })
  const { idea, questionArea, m1, m2, m3 } = await withMessages(env)
  const ids = async (query, cookie = env.c.ana) => (await env.api('GET', `/messages${query}`, cookie)).json().items.map((m) => m.id)

  assert.deepEqual(await ids(''), [m3, m2, m1]) // newest first
  assert.deepEqual(await ids('?for=me', env.c.beto), [m2, m1])
  assert.deepEqual(await ids('?for=me', env.c.ana), [m2])
  assert.deepEqual(await ids('?for=1', env.c.beto), [m3]) // for X
  assert.deepEqual(await ids(`?area=${idea.id}`), [m1])
  assert.deepEqual(await ids(`?area=${questionArea.id}`), [m3, m2])
  assert.deepEqual(await ids('?q=beta'), [m2])
  assert.deepEqual(await ids('?q=100%25'), [m3]) // the % is searched literally, not as a wildcard
  assert.deepEqual(await ids('?q=%25'), [m3])
  assert.deepEqual(await ids('?status=open'), [m3, m2, m1])
  assert.deepEqual(await ids('?replies=1'), [])

  await env.api('POST', `/messages/${m1}/replies`, env.c.beto, { body: 'listo' })
  await env.api('POST', `/messages/${m3}/replies`, env.c.ana, { body: 'visto' })
  await env.api('POST', `/messages/${m2}/close`, env.c.ed)
  assert.deepEqual(await ids('?status=answered'), [m3, m1])
  assert.deepEqual(await ids('?status=closed'), [m2])
  assert.deepEqual(await ids('?replies=1'), [m3, m1]) // latest reply first
  assert.deepEqual(await ids('?replies=1&for=me', env.c.ana), [m3, m1]) // Ana is the sender of m1 and m2 and replied to m3
  assert.deepEqual(await ids('?replies=1&for=me', env.c.ed), [m3]) // Ed is the assignee of m3, which has replies
  const page1 = (await env.api('GET', '/messages?limit=2', env.c.ana)).json()
  assert.equal(page1.items.length, 2)
  assert.deepEqual({ page: page1.page, limit: page1.limit, total: page1.total }, { page: 1, limit: 2, total: 3 })
  const page2 = (await env.api('GET', '/messages?limit=2&page=2', env.c.ana)).json()
  assert.deepEqual(page2.items.map((m) => m.id), [m1])
  assert.equal(page2.page, 2)
  assert.equal((await env.api('GET', '/messages?limit=101', env.c.ana)).statusCode, 400) // cap of 100
  assert.equal((await env.api('GET', '/messages?page=0', env.c.ana)).statusCode, 400)
  assert.equal((await env.api('GET', '/messages?status=raro', env.c.ana)).statusCode, 400)
  assert.equal((await env.api('GET', '/messages?for=pepe', env.c.ana)).statusCode, 400)

  const areasAfter = (await env.api('GET', '/areas', env.c.ana)).json()
  assert.equal(areasAfter.find((a) => a.id === idea.id).open_count, 0)
  assert.equal(areasAfter.find((a) => a.id === questionArea.id).unresolved_count, 1) // m3 answered, m2 closed
  await env.close()
})

// ---------------------------------------------------------------- areas and templates
test('areas and templates: the editor manages them; the member only reads them without the body', async () => {
  const env = await team()
  const views = []
  env.domainEvents.on('template.saved', (t) => views.push(t.name))
  const listValue = (await env.api('GET', '/areas', env.c.ana)).json()
  assert.equal(listValue.length, 5)
  assert.ok(listValue.every((a) => a.templates.every((t) => t.body_markdown === undefined)))

  assert.equal((await env.api('POST', '/areas', env.c.ana, { title: 'Nueva', description: 'x' })).statusCode, 403)
  const createdTemplate = await env.api('POST', '/areas', env.c.ed, { title: 'Soporte', description: 'Pedidos de ayuda' })
  assert.equal(createdTemplate.statusCode, 201)
  assert.equal(createdTemplate.json().position, 6) // the seeded ones take 1 to 5
  assert.equal((await env.api('POST', '/areas', env.c.ed, { title: 'soporte', description: 'x' })).statusCode, 409) // unique title, case-insensitive
  const edited = await env.api('PATCH', `/areas/${createdTemplate.json().id}`, env.c.ed, { description: 'Pedidos de ayuda del equipo' })
  assert.equal(edited.json().description, 'Pedidos de ayuda del equipo')
  assert.equal((await env.api('PATCH', '/areas/999', env.c.ed, { title: 'x' })).statusCode, 404)
  assert.equal((await env.api('PATCH', `/areas/${createdTemplate.json().id}`, env.c.ed, {})).statusCode, 400)

  const md = '---\nname: Ayuda\ndescription: Pide ayuda para usar algo.\nfields:\n  - { name: tema, label: Tema, required: true }\n---\n## Método\nUna pregunta por mensaje.\n## Formato de salida\nUn mensaje.\n'
  const t = await env.api('POST', `/areas/${createdTemplate.json().id}/templates`, env.c.ed, { body_markdown: md })
  assert.equal(t.statusCode, 201)
  assert.equal(t.json().name, 'Ayuda')
  assert.deepEqual(views, ['Ayuda'])

  // name and description separately rewrite the header and remain a valid template.
  const renamed = await env.api('PATCH', `/areas/${createdTemplate.json().id}/templates/${t.json().id}`, env.c.ed, { name: 'Pedir ayuda', description: 'Nueva descripción' })
  assert.equal(renamed.statusCode, 200, renamed.body)
  assert.equal(renamed.json().name, 'Pedir ayuda')
  assert.match(renamed.json().body_markdown, /name: Pedir ayuda/)
  assert.match(renamed.json().body_markdown, /Una pregunta por mensaje/)
  const templateList = (await env.api('GET', `/areas/${createdTemplate.json().id}/templates`, env.c.ed)).json()
  assert.equal(templateList.length, 1)
  assert.ok(templateList[0].body_markdown)
  assert.equal((await env.api('GET', `/areas/${createdTemplate.json().id}/templates`, env.c.ana)).statusCode, 200) // reading is any person's (UD-287)

  // Invalid shapes: 422 with the reason, nothing saved.
  for (const [badCase, reasonText] of [
    ['sin encabezado', /empezar con un frontmatter/],
    ['---\nname: X\n---\ncuerpo', /description/],
    ['---\nname: X\ndescription: Y\nfields:\n  - { name: Mal Nombre, label: L, required: true }\n---\ncuerpo', /identificador/],
    ['---\nname: X\ndescription: Y\nraro: 1\n---\ncuerpo', /desconocidas/]
  ]) {
    const r = await env.api('POST', `/areas/${createdTemplate.json().id}/templates`, env.c.ed, { body_markdown: badCase })
    assert.equal(r.statusCode, 422, badCase)
    assert.equal(r.json().code, 'template_invalid')
    assert.match(r.json().message, reasonText)
  }
  assert.equal((await env.api('POST', `/areas/${createdTemplate.json().id}/templates`, env.c.ed, { body_markdown: `---\nname: ${'n'.repeat(65)}\ndescription: Y\n---\ncuerpo` })).statusCode, 422) // 64 characters, per Agent Skills
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM templates WHERE area_id = ?', createdTemplate.json().id).n, 1)

  // Deleting is soft and requires confirmation; it can be restored.
  const templateUrl = `/areas/${createdTemplate.json().id}/templates/${t.json().id}`
  const unconfirmed = await env.api('DELETE', templateUrl, env.c.ed)
  assert.equal(unconfirmed.statusCode, 400)
  assert.equal(unconfirmed.json().code, 'confirm_required')
  assert.equal((await env.api('GET', `/areas/${createdTemplate.json().id}/templates`, env.c.ed)).json().length, 1) // it was not deleted
  assert.equal((await env.api('DELETE', `${templateUrl}?confirm=true`, env.c.ed)).statusCode, 204)
  assert.equal((await env.api('DELETE', `${templateUrl}?confirm=true`, env.c.ed)).statusCode, 404)
  assert.equal((await env.api('GET', `/areas/${createdTemplate.json().id}/templates`, env.c.ed)).json().length, 0)
  assert.equal((await env.api('GET', `/areas/${createdTemplate.json().id}/templates?include_deleted=true`, env.c.ed)).json().length, 1)
  assert.equal((await env.api('POST', `/templates/${t.json().id}/restore`, env.c.ana)).statusCode, 403)
  const restored = await env.api('POST', `/templates/${t.json().id}/restore`, env.c.ed)
  assert.equal(restored.statusCode, 200)
  assert.equal(restored.json().deleted_at, null)
  assert.equal((await env.api('POST', `/templates/${t.json().id}/restore`, env.c.ed)).statusCode, 409) // it was not deleted
  // A template's name is unique within the area (409), not across areas.
  assert.equal((await env.api('POST', `/areas/${createdTemplate.json().id}/templates`, env.c.ed, { body_markdown: md.replace('name: Ayuda', 'name: pedir AYUDA') })).statusCode, 409)
  const otherArea = await env.api('POST', '/areas', env.c.ed, { title: 'Otra', description: 'x' })
  assert.equal((await env.api('POST', `/areas/${otherArea.json().id}/templates`, env.c.ed, { body_markdown: md })).statusCode, 201)

  // A soft-deleted area disappears from the list and is restored without losing anything.
  const areaUrl = `/areas/${createdTemplate.json().id}`
  assert.equal((await env.api('DELETE', areaUrl, env.c.ed)).statusCode, 400)
  assert.equal((await env.api('DELETE', `${areaUrl}?confirm=true`, env.c.ed)).statusCode, 204)
  assert.ok(!(await env.api('GET', '/areas', env.c.ana)).json().some((a) => a.id === createdTemplate.json().id))
  assert.equal((await env.api('GET', '/areas?include_deleted=true', env.c.ana)).statusCode, 200) // any person of the team (UD-287)
  assert.ok((await env.api('GET', '/areas?include_deleted=true', env.c.ed)).json().some((a) => a.id === createdTemplate.json().id))
  // Its title is free while it is deleted, and restoring clashes if someone took it.
  assert.equal((await env.api('POST', '/areas', env.c.ed, { title: 'Soporte', description: 'nueva' })).statusCode, 201)
  assert.equal((await env.api('POST', `${areaUrl}/restore`, env.c.ed)).statusCode, 409)
  await env.close()
})

// ---------------------------------------------------------------- members
test('members: creation by the editor, unique email, and one editor always remains', async () => {
  const env = await team()
  const fresh = await env.api('POST', '/members', env.c.ed, { email: 'Carla@x.org', name: 'Carla', profile: 'Hago la interfaz.', password: 'una clave larga de prueba 2' })
  assert.equal(fresh.statusCode, 201)
  assert.equal(fresh.json().role, 'member')
  assert.equal((await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'carla@x.org', password: 'una clave larga de prueba 2' } })).statusCode, 200)
  assert.equal((await env.api('POST', '/members', env.c.ed, { email: 'carla@x.org', name: 'Otra' })).statusCode, 409)
  assert.equal((await env.api('POST', '/members', env.c.ed, { email: 'sin-arroba', name: 'X' })).statusCode, 400)
  assert.equal((await env.api('POST', '/members', env.c.ed, { email: 'd@x.org', name: 'D', password: 'corta' })).statusCode, 400)
  assert.equal((await env.api('POST', '/members', env.c.ana, { email: 'e@x.org', name: 'E', profile: 'perfil' })).statusCode, 403) // the profile is a configured text (UD-287)
  assert.equal(get(env.db, "SELECT COUNT(*) AS n FROM members WHERE email = 'd@x.org'").n, 0)
  // The editor edits others; the last editor cannot stop being one.
  // UD-288 (amends UD-023): the Editor writes the profile of another person; a member who is not an Editor does not.
  assert.equal((await env.api('PATCH', '/members/3', env.c.ana, { profile: 'No debería.' })).statusCode, 403)
  const otherProfile = await env.api('PATCH', '/members/2', env.c.ed, { profile: 'Hago la API.' })
  assert.equal(otherProfile.statusCode, 200)
  assert.equal(otherProfile.json().profile, 'Hago la API.')
  assert.equal(get(env.db, 'SELECT profile FROM members WHERE id = 2').profile, 'Hago la API.')
  assert.notEqual(get(env.db, 'SELECT profile FROM members WHERE id = 3').profile, 'No debería.')
  // UD-281: the editor does edit the profile of an agent, with audit; a member who is not an editor does not.
  const agentCreated = await env.api('POST', '/members', env.c.ed, { email: 'agente-perfil@x.org', name: 'Agente', kind: 'agent' })
  assert.equal(agentCreated.statusCode, 201)
  const agentId = agentCreated.json().id
  assert.equal((await env.api('PATCH', `/members/${agentId}`, env.c.ana, { profile: 'No debería.' })).statusCode, 403)
  const agentProfile = await env.api('PATCH', `/members/${agentId}`, env.c.ed, { profile: 'Reviso la API.\n\nNo toco la interfaz.' })
  assert.equal(agentProfile.statusCode, 200)
  assert.equal(agentProfile.json().profile, 'Reviso la API.\n\nNo toco la interfaz.')
  const audited = get(env.db, "SELECT member_id, detail_json FROM audit_log WHERE action = 'member.update' AND entity_id = ? ORDER BY id DESC LIMIT 1", String(agentId))
  assert.match(audited.detail_json, /profile/)
  assert.equal((await env.api('DELETE', `/members/${agentId}?confirm=true&purge=true`, env.c.ed)).statusCode, 200) // leaves the team as it was
  const ownProfile = await env.api('PATCH', '/members/me', env.c.ed, { profile: 'Reviso todo.\n\nNo toco la interfaz.' })
  assert.equal(ownProfile.json().profile, 'Reviso todo.\n\nNo toco la interfaz.') // free text, paragraphs included
  assert.equal((await env.api('PATCH', '/members/2', env.c.ed, { responsibilities: 'API' })).statusCode, 400) // UD-023: the old field no longer exists
  const lastSeqValue = await env.api('PATCH', '/members/1', env.c.ed, { role: 'member' })
  assert.equal(lastSeqValue.statusCode, 409)
  assert.equal(lastSeqValue.json().code, 'last_editor')
  assert.equal((await env.api('PATCH', '/members/1', env.c.ed, { email: 'ana@x.org' })).statusCode, 409)
  assert.equal((await env.api('PATCH', '/members/999', env.c.ed, { name: 'x' })).statusCode, 404)
  const pageBody = (await env.api('GET', '/members', env.c.ana)).json()
  const listValue = pageBody.items
  assert.equal(pageBody.total, 4)
  assert.equal(listValue.length, 4)
  assert.ok(listValue.every((m) => m.password === undefined && m.password_hash === undefined))
  // The editor resets another person's password and closes their sessions.
  const resetRes = await env.api('PATCH', '/members/3', env.c.ed, { password: 'clave reiniciada por editor' })
  assert.equal(resetRes.statusCode, 200)
  assert.equal((await env.api('GET', '/me', env.c.beto)).statusCode, 401)
  await env.close()
})

// ---------------------------------------------------------------- attachments
test('attachments: the sender sees them before publishing, the team afterwards, with Range and safe headers', async () => {
  const env = await team({ worker: true })
  const contents = '0123456789abcdefghij'
  const { input_id: id } = (await postInput(env, env.c.ana, { text: 'x', links: 'https://example.org' }, [{ field: 'files', name: 'dato.txt', type: 'text/plain', content: contents }, { field: 'files', name: 'foto.png', type: 'image/png', content: 'PNG!' }])).json()
  const v = await waitForProposal(env, env.c.ana, id)
  const [textFile, png, linkItem] = v.attachments
  assert.equal(linkItem.kind, 'link')
  const ask = (cookie, att, headers = {}) => env.app.inject({ url: `/api/attachments/${att.id}`, headers: { cookie, ...headers } })

  assert.equal((await ask(env.c.ana, textFile)).statusCode, 200)
  assert.equal((await ask(env.c.beto, textFile)).statusCode, 404) // unpublished, only the sender
  assert.equal((await ask(env.c.ana, linkItem)).statusCode, 404) // a link is not a file
  assert.equal((await env.app.inject({ url: `/api/attachments/${textFile.id}` })).statusCode, 401)

  await env.api('POST', `/inputs/${id}/publish`, env.c.ana, { messages: [{ ...v.proposal.messages[0], attachment_ids: [png.id] }] })
  assert.equal((await ask(env.c.beto, png)).statusCode, 200) // published in a message: the team sees it
  assert.equal((await ask(env.c.beto, textFile)).statusCode, 404) // the one not attached to any message still belongs to the sender

  const fullBody = await ask(env.c.ana, textFile)
  assert.equal(fullBody.body, contents)
  assert.equal(fullBody.headers['content-disposition'], "attachment; filename*=UTF-8''dato.txt") // text: it is downloaded
  assert.equal(fullBody.headers['x-content-type-options'], 'nosniff')
  assert.match(fullBody.headers['content-security-policy'], /sandbox/)
  const imageResp = await ask(env.c.ana, png)
  assert.match(imageResp.headers['content-disposition'], /^inline/)
  assert.equal(imageResp.headers['content-type'], 'image/png')
  const partial = await ask(env.c.ana, textFile, { range: 'bytes=5-9' })
  assert.equal(partial.statusCode, 206)
  assert.equal(partial.body, '56789')
  assert.equal(partial.headers['content-range'], 'bytes 5-9/20')
  assert.equal((await ask(env.c.ana, textFile, { range: 'bytes=-4' })).body, 'ghij')
  assert.equal((await ask(env.c.ana, textFile, { range: 'bytes=15-' })).body, 'fghij')
  const outside = await ask(env.c.ana, textFile, { range: 'bytes=99-120' })
  assert.equal(outside.statusCode, 416)
  assert.equal(outside.headers['content-range'], 'bytes */20')
  await env.close()
})

// ---------------------------------------------------------------- static panel and edges
test('static panel: assets with immutable cache, index.html without cache, JSON 404 under /api, SPA for the rest', async () => {
  const dir = (await import('../testing/helpers.js')).tempDir()
  mkdirSync(path.join(dir, 'assets'), { recursive: true })
  writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Panel</title>')
  writeFileSync(path.join(dir, 'assets', 'app-abc123.js'), 'console.log(1)')
  writeFileSync(path.join(dir, 'favicon.svg'), '<svg/>')
  const env = await makeEnv({ config: { panelDist: dir } })

  const runningEntry = await env.app.inject({ url: '/assets/app-abc123.js' })
  assert.equal(runningEntry.statusCode, 200)
  assert.match(runningEntry.headers['cache-control'], /max-age=31536000/)
  assert.match(runningEntry.headers['cache-control'], /immutable/)
  const rootDir = await env.app.inject({ url: '/' })
  assert.equal(rootDir.statusCode, 200)
  assert.match(rootDir.body, /<title>Panel/)
  assert.equal(rootDir.headers['cache-control'], 'no-cache')
  const index = await env.app.inject({ url: '/index.html' })
  assert.equal(index.headers['cache-control'], 'no-cache')
  const routePath = await env.app.inject({ url: '/mensajes/12' })
  assert.equal(routePath.statusCode, 200)
  assert.match(routePath.body, /<title>Panel/) // SPA route
  assert.equal(routePath.headers['cache-control'], 'no-cache')
  const absentAsset = await env.app.inject({ url: '/assets/otro-compilado.js' })
  assert.equal(absentAsset.statusCode, 404)
  assert.equal(absentAsset.json().code, 'not_found') // an asset hash from another build is not mistaken for a page
  const api404 = await env.app.inject({ url: '/api/no-existe' })
  assert.equal(api404.statusCode, 404)
  assert.equal(api404.headers['content-type'], 'application/json; charset=utf-8')
  assert.equal(api404.json().code, 'not_found')
  assert.equal((await env.app.inject({ method: 'POST', url: '/api/no-existe' })).statusCode, 404)
  assert.equal((await env.app.inject({ method: 'POST', url: '/cualquier-cosa' })).statusCode, 404) // only GET falls to the SPA
  // The panel's CSP: same origin only.
  assert.match(rootDir.headers['content-security-policy'], /connect-src 'self'/)
  assert.match(rootDir.headers['content-security-policy'], /img-src 'self' blob: data:/)
  assert.match(rootDir.headers['content-security-policy'], /frame-ancestors 'none'/)
  await env.close()
})

test('without a compiled panel the API starts anyway and the root answers a JSON 404', async () => {
  const env = await makeEnv({ config: { panelDist: '/ruta/que/no/existe/panel' } })
  const r = await env.app.inject({ url: '/' })
  assert.equal(r.statusCode, 404)
  assert.equal(r.json().code, 'not_found')
  await env.close()
})

test('HP-015: a member reads the areas without the template bodies and gets 403 on writing them (configured texts, UD-287) and reads the full templates and the providers', async () => {
  const env = await team()
  const ana = env.c.ana
  const areas = (await env.api('GET', '/areas', ana)).json()
  assert.equal(areas.length, 5)
  assert.ok(areas.every((a) => a.templates.length > 0 && a.templates.every((t) => t.body_markdown === undefined)))
  const area = areas[0]
  const template = area.templates[0]
  const forbidden = [
    ['POST', '/areas', { title: 'Nueva', description: 'x' }],
    ['PATCH', `/areas/${area.id}`, { description: 'x' }],
    ['DELETE', `/areas/${area.id}`],
    ['POST', `/areas/${area.id}/restore`],
    ['POST', `/areas/${area.id}/templates`, { body_markdown: '---\nname: X\ndescription: Y\n---\ncuerpo' }],
    ['PATCH', `/areas/${area.id}/templates/${template.id}`, { name: 'x' }],
    ['DELETE', `/areas/${area.id}/templates/${template.id}`],
    ['POST', `/templates/${template.id}/restore`]
  ]
  for (const [method, url, payload] of forbidden) {
    const r = await env.api(method, url, ana, payload)
    assert.equal(r.statusCode, 403, `${method} ${url}: ${r.body}`)
  }
  // The editor does the same things, so the 403 comes from the role and not from a malformed request.
  assert.equal((await env.api('GET', `/areas/${area.id}/templates`, env.c.ed)).statusCode, 200)
  assert.equal((await env.api('GET', '/settings/providers', env.c.ed)).statusCode, 200)
  // Nothing changed.
  assert.equal((await env.api('GET', '/areas', ana)).json().length, 5)
  await env.close()
})

test('/health answers at the root and under /api, without a session', async () => {
  const env = await makeEnv()
  for (const url of ['/health', '/api/health']) {
    const r = await env.app.inject({ url })
    assert.equal(r.statusCode, 200)
    assert.equal(r.json().status, 'ok')
  }
  await env.close()
})

test('/health reports the text fallback provider to the editor and keeps it from anonymous probes (DT-003)', async () => {
  const providers = createProviders({ ANTHROPIC_API_KEY: 'k', TEXT_FALLBACK_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'd' })
  const env = await team({ modules: { getProviders: () => providers } })
  const slots = (await env.app.inject({ url: '/health', headers: { cookie: env.c.ed } })).json().providers
  assert.deepEqual(slots.filter((p) => p.slot.startsWith('text')).map((p) => [p.slot, p.provider, p.available]), [['text', 'anthropic', true], ['text_fallback', 'deepseek', true]])
  assert.ok(!JSON.stringify(slots).includes('"k"') && !JSON.stringify(slots).includes('"d"'), 'no key travels')
  assert.equal((await env.app.inject({ url: '/health' })).json().providers, undefined)
  await env.close()
})

test('validation errors arrive in Spanish with the { code, message } shape', async () => {
  const env = await team()
  const r = await env.api('POST', '/messages/1/replies', env.c.ana, {})
  assert.equal(r.statusCode, 400)
  assert.deepEqual(r.json(), { code: 'validation', message: 'Falta el campo «body».' })
  const r2 = await env.api('GET', '/messages/abc', env.c.ana)
  assert.equal(r2.statusCode, 400)
  assert.equal(r2.json().code, 'validation')
  const r3 = await env.api('PATCH', '/members/me', env.c.ana, { nameValue: 'x' })
  assert.match(r3.json().message, /no existe/)
  assert.equal((await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: '{roto', headers: { 'content-type': 'application/json' } })).json().code, 'bad_request')
  await env.close()
})

test('the panel receives no internal columns: the password hash and the token never leave', async () => {
  const env = await team()
  const bodies = [
    (await env.api('GET', '/me', env.c.ana)).body,
    (await env.api('GET', '/members', env.c.ana)).body,
    (await env.api('GET', '/areas', env.c.ana)).body
  ].join('')
  assert.ok(!/argon2|password_hash|token/.test(bodies))
  await env.close()
})

// ---------------------------------------------------------------- provider settings
test('provider settings: the editor reads and changes them; an invalid provider is rejected when configured', async () => {
  const attemptsList = []
  const env = await team({ modules: {
    getProviders: () => ({ describe: () => [{ slot: 'text', provider: 'anthropic', model: 'claude-haiku-5-5', available: false, reason: 'Falta ANTHROPIC_API_KEY' }] }),
    buildProviders: (o) => { attemptsList.push(o); if (o.text?.provider === 'inexistente') throw new Error('Unknown text provider «inexistente» in TEXT_PROVIDER'); return {} }
  } })
  assert.equal((await env.api('GET', '/settings/providers', env.c.ana)).statusCode, 200) // any person of the team (UD-287)
  const initialVersion = (await env.api('GET', '/settings/providers', env.c.ed)).json()
  assert.equal(initialVersion.analyzer, 'api')
  assert.deepEqual(initialVersion.items.map((i) => i.slot), ['text', 'vision', 'speech'])
  assert.equal(initialVersion.items[0].provider, 'anthropic')
  assert.equal(initialVersion.items[0].available, false)
  assert.equal(initialVersion.items[0].reason, 'Falta ANTHROPIC_API_KEY')
  assert.ok(!JSON.stringify(initialVersion).includes('API_KEY=')) // never a key

  const badCase = await env.api('PATCH', '/settings/providers', env.c.ed, { slot: 'text', provider: 'inexistente', model: 'x' })
  assert.equal(badCase.statusCode, 422)
  assert.equal(badCase.json().code, 'provider_invalid')
  assert.equal((await env.api('GET', '/settings/providers', env.c.ed)).json().items[0].provider, 'anthropic') // it was not saved

  const ok = await env.api('PATCH', '/settings/providers', env.c.ed, { slot: 'text', provider: 'deepseek', model: 'deepseek-flash' })
  assert.equal(ok.statusCode, 200)
  assert.deepEqual(attemptsList.at(-1).text, { provider: 'deepseek', model: 'deepseek-flash' })
  const change = await env.api('PATCH', '/settings/providers', env.c.ed, { analyzer: 'harness' })
  assert.equal(change.json().analyzer, 'harness')
  assert.equal((await env.api('PATCH', '/settings/providers', env.c.ed, { slot: 'text', api_key: 'x' })).statusCode, 400) // the key is not accepted
  assert.equal((await env.api('PATCH', '/settings/providers', env.c.ed, { slot: 'otra', provider: 'x' })).statusCode, 400)
  assert.equal((await env.api('PATCH', '/settings/providers', env.c.ed, { analyzer: 'otro' })).statusCode, 400)
  await env.close()
})

test('loadModules builds the providers with the stored settings over the environment', async () => {
  const env = await team()
  const { loadModules } = await import('../domain/modules.js')
  const { setProviderOverrides } = await import('../domain/settings.js')
  const moduleSet = await loadModules(env.config, { db: env.db, env: { TEXT_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-prueba', TEXT_MODEL: 'claude-haiku-5-5' } })
  assert.equal(moduleSet.getProviders().text.name, 'anthropic')
  assert.equal(moduleSet.getAnalyzer(), 'api')
  setProviderOverrides(env.db, { analyzer: 'harness', text: { provider: 'deepseek', model: 'deepseek-flash' } })
  // Without a DeepSeek key the provider is left «unavailable» and says so, without throwing.
  const fresh = moduleSet.getProviders()
  assert.equal(fresh.text.unavailable, 'Falta DEEPSEEK_API_KEY')
  assert.equal(moduleSet.getAnalyzer(), 'harness')
  assert.throws(() => moduleSet.buildProviders({ text: { provider: 'inexistente' } }), /Unknown text provider/)
  await env.close()
})

// ---------------------------------------------------------------- summary of what affects a member (UD-028)
test('UD-028 · GET /messages/summary: each message falls into a single state (open or answered), a closed one does not count and open ones are counted per area', async () => {
  const env = await team({ worker: true })
  const { idea, questionArea, m2 } = await withMessages(env) // Ana (2) issued m1 and m2; Beto (3) issued m3. m1 → Beto; m2 → Beto and Ana; m3 → Ed (1)
  const summary = async (cookie) => (await env.api('GET', '/messages/summary', cookie)).json()
  const areaRow = (s, area) => s.areas.find((a) => a.area_id === String(area.id))

  // Everything open: what is assigned is open; issuing without replies does not count.
  assert.deepEqual((await summary(env.c.beto)).mine, { open: 2, answered: 0, total: 2 })
  assert.deepEqual((await summary(env.c.ana)).mine, { open: 1, answered: 0, total: 1 })
  assert.deepEqual((await summary(env.c.ed)).mine, { open: 1, answered: 0, total: 1 })
  assert.deepEqual(areaRow(await summary(env.c.ana), questionArea), { area_id: String(questionArea.id), open: 2, answered: 0, closed: 0, mine_open: 1 })
  assert.deepEqual(areaRow(await summary(env.c.ed), idea), { area_id: String(idea.id), open: 1, answered: 0, closed: 0, mine_open: 0 })

  // Replies: what is assigned and answered is answered; what I issued and was answered is answered too.
  const m1 = (await env.api('GET', `/messages?area=${idea.id}`, env.c.ana)).json().items[0].id
  const m3 = (await env.api('GET', `/messages?for=1`, env.c.ana)).json().items[0].id
  await env.api('POST', `/messages/${m1}/replies`, env.c.beto, { body: 'listo' })
  await env.api('POST', `/messages/${m3}/replies`, env.c.ana, { body: 'visto' })
  assert.deepEqual((await summary(env.c.beto)).mine, { open: 1, answered: 2, total: 3 })
  assert.deepEqual((await summary(env.c.ana)).mine, { open: 1, answered: 1, total: 2 })
  assert.deepEqual((await summary(env.c.ed)).mine, { open: 0, answered: 1, total: 1 })
  assert.equal(areaRow(await summary(env.c.ana), idea).open, 0) // an answered message is no longer «open»
  assert.equal(areaRow(await summary(env.c.ana), questionArea).open, 1)

  // The bell lists what the count counts, message by message (J2-A-43): same states, same total.
  for (const cookie of [env.c.beto, env.c.ana, env.c.ed]) {
    const s = await summary(cookie)
    assert.equal(s.items.length, s.mine.total)
    for (const tone of ['open', 'answered']) assert.equal(s.items.filter((i) => i.status === tone).length, s.mine[tone])
    assert.ok(s.items.every((i) => i.title && i.message_id))
  }

  // Closing removes the message from everyone's count.
  await env.api('POST', `/messages/${m2}/close`, env.c.ed)
  assert.deepEqual((await summary(env.c.beto)).mine, { open: 0, answered: 2, total: 2 })
  assert.equal((await summary(env.c.beto)).items.some((i) => i.message_id === String(m2)), false, 'a closed message is not in the list')
  assert.equal(areaRow(await summary(env.c.beto), questionArea).open, 0)
  assert.equal((await env.app.inject({ method: 'GET', url: '/api/messages/summary' })).statusCode, 401) // requires a session
  await env.close()
})

// ---------------------------------------------------------------- H-2000: the list behind each number of the bar
test('H-2000 · GET /messages?involved=me lists exactly what GET /messages/summary counts, per state', async () => {
  const env = await team({ worker: true })
  const { idea, m2 } = await withMessages(env) // Ana (2) issued m1 and m2; Beto (3) issued m3. m1 → Beto; m2 → Beto and Ana; m3 → Ed (1)
  const ids = async (cookie, query) => (await env.api('GET', `/messages?${query}`, cookie)).json().items.map((m) => m.id).sort()
  const summaryIds = async (cookie, status) => (await env.api('GET', '/messages/summary', cookie)).json().items.filter((i) => i.status === status).map((i) => i.message_id).sort()
  const m1 = (await env.api('GET', `/messages?area=${idea.id}`, env.c.ana)).json().items[0].id
  const m3 = (await env.api('GET', '/messages?for=1', env.c.ana)).json().items[0].id
  await env.api('POST', `/messages/${m1}/replies`, env.c.beto, { body: 'listo' }) // Ana issued m1: answered for her
  await env.api('POST', `/messages/${m3}/replies`, env.c.ana, { body: 'visto' }) // Beto issued m3: answered for him

  // Ana: m2 open (assigned); m1 answered (issued, with replies); the open ones she issued and did not get assigned are not hers.
  assert.deepEqual(await ids(env.c.ana, 'involved=me&status=open'), await summaryIds(env.c.ana, 'open'))
  assert.deepEqual(await ids(env.c.ana, 'involved=me&status=answered'), await summaryIds(env.c.ana, 'answered'))
  assert.ok((await summaryIds(env.c.ana, 'answered')).includes(String(m1)))
  assert.equal((await env.api('GET', '/messages?for=me&status=answered', env.c.ana)).json().total, 0) // `for` knows only the assigned ones: the 4-against-5 gap of H-2000
  for (const cookie of [env.c.beto, env.c.ed]) {
    for (const status of ['open', 'answered']) assert.deepEqual(await ids(cookie, `involved=me&status=${status}`), await summaryIds(cookie, status))
  }

  // Closed: assigned or issued, as the bar counts them.
  await env.api('POST', `/messages/${m2}/close`, env.c.ed)
  assert.deepEqual(await ids(env.c.ana, 'involved=me&status=closed'), [String(m2)])
  assert.deepEqual(await ids(env.c.ed, 'involved=me&status=closed'), [])
  assert.equal((await env.api('GET', '/messages?involved=otro', env.c.ana)).statusCode, 400)
  assert.equal((await env.app.inject({ method: 'GET', url: '/api/messages?involved=me' })).statusCode, 401)
  await env.close()
})
