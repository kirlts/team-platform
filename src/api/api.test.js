import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { all, get } from '../db/index.js'
import { addMember, fakeExtract, login, makeEnv, multipart, postInput, until } from '../testing/helpers.js'

const noIpLimit = { identity: { login: { ipMax: 1000 } } }
const TEXT_FILE = (nameValue, contents = 'contenido de prueba') => ({ field: 'files', name: nameValue, type: 'text/plain', content: contents })

/** Equipo de prueba: un editor y dos miembros con sesión iniciada. */
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
    if (v.status === 'failed') throw new Error(`el input falló: ${v.error}`)
    return v.status === 'proposed' ? v : null
  })
}

// ---------------------------------------------------------------- flujo completo
test('flujo completo: enviar, analizar, editar, publicar, responder, cerrar y reabrir', async () => {
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
  assert.match(proposalObj.area_id, /^\d+$/) // todo id viaja como texto
  assert.match(proposalObj.template_id, /^\d+$/)
  assert.deepEqual(view.units, []) // el doble del analizador no numera unidades
  assert.equal(view.job_id, String(jobId))
  assert.match(proposalObj.body, /texto de document/)
  assert.equal(view.job.status, 'done')

  // El emisor edita la propuesta (título, destinatario Beto) y la publica.
  const edited = { messages: [{ ...proposalObj, title: 'Guardar no responde', assignee_ids: [3], attachment_ids: [view.attachments[0].id] }] }
  const pubRes = await env.api('POST', `/inputs/${inputId}/publish`, env.c.ana, edited)
  assert.equal(pubRes.statusCode, 200, pubRes.body)
  const [messageIdValue] = pubRes.json().message_ids
  assert.equal(pubRes.json().messages[0].status, 'open')
  assert.equal((await env.api('GET', `/inputs/${inputId}`, env.c.ana)).json().status, 'published')
  assert.equal((await env.api('POST', `/inputs/${inputId}/publish`, env.c.ana, edited)).statusCode, 409) // no se publica dos veces

  // Beto lo ve en «para mí»; Ed (no asignado) no.
  const forBeto = (await env.api('GET', '/messages?for=me', env.c.beto)).json()
  assert.deepEqual(forBeto.items.map((m) => m.id), [messageIdValue])
  assert.equal(forBeto.items[0].author_id, '2') // Ana
  assert.deepEqual(forBeto.items[0].assignee_ids, ['3']) // Beto
  assert.equal(forBeto.total, 1)
  assert.equal(forBeto.items[0].attachments.length, 1)
  assert.equal((await env.api('GET', '/messages?for=me', env.c.ed)).json().items.length, 0)
  assert.equal((await env.api('GET', '/messages', env.c.ed)).json().items.length, 1) // todos ven todos en Mensajes

  // Sólo un miembro distinto del emisor responde.
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
  assert.equal((await env.api('POST', `/messages/${messageIdValue}/replies`, env.c.ed, { body: 'otra' })).json().replies.length, 2) // un hilo

  // Cualquiera cierra y reabre; un cerrado no recibe respuestas.
  const isClosed = await env.api('POST', `/messages/${messageIdValue}/close`, env.c.ed)
  assert.equal(isClosed.json().status, 'closed')
  assert.ok(isClosed.json().closed_at)
  assert.equal((await env.api('POST', `/messages/${messageIdValue}/close`, env.c.ed)).statusCode, 409)
  assert.equal((await env.api('POST', `/messages/${messageIdValue}/replies`, env.c.beto, { body: 'x' })).statusCode, 409)
  const reopened = await env.api('POST', `/messages/${messageIdValue}/reopen`, env.c.ana)
  assert.equal(reopened.json().status, 'answered') // tiene respuestas
  assert.equal(reopened.json().closed_at, null)
  assert.equal((await env.api('POST', `/messages/${messageIdValue}/reopen`, env.c.ana)).statusCode, 409)
  await env.close()
})

test('reabrir un mensaje sin respuestas lo devuelve a abierto', async () => {
  const env = await team({ worker: true })
  const { input_id: id } = (await postInput(env, env.c.ana, { text: 'hola' })).json()
  const v = await waitForProposal(env, env.c.ana, id)
  const pubRes = await env.api('POST', `/inputs/${id}/publish`, env.c.ana, { messages: v.proposal.messages })
  const m = pubRes.json().message_ids[0]
  await env.api('POST', `/messages/${m}/close`, env.c.beto)
  assert.equal((await env.api('POST', `/messages/${m}/reopen`, env.c.beto)).json().status, 'open')
  await env.close()
})

// ---------------------------------------------------------------- idempotencia
test('el mismo contenido del mismo emisor devuelve lo que ya hay; otro emisor tiene su propio input', async () => {
  const env = await team()
  const submit = (cookie) => postInput(env, cookie, { text: '  mismo texto  \r\n' }, [TEXT_FILE('a.txt', 'abc')])
  const a = await submit(env.c.ana)
  const b = await postInput(env, env.c.ana, { text: 'mismo texto' }, [TEXT_FILE('otro-nombre.txt', 'abc')]) // texto normalizado y mismo adjunto por hash
  assert.equal(a.statusCode, 202)
  assert.equal(b.statusCode, 200)
  assert.equal(b.json().duplicate, true)
  assert.equal(b.json().input_id, a.json().input_id)
  assert.equal(b.json().job_id, a.json().job_id)
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM jobs').n, 1) // ni un segundo trabajo
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM attachments').n, 1)
  const c = await submit(env.c.beto)
  assert.equal(c.statusCode, 202)
  assert.notEqual(c.json().input_id, a.json().input_id)
  // Un adjunto distinto es otro input.
  assert.equal((await postInput(env, env.c.ana, { text: 'mismo texto' }, [TEXT_FILE('a.txt', 'abd')])).statusCode, 202)
  await env.close()
})

test('reenviar un input fallido o cancelado lo reintenta sobre la misma fila', async () => {
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

// ---------------------------------------------------------------- validación de la subida
test('subida: envío vacío, formato no admitido, enlace inválido y cuerpo no multipart', async () => {
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
  const json = await env.app.inject({ method: 'POST', url: '/api/inputs', headers: { cookie: env.c.ana, 'x-team-request': 'panel' }, payload: { text: 'x' } })
  assert.equal(json.statusCode, 415)
  const emptyFile = await postInput(env, env.c.ana, { text: 'x' }, [TEXT_FILE('v.txt', '')])
  assert.equal(emptyFile.statusCode, 400)
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM inputs').n, 0) // nada quedó a medias
  await env.close()
})

test('subida: el tipo octet-stream se clasifica por extensión', async () => {
  const env = await team()
  const r = await postInput(env, env.c.ana, { text: 'x' }, [{ field: 'files', name: 'informe.pdf', type: 'application/octet-stream', content: '%PDF-1.4' }])
  assert.equal(r.statusCode, 202)
  assert.equal(get(env.db, 'SELECT kind, mime FROM attachments').kind, 'document')
  await env.close()
})

test('subida: topes por tipo, cantidad de archivos y de enlaces, con los límites de la configuración', async () => {
  const env = await team({ config: { ...noIpLimit, uploads: { maxImageBytes: 10, maxFiles: 2, maxLinks: 1 } } })
  const bigBody = await postInput(env, env.c.ana, { text: 'x' }, [{ field: 'files', name: 'a.png', type: 'image/png', content: 'x'.repeat(11) }])
  assert.equal(bigBody.statusCode, 413)
  assert.match(bigBody.json().message, /supera el máximo/)
  const longDocument = await postInput(env, env.c.ana, { text: 'x' }, [TEXT_FILE('largo.txt', 'x'.repeat(11))]) // el tope del documento es otro
  assert.equal(longDocument.statusCode, 202)
  const three = await postInput(env, env.c.ana, { text: 'otro' }, [TEXT_FILE('1.txt'), TEXT_FILE('2.txt'), TEXT_FILE('3.txt')])
  assert.equal(three.statusCode, 413)
  const linkItems = await postInput(env, env.c.ana, { text: 'otro2', links: ['https://a.example', 'https://b.example'] })
  assert.equal(linkItems.statusCode, 413)
  await env.close()
})

test('subida: un archivo grande se escribe a disco y queda nombrado por su hash', async () => {
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
  assert.deepEqual(readdirSync(env.config.tmpDir), []) // sin temporales
  await env.close()
})

// ---------------------------------------------------------------- publicación
test('publicar valida la forma: área, plantilla de esa área, miembros, adjuntos y campos obligatorios', async () => {
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
  assert.equal((await publishIt({ area_id: idea.id, template_id: error.templates[0].id })).json().code, 'template_invalid') // plantilla de otra área
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
  assert.equal((await publishIt({}, env.c.beto)).statusCode, 404) // el input es de Ana
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM messages').n, 0) // ningún intento a medias dejó filas

  // Un mensaje por área, cada uno con su plantilla; los campos opcionales pueden ir null.
  const two = await env.api('POST', `/inputs/${id}/publish`, env.c.ana, { messages: [
    { ...base, title: 'Falla', area_id: error.id, template_id: error.templates[0].id, fields: { steps: 'a', expected: 'b', actual: 'c', where: null } },
    { ...base, title: 'Idea', area_id: idea.id, template_id: idea.templates[0].id, fields: { idea: 'i', motivation: 'm' } }
  ] })
  assert.equal(two.statusCode, 200, two.body)
  assert.deepEqual(two.json().messages.map((m) => m.area_id), [String(error.id), String(idea.id)])
  assert.deepEqual(two.json().messages[0].fields, { steps: 'a', expected: 'b', actual: 'c' })
  await env.close()
})

test('GET /inputs/:id es del emisor: otro miembro recibe 404', async () => {
  const env = await team()
  const { input_id: id } = (await postInput(env, env.c.ana, { text: 'x' })).json()
  assert.equal((await env.api('GET', `/inputs/${id}`, env.c.beto)).statusCode, 404)
  assert.equal((await env.api('GET', `/inputs/${id}`, env.c.ed)).statusCode, 404)
  assert.equal((await env.api('POST', `/inputs/${id}/cancel`, env.c.beto)).statusCode, 404)
  await env.close()
})

// ---------------------------------------------------------------- mensajes: filtros
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

test('mensajes: filtros por destinatario, área, estado, búsqueda y respuestas, con paginación', async () => {
  const env = await team({ worker: true })
  const { idea, questionArea, m1, m2, m3 } = await withMessages(env)
  const ids = async (query, cookie = env.c.ana) => (await env.api('GET', `/messages${query}`, cookie)).json().items.map((m) => m.id)

  assert.deepEqual(await ids(''), [m3, m2, m1]) // más nuevos primero
  assert.deepEqual(await ids('?for=me', env.c.beto), [m2, m1])
  assert.deepEqual(await ids('?for=me', env.c.ana), [m2])
  assert.deepEqual(await ids('?for=1', env.c.beto), [m3]) // para X
  assert.deepEqual(await ids(`?area=${idea.id}`), [m1])
  assert.deepEqual(await ids(`?area=${questionArea.id}`), [m3, m2])
  assert.deepEqual(await ids('?q=beta'), [m2])
  assert.deepEqual(await ids('?q=100%25'), [m3]) // el % se busca literal, no como comodín
  assert.deepEqual(await ids('?q=%25'), [m3])
  assert.deepEqual(await ids('?status=open'), [m3, m2, m1])
  assert.deepEqual(await ids('?replies=1'), [])

  await env.api('POST', `/messages/${m1}/replies`, env.c.beto, { body: 'listo' })
  await env.api('POST', `/messages/${m3}/replies`, env.c.ana, { body: 'visto' })
  await env.api('POST', `/messages/${m2}/close`, env.c.ed)
  assert.deepEqual(await ids('?status=answered'), [m3, m1])
  assert.deepEqual(await ids('?status=closed'), [m2])
  assert.deepEqual(await ids('?replies=1'), [m3, m1]) // última respuesta primero
  assert.deepEqual(await ids('?replies=1&for=me', env.c.ana), [m3, m1]) // Ana es emisora de m1 y m2 y respondió m3
  assert.deepEqual(await ids('?replies=1&for=me', env.c.ed), [m3]) // Ed es destinatario de m3, que tiene respuestas
  const page1 = (await env.api('GET', '/messages?limit=2', env.c.ana)).json()
  assert.equal(page1.items.length, 2)
  assert.deepEqual({ page: page1.page, limit: page1.limit, total: page1.total }, { page: 1, limit: 2, total: 3 })
  const page2 = (await env.api('GET', '/messages?limit=2&page=2', env.c.ana)).json()
  assert.deepEqual(page2.items.map((m) => m.id), [m1])
  assert.equal(page2.page, 2)
  assert.equal((await env.api('GET', '/messages?limit=101', env.c.ana)).statusCode, 400) // tope de 100
  assert.equal((await env.api('GET', '/messages?page=0', env.c.ana)).statusCode, 400)
  assert.equal((await env.api('GET', '/messages?status=raro', env.c.ana)).statusCode, 400)
  assert.equal((await env.api('GET', '/messages?for=pepe', env.c.ana)).statusCode, 400)

  const areasAfter = (await env.api('GET', '/areas', env.c.ana)).json()
  assert.equal(areasAfter.find((a) => a.id === idea.id).open_count, 0)
  assert.equal(areasAfter.find((a) => a.id === questionArea.id).unresolved_count, 1) // m3 respondido, m2 cerrado
  await env.close()
})

// ---------------------------------------------------------------- áreas y plantillas
test('áreas y plantillas: el editor las gestiona; el miembro sólo las lee sin el cuerpo', async () => {
  const env = await team()
  const views = []
  env.domainEvents.on('template.saved', (t) => views.push(t.name))
  const listValue = (await env.api('GET', '/areas', env.c.ana)).json()
  assert.equal(listValue.length, 5)
  assert.ok(listValue.every((a) => a.templates.every((t) => t.body_markdown === undefined)))

  assert.equal((await env.api('POST', '/areas', env.c.ana, { title: 'Nueva', description: 'x' })).statusCode, 403)
  const createdTemplate = await env.api('POST', '/areas', env.c.ed, { title: 'Soporte', description: 'Pedidos de ayuda' })
  assert.equal(createdTemplate.statusCode, 201)
  assert.equal(createdTemplate.json().position, 6) // las sembradas ocupan 1 a 5
  assert.equal((await env.api('POST', '/areas', env.c.ed, { title: 'soporte', description: 'x' })).statusCode, 409) // título único sin distinguir mayúsculas
  const edited = await env.api('PATCH', `/areas/${createdTemplate.json().id}`, env.c.ed, { description: 'Pedidos de ayuda del equipo' })
  assert.equal(edited.json().description, 'Pedidos de ayuda del equipo')
  assert.equal((await env.api('PATCH', '/areas/999', env.c.ed, { title: 'x' })).statusCode, 404)
  assert.equal((await env.api('PATCH', `/areas/${createdTemplate.json().id}`, env.c.ed, {})).statusCode, 400)

  const md = '---\nname: Ayuda\ndescription: Pide ayuda para usar algo.\nfields:\n  - { name: tema, label: Tema, required: true }\n---\n## Método\nUna pregunta por mensaje.\n## Formato de salida\nUn mensaje.\n'
  const t = await env.api('POST', `/areas/${createdTemplate.json().id}/templates`, env.c.ed, { body_markdown: md })
  assert.equal(t.statusCode, 201)
  assert.equal(t.json().name, 'Ayuda')
  assert.deepEqual(views, ['Ayuda'])

  // name y description por separado reescriben el encabezado y siguen siendo una plantilla válida.
  const renamed = await env.api('PATCH', `/areas/${createdTemplate.json().id}/templates/${t.json().id}`, env.c.ed, { name: 'Pedir ayuda', description: 'Nueva descripción' })
  assert.equal(renamed.statusCode, 200, renamed.body)
  assert.equal(renamed.json().name, 'Pedir ayuda')
  assert.match(renamed.json().body_markdown, /name: Pedir ayuda/)
  assert.match(renamed.json().body_markdown, /Una pregunta por mensaje/)
  const templateList = (await env.api('GET', `/areas/${createdTemplate.json().id}/templates`, env.c.ed)).json()
  assert.equal(templateList.length, 1)
  assert.ok(templateList[0].body_markdown)
  assert.equal((await env.api('GET', `/areas/${createdTemplate.json().id}/templates`, env.c.ana)).statusCode, 403)

  // Formas inválidas: 422 con el motivo, sin guardar.
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
  assert.equal((await env.api('POST', `/areas/${createdTemplate.json().id}/templates`, env.c.ed, { body_markdown: `---\nname: ${'n'.repeat(65)}\ndescription: Y\n---\ncuerpo` })).statusCode, 422) // 64 caracteres de Agent Skills
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM templates WHERE area_id = ?', createdTemplate.json().id).n, 1)

  // Borrar es en blando y exige confirmación; se restaura.
  const templateUrl = `/areas/${createdTemplate.json().id}/templates/${t.json().id}`
  const unconfirmed = await env.api('DELETE', templateUrl, env.c.ed)
  assert.equal(unconfirmed.statusCode, 400)
  assert.equal(unconfirmed.json().code, 'confirm_required')
  assert.equal((await env.api('GET', `/areas/${createdTemplate.json().id}/templates`, env.c.ed)).json().length, 1) // no se borró
  assert.equal((await env.api('DELETE', `${templateUrl}?confirm=true`, env.c.ed)).statusCode, 204)
  assert.equal((await env.api('DELETE', `${templateUrl}?confirm=true`, env.c.ed)).statusCode, 404)
  assert.equal((await env.api('GET', `/areas/${createdTemplate.json().id}/templates`, env.c.ed)).json().length, 0)
  assert.equal((await env.api('GET', `/areas/${createdTemplate.json().id}/templates?include_deleted=true`, env.c.ed)).json().length, 1)
  assert.equal((await env.api('POST', `/templates/${t.json().id}/restore`, env.c.ana)).statusCode, 403)
  const restored = await env.api('POST', `/templates/${t.json().id}/restore`, env.c.ed)
  assert.equal(restored.statusCode, 200)
  assert.equal(restored.json().deleted_at, null)
  assert.equal((await env.api('POST', `/templates/${t.json().id}/restore`, env.c.ed)).statusCode, 409) // no estaba borrada
  // El nombre de una plantilla es único dentro del área (409), no entre áreas.
  assert.equal((await env.api('POST', `/areas/${createdTemplate.json().id}/templates`, env.c.ed, { body_markdown: md.replace('name: Ayuda', 'name: pedir AYUDA') })).statusCode, 409)
  const otherArea = await env.api('POST', '/areas', env.c.ed, { title: 'Otra', description: 'x' })
  assert.equal((await env.api('POST', `/areas/${otherArea.json().id}/templates`, env.c.ed, { body_markdown: md })).statusCode, 201)

  // Un área borrada en blando desaparece de la lista y se restaura sin perder nada.
  const areaUrl = `/areas/${createdTemplate.json().id}`
  assert.equal((await env.api('DELETE', areaUrl, env.c.ed)).statusCode, 400)
  assert.equal((await env.api('DELETE', `${areaUrl}?confirm=true`, env.c.ed)).statusCode, 204)
  assert.ok(!(await env.api('GET', '/areas', env.c.ana)).json().some((a) => a.id === createdTemplate.json().id))
  assert.equal((await env.api('GET', '/areas?include_deleted=true', env.c.ana)).statusCode, 403)
  assert.ok((await env.api('GET', '/areas?include_deleted=true', env.c.ed)).json().some((a) => a.id === createdTemplate.json().id))
  // Su título queda libre mientras está borrada, y restaurar choca si alguien lo tomó.
  assert.equal((await env.api('POST', '/areas', env.c.ed, { title: 'Soporte', description: 'nueva' })).statusCode, 201)
  assert.equal((await env.api('POST', `${areaUrl}/restore`, env.c.ed)).statusCode, 409)
  await env.close()
})

// ---------------------------------------------------------------- miembros
test('miembros: alta por el editor, correo único, y siempre queda un editor', async () => {
  const env = await team()
  const fresh = await env.api('POST', '/members', env.c.ed, { email: 'Carla@x.org', name: 'Carla', profile: 'Hago la interfaz.', password: 'una clave larga de prueba 2' })
  assert.equal(fresh.statusCode, 201)
  assert.equal(fresh.json().role, 'member')
  assert.equal((await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'carla@x.org', password: 'una clave larga de prueba 2' } })).statusCode, 200)
  assert.equal((await env.api('POST', '/members', env.c.ed, { email: 'carla@x.org', name: 'Otra' })).statusCode, 409)
  assert.equal((await env.api('POST', '/members', env.c.ed, { email: 'sin-arroba', name: 'X' })).statusCode, 400)
  assert.equal((await env.api('POST', '/members', env.c.ed, { email: 'd@x.org', name: 'D', password: 'corta' })).statusCode, 400)
  assert.equal((await env.api('POST', '/members', env.c.ana, { email: 'e@x.org', name: 'E' })).statusCode, 403)
  assert.equal(get(env.db, "SELECT COUNT(*) AS n FROM members WHERE email = 'd@x.org'").n, 0)
  // El editor edita a otros; el último editor no puede dejar de serlo.
  const editedResponse = await env.api('PATCH', '/members/2', env.c.ed, { profile: 'Hago la API.\n\nNo toco la interfaz.' })
  assert.equal(editedResponse.json().profile, 'Hago la API.\n\nNo toco la interfaz.') // texto libre, párrafos incluidos
  assert.equal((await env.api('PATCH', '/members/2', env.c.ed, { responsibilities: 'API' })).statusCode, 400) // UD-023: el campo viejo ya no existe
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
  // El editor reinicia la contraseña de otra persona y cierra sus sesiones.
  const resetRes = await env.api('PATCH', '/members/3', env.c.ed, { password: 'clave reiniciada por editor' })
  assert.equal(resetRes.statusCode, 200)
  assert.equal((await env.api('GET', '/me', env.c.beto)).statusCode, 401)
  await env.close()
})

// ---------------------------------------------------------------- adjuntos
test('adjuntos: el emisor los ve antes de publicar, el equipo después, con Range y cabeceras seguras', async () => {
  const env = await team({ worker: true })
  const contents = '0123456789abcdefghij'
  const { input_id: id } = (await postInput(env, env.c.ana, { text: 'x', links: 'https://example.org' }, [{ field: 'files', name: 'dato.txt', type: 'text/plain', content: contents }, { field: 'files', name: 'foto.png', type: 'image/png', content: 'PNG!' }])).json()
  const v = await waitForProposal(env, env.c.ana, id)
  const [textFile, png, linkItem] = v.attachments
  assert.equal(linkItem.kind, 'link')
  const ask = (cookie, att, headers = {}) => env.app.inject({ url: `/api/attachments/${att.id}`, headers: { cookie, ...headers } })

  assert.equal((await ask(env.c.ana, textFile)).statusCode, 200)
  assert.equal((await ask(env.c.beto, textFile)).statusCode, 404) // sin publicar, sólo el emisor
  assert.equal((await ask(env.c.ana, linkItem)).statusCode, 404) // un enlace no es un archivo
  assert.equal((await env.app.inject({ url: `/api/attachments/${textFile.id}` })).statusCode, 401)

  await env.api('POST', `/inputs/${id}/publish`, env.c.ana, { messages: [{ ...v.proposal.messages[0], attachment_ids: [png.id] }] })
  assert.equal((await ask(env.c.beto, png)).statusCode, 200) // publicado en un mensaje: lo ve el equipo
  assert.equal((await ask(env.c.beto, textFile)).statusCode, 404) // el que no se adjuntó a ningún mensaje sigue siendo del emisor

  const fullBody = await ask(env.c.ana, textFile)
  assert.equal(fullBody.body, contents)
  assert.equal(fullBody.headers['content-disposition'], "attachment; filename*=UTF-8''dato.txt") // texto: se descarga
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

// ---------------------------------------------------------------- panel estático y bordes
test('panel estático: activos con caché inmutable, index.html sin caché, 404 JSON bajo /api, SPA para el resto', async () => {
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
  assert.match(routePath.body, /<title>Panel/) // ruta de la SPA
  assert.equal(routePath.headers['cache-control'], 'no-cache')
  const absentAsset = await env.app.inject({ url: '/assets/otro-compilado.js' })
  assert.equal(absentAsset.statusCode, 404)
  assert.equal(absentAsset.json().code, 'not_found') // un activo con hash de otra compilación no se confunde con una página
  const api404 = await env.app.inject({ url: '/api/no-existe' })
  assert.equal(api404.statusCode, 404)
  assert.equal(api404.headers['content-type'], 'application/json; charset=utf-8')
  assert.equal(api404.json().code, 'not_found')
  assert.equal((await env.app.inject({ method: 'POST', url: '/api/no-existe' })).statusCode, 404)
  assert.equal((await env.app.inject({ method: 'POST', url: '/cualquier-cosa' })).statusCode, 404) // sólo GET cae en la SPA
  // La CSP del panel: sólo el mismo origen.
  assert.match(rootDir.headers['content-security-policy'], /connect-src 'self'/)
  assert.match(rootDir.headers['content-security-policy'], /img-src 'self' blob: data:/)
  assert.match(rootDir.headers['content-security-policy'], /frame-ancestors 'none'/)
  await env.close()
})

test('sin panel compilado la API arranca igual y la raíz responde 404 JSON', async () => {
  const env = await makeEnv({ config: { panelDist: '/ruta/que/no/existe/panel' } })
  const r = await env.app.inject({ url: '/' })
  assert.equal(r.statusCode, 404)
  assert.equal(r.json().code, 'not_found')
  await env.close()
})

test('/health responde en la raíz y bajo /api, sin sesión', async () => {
  const env = await makeEnv()
  for (const url of ['/health', '/api/health']) {
    const r = await env.app.inject({ url })
    assert.equal(r.statusCode, 200)
    assert.equal(r.json().status, 'ok')
  }
  await env.close()
})

test('los errores de validación llegan en español con la forma { code, message }', async () => {
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

test('el panel no recibe columnas internas: el hash de contraseña y la ficha nunca salen', async () => {
  const env = await team()
  const bodies = [
    (await env.api('GET', '/me', env.c.ana)).body,
    (await env.api('GET', '/members', env.c.ana)).body,
    (await env.api('GET', '/areas', env.c.ana)).body
  ].join('')
  assert.ok(!/argon2|password_hash|token/.test(bodies))
  await env.close()
})

// ---------------------------------------------------------------- configuración de proveedores
test('Configuración de proveedores: el editor la lee y la cambia; un proveedor inválido se rechaza al configurarlo', async () => {
  const attemptsList = []
  const env = await team({ modules: {
    getProviders: () => ({ describe: () => [{ slot: 'text', provider: 'anthropic', model: 'claude-haiku-5-5', available: false, reason: 'Falta ANTHROPIC_API_KEY' }] }),
    buildProviders: (o) => { attemptsList.push(o); if (o.text?.provider === 'inexistente') throw new Error('Proveedor de texto desconocido «inexistente» en TEXT_PROVIDER'); return {} }
  } })
  assert.equal((await env.api('GET', '/settings/providers', env.c.ana)).statusCode, 403)
  const initialVersion = (await env.api('GET', '/settings/providers', env.c.ed)).json()
  assert.equal(initialVersion.analyzer, 'api')
  assert.deepEqual(initialVersion.items.map((i) => i.slot), ['text', 'vision', 'speech'])
  assert.equal(initialVersion.items[0].provider, 'anthropic')
  assert.equal(initialVersion.items[0].available, false)
  assert.equal(initialVersion.items[0].reason, 'Falta ANTHROPIC_API_KEY')
  assert.ok(!JSON.stringify(initialVersion).includes('API_KEY=')) // nunca una llave

  const badCase = await env.api('PATCH', '/settings/providers', env.c.ed, { slot: 'text', provider: 'inexistente', model: 'x' })
  assert.equal(badCase.statusCode, 422)
  assert.equal(badCase.json().code, 'provider_invalid')
  assert.equal((await env.api('GET', '/settings/providers', env.c.ed)).json().items[0].provider, 'anthropic') // no se guardó

  const ok = await env.api('PATCH', '/settings/providers', env.c.ed, { slot: 'text', provider: 'deepseek', model: 'deepseek-flash' })
  assert.equal(ok.statusCode, 200)
  assert.deepEqual(attemptsList.at(-1).text, { provider: 'deepseek', model: 'deepseek-flash' })
  const change = await env.api('PATCH', '/settings/providers', env.c.ed, { analyzer: 'harness' })
  assert.equal(change.json().analyzer, 'harness')
  assert.equal((await env.api('PATCH', '/settings/providers', env.c.ed, { slot: 'text', api_key: 'x' })).statusCode, 400) // la llave no se acepta
  assert.equal((await env.api('PATCH', '/settings/providers', env.c.ed, { slot: 'otra', provider: 'x' })).statusCode, 400)
  assert.equal((await env.api('PATCH', '/settings/providers', env.c.ed, { analyzer: 'otro' })).statusCode, 400)
  await env.close()
})

test('loadModules arma los proveedores con lo guardado en Configuración sobre el entorno', async () => {
  const env = await team()
  const { loadModules } = await import('../domain/modules.js')
  const { setProviderOverrides } = await import('../domain/settings.js')
  const moduleSet = await loadModules(env.config, { db: env.db, env: { TEXT_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-prueba', TEXT_MODEL: 'claude-haiku-5-5' } })
  assert.equal(moduleSet.getProviders().text.name, 'anthropic')
  assert.equal(moduleSet.getAnalyzer(), 'api')
  setProviderOverrides(env.db, { analyzer: 'harness', text: { provider: 'deepseek', model: 'deepseek-flash' } })
  // Sin llave de DeepSeek el proveedor queda «no disponible» y lo dice, sin lanzar.
  const fresh = moduleSet.getProviders()
  assert.equal(fresh.text.unavailable, 'Falta DEEPSEEK_API_KEY')
  assert.equal(moduleSet.getAnalyzer(), 'harness')
  assert.throws(() => moduleSet.buildProviders({ text: { provider: 'inexistente' } }), /desconocido/)
  await env.close()
})

// ---------------------------------------------------------------- resumen de lo que afecta (UD-028)
test('UD-028 · GET /messages/summary: cada mensaje cae en una sola prioridad, el cerrado no cuenta y los abiertos se cuentan por área', async () => {
  const env = await team({ worker: true })
  const { idea, questionArea, m2 } = await withMessages(env) // Ana (2) emitió m1 y m2; Beto (3) emitió m3. m1 → Beto; m2 → Beto y Ana; m3 → Ed (1)
  const summary = async (cookie) => (await env.api('GET', '/messages/summary', cookie)).json()
  const areaRow = (s, area) => s.areas.find((a) => a.area_id === String(area.id))

  // Todo abierto: lo asignado es rojo; emitir sin respuestas no cuenta.
  assert.deepEqual((await summary(env.c.beto)).mine, { red: 2, yellow: 0, blue: 0, total: 2 })
  assert.deepEqual((await summary(env.c.ana)).mine, { red: 1, yellow: 0, blue: 0, total: 1 })
  assert.deepEqual((await summary(env.c.ed)).mine, { red: 1, yellow: 0, blue: 0, total: 1 })
  assert.deepEqual(areaRow(await summary(env.c.ana), questionArea), { area_id: String(questionArea.id), open: 2, mine_open: 1 })
  assert.deepEqual(areaRow(await summary(env.c.ed), idea), { area_id: String(idea.id), open: 1, mine_open: 0 })

  // Respuestas: lo asignado y respondido baja a amarillo; lo emitido por mí y respondido es azul.
  const m1 = (await env.api('GET', `/messages?area=${idea.id}`, env.c.ana)).json().items[0].id
  const m3 = (await env.api('GET', `/messages?for=1`, env.c.ana)).json().items[0].id
  await env.api('POST', `/messages/${m1}/replies`, env.c.beto, { body: 'listo' })
  await env.api('POST', `/messages/${m3}/replies`, env.c.ana, { body: 'visto' })
  assert.deepEqual((await summary(env.c.beto)).mine, { red: 1, yellow: 1, blue: 1, total: 3 })
  assert.deepEqual((await summary(env.c.ana)).mine, { red: 1, yellow: 0, blue: 1, total: 2 })
  assert.deepEqual((await summary(env.c.ed)).mine, { red: 0, yellow: 1, blue: 0, total: 1 })
  assert.equal(areaRow(await summary(env.c.ana), idea).open, 0) // lo respondido ya no es «abierto»
  assert.equal(areaRow(await summary(env.c.ana), questionArea).open, 1)

  // La lista de la campana es la cuenta, mensaje por mensaje (J2-A-43): mismas prioridades y mismo total.
  for (const cookie of [env.c.beto, env.c.ana, env.c.ed]) {
    const s = await summary(cookie)
    assert.equal(s.items.length, s.mine.total)
    for (const tone of ['red', 'yellow', 'blue']) assert.equal(s.items.filter((i) => i.tone === tone).length, s.mine[tone])
    assert.ok(s.items.every((i) => i.title && i.message_id))
  }

  // Cerrar saca el mensaje de la cuenta de todos.
  await env.api('POST', `/messages/${m2}/close`, env.c.ed)
  assert.deepEqual((await summary(env.c.beto)).mine, { red: 0, yellow: 1, blue: 1, total: 2 })
  assert.equal((await summary(env.c.beto)).items.some((i) => i.message_id === String(m2)), false, 'un mensaje cerrado no figura en la lista')
  assert.equal(areaRow(await summary(env.c.beto), questionArea).open, 0)
  assert.equal((await env.app.inject({ method: 'GET', url: '/api/messages/summary' })).statusCode, 401) // exige sesión
  await env.close()
})
