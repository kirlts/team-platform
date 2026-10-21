import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { all, get } from '../db/index.js'
import { addMember, fakeExtract, login, makeEnv, multipart, postInput, until } from '../testing/helpers.js'

const sinLimiteIp = { identity: { login: { ipMax: 1000 } } }
const TEXTO = (nombre, contenido = 'contenido de prueba') => ({ field: 'files', name: nombre, type: 'text/plain', content: contenido })

/** Equipo de prueba: un editor y dos miembros con sesión iniciada. */
async function equipo (opts = {}) {
  const env = await makeEnv({ config: sinLimiteIp, ...opts })
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

async function esperarPropuesta (env, cookie, inputId) {
  return until(async () => {
    const r = await env.api('GET', `/inputs/${inputId}`, cookie)
    const v = r.json()
    if (v.status === 'failed') throw new Error(`el input falló: ${v.error}`)
    return v.status === 'proposed' ? v : null
  })
}

// ---------------------------------------------------------------- flujo completo
test('flujo completo: enviar, analizar, editar, publicar, responder, cerrar y reabrir', async () => {
  const env = await equipo({ worker: true, modules: {
    extract: async (a, { onProgress }) => {
      onProgress(50, 'leyendo')
      return { text: `texto de ${a.kind}`, meta: { kind: a.kind, calls: [{ modality: 'vision', images: 1, usage: { input_tokens: 2000, output_tokens: 100 } }] } }
    }
  } })
  const r = await postInput(env, env.c.ana, { text: 'el botón de guardar no responde', links: 'https://example.org/p' }, [TEXTO('nota.txt')])
  assert.equal(r.statusCode, 202)
  const { input_id: inputId, job_id: jobId, duplicate } = r.json()
  assert.equal(duplicate, false)
  assert.ok(jobId)

  const vista = await esperarPropuesta(env, env.c.ana, inputId)
  assert.equal(vista.attachments.length, 2)
  assert.ok(vista.attachments.every((a) => a.extracted))
  assert.equal(vista.proposal.messages.length, 1)
  const propuesta = vista.proposal.messages[0]
  assert.match(propuesta.area_id, /^\d+$/) // todo id viaja como texto
  assert.match(propuesta.template_id, /^\d+$/)
  assert.deepEqual(vista.units, []) // el doble del analizador no numera unidades
  assert.equal(vista.job_id, String(jobId))
  assert.match(propuesta.body, /texto de document/)
  assert.equal(vista.job.status, 'done')

  // Registros de costo: la llamada del analizador y las dos del extractor (visión) con su costo calculado.
  const llamadas = all(env.db, 'SELECT * FROM llm_calls ORDER BY id')
  assert.equal(llamadas.length, 3)
  const analisis = llamadas.find((l) => l.provider === 'doble')
  assert.equal(analisis.modality, 'text')
  assert.ok(Math.abs(analisis.cost_usd - (1000 * 0.10 + 200 * 0.50) / 1e6) < 1e-12)
  assert.equal(get(env.db, 'SELECT model_call_id FROM proposals').model_call_id, analisis.id)

  // El emisor edita la propuesta (título, destinatario Beto) y la publica.
  const editada = { messages: [{ ...propuesta, title: 'Guardar no responde', assignee_ids: [3], attachment_ids: [vista.attachments[0].id] }] }
  const pub = await env.api('POST', `/inputs/${inputId}/publish`, env.c.ana, editada)
  assert.equal(pub.statusCode, 200, pub.body)
  const [mensajeId] = pub.json().message_ids
  assert.equal(pub.json().messages[0].status, 'open')
  assert.equal((await env.api('GET', `/inputs/${inputId}`, env.c.ana)).json().status, 'published')
  assert.equal((await env.api('POST', `/inputs/${inputId}/publish`, env.c.ana, editada)).statusCode, 409) // no se publica dos veces

  // Beto lo ve en «para mí»; Ed (no asignado) no.
  const paraBeto = (await env.api('GET', '/messages?for=me', env.c.beto)).json()
  assert.deepEqual(paraBeto.items.map((m) => m.id), [mensajeId])
  assert.equal(paraBeto.items[0].author_id, '2') // Ana
  assert.deepEqual(paraBeto.items[0].assignee_ids, ['3']) // Beto
  assert.equal(paraBeto.total, 1)
  assert.equal(paraBeto.items[0].attachments.length, 1)
  assert.equal((await env.api('GET', '/messages?for=me', env.c.ed)).json().items.length, 0)
  assert.equal((await env.api('GET', '/messages', env.c.ed)).json().items.length, 1) // todos ven todos en Mensajes

  // Sólo un miembro distinto del emisor responde.
  const propia = await env.api('POST', `/messages/${mensajeId}/replies`, env.c.ana, { body: 'yo mismo' })
  assert.equal(propia.statusCode, 403)
  assert.equal(propia.json().code, 'author_cannot_reply')
  const resp = await env.api('POST', `/messages/${mensajeId}/replies`, env.c.beto, { body: 'ya lo reviso', kind: 'clarification' })
  assert.equal(resp.statusCode, 201)
  assert.equal(resp.json().status, 'answered')
  assert.equal(resp.json().replies.length, 1)
  assert.equal(resp.json().replies[0].kind, 'clarification')
  assert.equal(resp.json().reply_count, 1)
  assert.equal(resp.json().last_reply.author_id, '3')
  assert.equal((await env.api('POST', `/messages/${mensajeId}/replies`, env.c.ed, { body: 'otra' })).json().replies.length, 2) // un hilo

  // Cualquiera cierra y reabre; un cerrado no recibe respuestas.
  const cerrado = await env.api('POST', `/messages/${mensajeId}/close`, env.c.ed)
  assert.equal(cerrado.json().status, 'closed')
  assert.ok(cerrado.json().closed_at)
  assert.equal((await env.api('POST', `/messages/${mensajeId}/close`, env.c.ed)).statusCode, 409)
  assert.equal((await env.api('POST', `/messages/${mensajeId}/replies`, env.c.beto, { body: 'x' })).statusCode, 409)
  const reabierto = await env.api('POST', `/messages/${mensajeId}/reopen`, env.c.ana)
  assert.equal(reabierto.json().status, 'answered') // tiene respuestas
  assert.equal(reabierto.json().closed_at, null)
  assert.equal((await env.api('POST', `/messages/${mensajeId}/reopen`, env.c.ana)).statusCode, 409)
  await env.close()
})

test('reabrir un mensaje sin respuestas lo devuelve a abierto', async () => {
  const env = await equipo({ worker: true })
  const { input_id: id } = (await postInput(env, env.c.ana, { text: 'hola' })).json()
  const v = await esperarPropuesta(env, env.c.ana, id)
  const pub = await env.api('POST', `/inputs/${id}/publish`, env.c.ana, { messages: v.proposal.messages })
  const m = pub.json().message_ids[0]
  await env.api('POST', `/messages/${m}/close`, env.c.beto)
  assert.equal((await env.api('POST', `/messages/${m}/reopen`, env.c.beto)).json().status, 'open')
  await env.close()
})

// ---------------------------------------------------------------- idempotencia
test('el mismo contenido del mismo emisor devuelve lo que ya hay; otro emisor tiene su propio input', async () => {
  const env = await equipo()
  const enviar = (cookie) => postInput(env, cookie, { text: '  mismo texto  \r\n' }, [TEXTO('a.txt', 'abc')])
  const a = await enviar(env.c.ana)
  const b = await postInput(env, env.c.ana, { text: 'mismo texto' }, [TEXTO('otro-nombre.txt', 'abc')]) // texto normalizado y mismo adjunto por hash
  assert.equal(a.statusCode, 202)
  assert.equal(b.statusCode, 200)
  assert.equal(b.json().duplicate, true)
  assert.equal(b.json().input_id, a.json().input_id)
  assert.equal(b.json().job_id, a.json().job_id)
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM jobs').n, 1) // ni un segundo trabajo
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM attachments').n, 1)
  const c = await enviar(env.c.beto)
  assert.equal(c.statusCode, 202)
  assert.notEqual(c.json().input_id, a.json().input_id)
  // Un adjunto distinto es otro input.
  assert.equal((await postInput(env, env.c.ana, { text: 'mismo texto' }, [TEXTO('a.txt', 'abd')])).statusCode, 202)
  await env.close()
})

test('reenviar un input fallido o cancelado lo reintenta sobre la misma fila', async () => {
  const env = await equipo()
  const a = (await postInput(env, env.c.ana, { text: 'x' })).json()
  const cancel = await env.api('POST', `/inputs/${a.input_id}/cancel`, env.c.ana)
  assert.equal(cancel.statusCode, 200)
  assert.deepEqual(cancel.json().cancelled_jobs, [a.job_id])
  assert.equal((await env.api('POST', `/inputs/${a.input_id}/cancel`, env.c.ana)).statusCode, 409)
  const otra = await postInput(env, env.c.ana, { text: 'x' })
  assert.equal(otra.statusCode, 202)
  assert.equal(otra.json().restarted, true)
  assert.equal(otra.json().input_id, a.input_id)
  assert.notEqual(otra.json().job_id, a.job_id)
  assert.equal((await env.api('GET', `/inputs/${a.input_id}`, env.c.ana)).json().status, 'queued')
  await env.close()
})

// ---------------------------------------------------------------- validación de la subida
test('subida: envío vacío, formato no admitido, enlace inválido y cuerpo no multipart', async () => {
  const env = await equipo()
  const vacio = await postInput(env, env.c.ana, { text: '   ' })
  assert.equal(vacio.statusCode, 400)
  assert.equal(vacio.json().code, 'input_empty')
  const svg = await postInput(env, env.c.ana, { text: 'x' }, [{ field: 'files', name: 'logo.svg', type: 'image/svg+xml', content: '<svg/>' }])
  assert.equal(svg.statusCode, 415)
  const exe = await postInput(env, env.c.ana, { text: 'x' }, [{ field: 'files', name: 'a.exe', type: 'application/octet-stream', content: 'MZ' }])
  assert.equal(exe.statusCode, 415)
  assert.equal((await postInput(env, env.c.ana, { text: 'x', links: 'no es una url' })).statusCode, 400)
  assert.equal((await postInput(env, env.c.ana, { text: 'x', links: 'ftp://host/archivo' })).statusCode, 400)
  const json = await env.app.inject({ method: 'POST', url: '/api/inputs', headers: { cookie: env.c.ana, 'x-team-request': 'panel' }, payload: { text: 'x' } })
  assert.equal(json.statusCode, 415)
  const vacioArchivo = await postInput(env, env.c.ana, { text: 'x' }, [TEXTO('v.txt', '')])
  assert.equal(vacioArchivo.statusCode, 400)
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM inputs').n, 0) // nada quedó a medias
  await env.close()
})

test('subida: el tipo octet-stream se clasifica por extensión', async () => {
  const env = await equipo()
  const r = await postInput(env, env.c.ana, { text: 'x' }, [{ field: 'files', name: 'informe.pdf', type: 'application/octet-stream', content: '%PDF-1.4' }])
  assert.equal(r.statusCode, 202)
  assert.equal(get(env.db, 'SELECT kind, mime FROM attachments').kind, 'document')
  await env.close()
})

test('subida: topes por tipo, cantidad de archivos y de enlaces, con los límites de la configuración', async () => {
  const env = await equipo({ config: { ...sinLimiteIp, uploads: { maxImageBytes: 10, maxFiles: 2, maxLinks: 1 } } })
  const grande = await postInput(env, env.c.ana, { text: 'x' }, [{ field: 'files', name: 'a.png', type: 'image/png', content: 'x'.repeat(11) }])
  assert.equal(grande.statusCode, 413)
  assert.match(grande.json().message, /supera el máximo/)
  const documentoLargo = await postInput(env, env.c.ana, { text: 'x' }, [TEXTO('largo.txt', 'x'.repeat(11))]) // el tope del documento es otro
  assert.equal(documentoLargo.statusCode, 202)
  const tres = await postInput(env, env.c.ana, { text: 'otro' }, [TEXTO('1.txt'), TEXTO('2.txt'), TEXTO('3.txt')])
  assert.equal(tres.statusCode, 413)
  const enlaces = await postInput(env, env.c.ana, { text: 'otro2', links: ['https://a.example', 'https://b.example'] })
  assert.equal(enlaces.statusCode, 413)
  await env.close()
})

test('subida: un archivo grande se escribe a disco y queda nombrado por su hash', async () => {
  const env = await equipo()
  const contenido = Buffer.alloc(3 * 1024 * 1024, 7)
  const r = await postInput(env, env.c.ana, { text: 'x' }, [{ field: 'files', name: 'grande.mp3', type: 'audio/mpeg', content: contenido }])
  assert.equal(r.statusCode, 202)
  const fila = get(env.db, 'SELECT * FROM attachments')
  assert.equal(fila.size, contenido.length)
  assert.equal(fila.kind, 'audio')
  const { createHash } = await import('node:crypto')
  assert.equal(fila.sha256, createHash('sha256').update(contenido).digest('hex'))
  assert.equal(fila.path, fila.sha256)
  const { statSync, readdirSync } = await import('node:fs')
  assert.equal(statSync(path.join(env.config.attachmentsDir, fila.sha256)).size, contenido.length)
  assert.deepEqual(readdirSync(env.config.tmpDir), []) // sin temporales
  await env.close()
})

// ---------------------------------------------------------------- publicación
test('publicar valida la forma: área, plantilla de esa área, miembros, adjuntos y campos obligatorios', async () => {
  const env = await equipo({ worker: true })
  const { input_id: id } = (await postInput(env, env.c.ana, { text: 'algo' }, [TEXTO('a.txt')])).json()
  const v = await esperarPropuesta(env, env.c.ana, id)
  const base = v.proposal.messages[0]
  const publicar = (cambios, cookie = env.c.ana) => env.api('POST', `/inputs/${id}/publish`, cookie, { messages: [{ ...base, ...cambios }] })
  const areas = (await env.api('GET', '/areas', env.c.ana)).json()
  const error = areas.find((a) => a.title === 'Error')
  const idea = areas.find((a) => a.title === 'Idea')

  assert.equal((await publicar({ area_id: 999 })).json().code, 'area_invalid')
  assert.equal((await publicar({ template_id: 999 })).json().code, 'template_invalid')
  assert.equal((await publicar({ area_id: idea.id, template_id: error.templates[0].id })).json().code, 'template_invalid') // plantilla de otra área
  assert.equal((await publicar({ assignee_ids: [999] })).json().code, 'assignee_invalid')
  assert.equal((await publicar({ attachment_ids: [999] })).json().code, 'attachment_invalid')
  assert.equal((await publicar({ title: '   ' })).json().code, 'message_invalid')
  assert.equal((await publicar({ body: '' })).json().code, 'message_invalid')
  const faltan = await publicar({ area_id: error.id, template_id: error.templates[0].id, fields: {} })
  assert.equal(faltan.statusCode, 422)
  assert.equal(faltan.json().code, 'fields_invalid')
  assert.match(faltan.json().message, /steps/)
  const extra = await publicar({ area_id: error.id, template_id: error.templates[0].id, fields: { steps: 'a', expected: 'b', actual: 'c', inventado: 'd' } })
  assert.match(extra.json().message, /inventado/)
  assert.equal((await env.api('POST', `/inputs/${id}/publish`, env.c.ana, { messages: [] })).statusCode, 400)
  assert.equal((await publicar({}, env.c.beto)).statusCode, 404) // el input es de Ana
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM messages').n, 0) // ningún intento a medias dejó filas

  // Un mensaje por área, cada uno con su plantilla; los campos opcionales pueden ir null.
  const dos = await env.api('POST', `/inputs/${id}/publish`, env.c.ana, { messages: [
    { ...base, title: 'Falla', area_id: error.id, template_id: error.templates[0].id, fields: { steps: 'a', expected: 'b', actual: 'c', where: null } },
    { ...base, title: 'Idea', area_id: idea.id, template_id: idea.templates[0].id, fields: { idea: 'i', motivation: 'm' } }
  ] })
  assert.equal(dos.statusCode, 200, dos.body)
  assert.deepEqual(dos.json().messages.map((m) => m.area_id), [String(error.id), String(idea.id)])
  assert.deepEqual(dos.json().messages[0].fields, { steps: 'a', expected: 'b', actual: 'c' })
  await env.close()
})

test('GET /inputs/:id es del emisor: otro miembro recibe 404', async () => {
  const env = await equipo()
  const { input_id: id } = (await postInput(env, env.c.ana, { text: 'x' })).json()
  assert.equal((await env.api('GET', `/inputs/${id}`, env.c.beto)).statusCode, 404)
  assert.equal((await env.api('GET', `/inputs/${id}`, env.c.ed)).statusCode, 404)
  assert.equal((await env.api('POST', `/inputs/${id}/cancel`, env.c.beto)).statusCode, 404)
  await env.close()
})

// ---------------------------------------------------------------- mensajes: filtros
async function conMensajes (env) {
  const areas = (await env.api('GET', '/areas', env.c.ana)).json()
  const crear = async (texto, area, asignados, autor = env.c.ana) => {
    const fields = area.title === 'Idea' ? { idea: texto, motivation: 'm' } : { question: texto }
    const { input_id: id } = (await postInput(env, autor, { text: texto })).json()
    const v = await esperarPropuesta(env, autor, id)
    const r = await env.api('POST', `/inputs/${id}/publish`, autor, { messages: [{ ...v.proposal.messages[0], title: texto, body: `cuerpo ${texto}`, area_id: area.id, template_id: area.templates[0].id, fields, assignee_ids: asignados }] })
    return r.json().message_ids[0]
  }
  const idea = areas.find((a) => a.title === 'Idea')
  const pregunta = areas.find((a) => a.title === 'Pregunta')
  return {
    idea, pregunta,
    m1: await crear('alfa uno', idea, [3]),
    m2: await crear('beta dos', pregunta, [3, 2]),
    m3: await crear('gamma 100% tres', pregunta, [1], env.c.beto)
  }
}

test('mensajes: filtros por destinatario, área, estado, búsqueda y respuestas, con paginación', async () => {
  const env = await equipo({ worker: true })
  const { idea, pregunta, m1, m2, m3 } = await conMensajes(env)
  const ids = async (query, cookie = env.c.ana) => (await env.api('GET', `/messages${query}`, cookie)).json().items.map((m) => m.id)

  assert.deepEqual(await ids(''), [m3, m2, m1]) // más nuevos primero
  assert.deepEqual(await ids('?for=me', env.c.beto), [m2, m1])
  assert.deepEqual(await ids('?for=me', env.c.ana), [m2])
  assert.deepEqual(await ids('?for=1', env.c.beto), [m3]) // para X
  assert.deepEqual(await ids(`?area=${idea.id}`), [m1])
  assert.deepEqual(await ids(`?area=${pregunta.id}`), [m3, m2])
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
  const pag1 = (await env.api('GET', '/messages?limit=2', env.c.ana)).json()
  assert.equal(pag1.items.length, 2)
  assert.deepEqual({ page: pag1.page, limit: pag1.limit, total: pag1.total }, { page: 1, limit: 2, total: 3 })
  const pag2 = (await env.api('GET', '/messages?limit=2&page=2', env.c.ana)).json()
  assert.deepEqual(pag2.items.map((m) => m.id), [m1])
  assert.equal(pag2.page, 2)
  assert.equal((await env.api('GET', '/messages?limit=101', env.c.ana)).statusCode, 400) // tope de 100
  assert.equal((await env.api('GET', '/messages?page=0', env.c.ana)).statusCode, 400)
  assert.equal((await env.api('GET', '/messages?status=raro', env.c.ana)).statusCode, 400)
  assert.equal((await env.api('GET', '/messages?for=pepe', env.c.ana)).statusCode, 400)

  const areasDespues = (await env.api('GET', '/areas', env.c.ana)).json()
  assert.equal(areasDespues.find((a) => a.id === idea.id).open_count, 0)
  assert.equal(areasDespues.find((a) => a.id === pregunta.id).unresolved_count, 1) // m3 respondido, m2 cerrado
  await env.close()
})

// ---------------------------------------------------------------- áreas y plantillas
test('áreas y plantillas: el editor las gestiona; el miembro sólo las lee sin el cuerpo', async () => {
  const env = await equipo()
  const vistas = []
  env.domainEvents.on('template.saved', (t) => vistas.push(t.name))
  const lista = (await env.api('GET', '/areas', env.c.ana)).json()
  assert.equal(lista.length, 5)
  assert.ok(lista.every((a) => a.templates.every((t) => t.body_markdown === undefined)))

  assert.equal((await env.api('POST', '/areas', env.c.ana, { title: 'Nueva', description: 'x' })).statusCode, 403)
  const creada = await env.api('POST', '/areas', env.c.ed, { title: 'Soporte', description: 'Pedidos de ayuda' })
  assert.equal(creada.statusCode, 201)
  assert.equal(creada.json().position, 6) // las sembradas ocupan 1 a 5
  assert.equal((await env.api('POST', '/areas', env.c.ed, { title: 'soporte', description: 'x' })).statusCode, 409) // título único sin distinguir mayúsculas
  const editada = await env.api('PATCH', `/areas/${creada.json().id}`, env.c.ed, { description: 'Pedidos de ayuda del equipo' })
  assert.equal(editada.json().description, 'Pedidos de ayuda del equipo')
  assert.equal((await env.api('PATCH', '/areas/999', env.c.ed, { title: 'x' })).statusCode, 404)
  assert.equal((await env.api('PATCH', `/areas/${creada.json().id}`, env.c.ed, {})).statusCode, 400)

  const md = '---\nname: Ayuda\ndescription: Pide ayuda para usar algo.\nfields:\n  - { name: tema, label: Tema, required: true }\n---\n## Método\nUna pregunta por mensaje.\n## Formato de salida\nUn mensaje.\n'
  const t = await env.api('POST', `/areas/${creada.json().id}/templates`, env.c.ed, { body_markdown: md })
  assert.equal(t.statusCode, 201)
  assert.equal(t.json().name, 'Ayuda')
  assert.deepEqual(vistas, ['Ayuda'])

  // name y description por separado reescriben el encabezado y siguen siendo una plantilla válida.
  const renombrada = await env.api('PATCH', `/areas/${creada.json().id}/templates/${t.json().id}`, env.c.ed, { name: 'Pedir ayuda', description: 'Nueva descripción' })
  assert.equal(renombrada.statusCode, 200, renombrada.body)
  assert.equal(renombrada.json().name, 'Pedir ayuda')
  assert.match(renombrada.json().body_markdown, /name: Pedir ayuda/)
  assert.match(renombrada.json().body_markdown, /Una pregunta por mensaje/)
  const listaPlantillas = (await env.api('GET', `/areas/${creada.json().id}/templates`, env.c.ed)).json()
  assert.equal(listaPlantillas.length, 1)
  assert.ok(listaPlantillas[0].body_markdown)
  assert.equal((await env.api('GET', `/areas/${creada.json().id}/templates`, env.c.ana)).statusCode, 403)

  // Formas inválidas: 422 con el motivo, sin guardar.
  for (const [malo, motivo] of [
    ['sin encabezado', /empezar con un frontmatter/],
    ['---\nname: X\n---\ncuerpo', /description/],
    ['---\nname: X\ndescription: Y\nfields:\n  - { name: Mal Nombre, label: L, required: true }\n---\ncuerpo', /identificador/],
    ['---\nname: X\ndescription: Y\nraro: 1\n---\ncuerpo', /desconocidas/]
  ]) {
    const r = await env.api('POST', `/areas/${creada.json().id}/templates`, env.c.ed, { body_markdown: malo })
    assert.equal(r.statusCode, 422, malo)
    assert.equal(r.json().code, 'template_invalid')
    assert.match(r.json().message, motivo)
  }
  assert.equal((await env.api('POST', `/areas/${creada.json().id}/templates`, env.c.ed, { body_markdown: `---\nname: ${'n'.repeat(65)}\ndescription: Y\n---\ncuerpo` })).statusCode, 422) // 64 caracteres de Agent Skills
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM templates WHERE area_id = ?', creada.json().id).n, 1)

  // Borrar es en blando y exige confirmación; se restaura.
  const urlPlantilla = `/areas/${creada.json().id}/templates/${t.json().id}`
  const sinConfirmar = await env.api('DELETE', urlPlantilla, env.c.ed)
  assert.equal(sinConfirmar.statusCode, 400)
  assert.equal(sinConfirmar.json().code, 'confirm_required')
  assert.equal((await env.api('GET', `/areas/${creada.json().id}/templates`, env.c.ed)).json().length, 1) // no se borró
  assert.equal((await env.api('DELETE', `${urlPlantilla}?confirm=true`, env.c.ed)).statusCode, 204)
  assert.equal((await env.api('DELETE', `${urlPlantilla}?confirm=true`, env.c.ed)).statusCode, 404)
  assert.equal((await env.api('GET', `/areas/${creada.json().id}/templates`, env.c.ed)).json().length, 0)
  assert.equal((await env.api('GET', `/areas/${creada.json().id}/templates?include_deleted=true`, env.c.ed)).json().length, 1)
  assert.equal((await env.api('POST', `/templates/${t.json().id}/restore`, env.c.ana)).statusCode, 403)
  const restaurada = await env.api('POST', `/templates/${t.json().id}/restore`, env.c.ed)
  assert.equal(restaurada.statusCode, 200)
  assert.equal(restaurada.json().deleted_at, null)
  assert.equal((await env.api('POST', `/templates/${t.json().id}/restore`, env.c.ed)).statusCode, 409) // no estaba borrada
  // El nombre de una plantilla es único dentro del área (409), no entre áreas.
  assert.equal((await env.api('POST', `/areas/${creada.json().id}/templates`, env.c.ed, { body_markdown: md.replace('name: Ayuda', 'name: pedir AYUDA') })).statusCode, 409)
  const otraArea = await env.api('POST', '/areas', env.c.ed, { title: 'Otra', description: 'x' })
  assert.equal((await env.api('POST', `/areas/${otraArea.json().id}/templates`, env.c.ed, { body_markdown: md })).statusCode, 201)

  // Un área borrada en blando desaparece de la lista y se restaura sin perder nada.
  const areaUrl = `/areas/${creada.json().id}`
  assert.equal((await env.api('DELETE', areaUrl, env.c.ed)).statusCode, 400)
  assert.equal((await env.api('DELETE', `${areaUrl}?confirm=true`, env.c.ed)).statusCode, 204)
  assert.ok(!(await env.api('GET', '/areas', env.c.ana)).json().some((a) => a.id === creada.json().id))
  assert.equal((await env.api('GET', '/areas?include_deleted=true', env.c.ana)).statusCode, 403)
  assert.ok((await env.api('GET', '/areas?include_deleted=true', env.c.ed)).json().some((a) => a.id === creada.json().id))
  // Su título queda libre mientras está borrada, y restaurar choca si alguien lo tomó.
  assert.equal((await env.api('POST', '/areas', env.c.ed, { title: 'Soporte', description: 'nueva' })).statusCode, 201)
  assert.equal((await env.api('POST', `${areaUrl}/restore`, env.c.ed)).statusCode, 409)
  await env.close()
})

// ---------------------------------------------------------------- miembros
test('miembros: alta por el editor, correo único, y siempre queda un editor', async () => {
  const env = await equipo()
  const nuevo = await env.api('POST', '/members', env.c.ed, { email: 'Carla@x.org', name: 'Carla', responsibilities: 'UI', password: 'una clave larga de prueba 2' })
  assert.equal(nuevo.statusCode, 201)
  assert.equal(nuevo.json().role, 'member')
  assert.equal((await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'carla@x.org', password: 'una clave larga de prueba 2' } })).statusCode, 200)
  assert.equal((await env.api('POST', '/members', env.c.ed, { email: 'carla@x.org', name: 'Otra' })).statusCode, 409)
  assert.equal((await env.api('POST', '/members', env.c.ed, { email: 'sin-arroba', name: 'X' })).statusCode, 400)
  assert.equal((await env.api('POST', '/members', env.c.ed, { email: 'd@x.org', name: 'D', password: 'corta' })).statusCode, 400)
  assert.equal((await env.api('POST', '/members', env.c.ana, { email: 'e@x.org', name: 'E' })).statusCode, 403)
  assert.equal(get(env.db, "SELECT COUNT(*) AS n FROM members WHERE email = 'd@x.org'").n, 0)
  // El editor edita a otros; el último editor no puede dejar de serlo.
  const edita = await env.api('PATCH', '/members/2', env.c.ed, { responsibilities: 'API', domains: ['backend', 'datos'] })
  assert.equal(edita.json().responsibilities, 'API')
  assert.deepEqual(edita.json().domains, ['backend', 'datos']) // los dominios son una lista
  const ultimo = await env.api('PATCH', '/members/1', env.c.ed, { role: 'member' })
  assert.equal(ultimo.statusCode, 409)
  assert.equal(ultimo.json().code, 'last_editor')
  assert.equal((await env.api('PATCH', '/members/1', env.c.ed, { email: 'ana@x.org' })).statusCode, 409)
  assert.equal((await env.api('PATCH', '/members/999', env.c.ed, { name: 'x' })).statusCode, 404)
  const pagina = (await env.api('GET', '/members', env.c.ana)).json()
  const lista = pagina.items
  assert.equal(pagina.total, 4)
  assert.equal(lista.length, 4)
  assert.ok(lista.every((m) => m.password === undefined && m.password_hash === undefined))
  // El editor reinicia la contraseña de otra persona y cierra sus sesiones.
  const reinicio = await env.api('PATCH', '/members/3', env.c.ed, { password: 'clave reiniciada por editor' })
  assert.equal(reinicio.statusCode, 200)
  assert.equal((await env.api('GET', '/me', env.c.beto)).statusCode, 401)
  await env.close()
})

// ---------------------------------------------------------------- adjuntos
test('adjuntos: el emisor los ve antes de publicar, el equipo después, con Range y cabeceras seguras', async () => {
  const env = await equipo({ worker: true })
  const contenido = '0123456789abcdefghij'
  const { input_id: id } = (await postInput(env, env.c.ana, { text: 'x', links: 'https://example.org' }, [{ field: 'files', name: 'dato.txt', type: 'text/plain', content: contenido }, { field: 'files', name: 'foto.png', type: 'image/png', content: 'PNG!' }])).json()
  const v = await esperarPropuesta(env, env.c.ana, id)
  const [txt, png, enlace] = v.attachments
  assert.equal(enlace.kind, 'link')
  const pedir = (cookie, adjunto, headers = {}) => env.app.inject({ url: `/api/attachments/${adjunto.id}`, headers: { cookie, ...headers } })

  assert.equal((await pedir(env.c.ana, txt)).statusCode, 200)
  assert.equal((await pedir(env.c.beto, txt)).statusCode, 404) // sin publicar, sólo el emisor
  assert.equal((await pedir(env.c.ana, enlace)).statusCode, 404) // un enlace no es un archivo
  assert.equal((await env.app.inject({ url: `/api/attachments/${txt.id}` })).statusCode, 401)

  await env.api('POST', `/inputs/${id}/publish`, env.c.ana, { messages: [{ ...v.proposal.messages[0], attachment_ids: [png.id] }] })
  assert.equal((await pedir(env.c.beto, png)).statusCode, 200) // publicado en un mensaje: lo ve el equipo
  assert.equal((await pedir(env.c.beto, txt)).statusCode, 404) // el que no se adjuntó a ningún mensaje sigue siendo del emisor

  const completo = await pedir(env.c.ana, txt)
  assert.equal(completo.body, contenido)
  assert.equal(completo.headers['content-disposition'], "attachment; filename*=UTF-8''dato.txt") // texto: se descarga
  assert.equal(completo.headers['x-content-type-options'], 'nosniff')
  assert.match(completo.headers['content-security-policy'], /sandbox/)
  const imagen = await pedir(env.c.ana, png)
  assert.match(imagen.headers['content-disposition'], /^inline/)
  assert.equal(imagen.headers['content-type'], 'image/png')
  const parcial = await pedir(env.c.ana, txt, { range: 'bytes=5-9' })
  assert.equal(parcial.statusCode, 206)
  assert.equal(parcial.body, '56789')
  assert.equal(parcial.headers['content-range'], 'bytes 5-9/20')
  assert.equal((await pedir(env.c.ana, txt, { range: 'bytes=-4' })).body, 'ghij')
  assert.equal((await pedir(env.c.ana, txt, { range: 'bytes=15-' })).body, 'fghij')
  const fuera = await pedir(env.c.ana, txt, { range: 'bytes=99-120' })
  assert.equal(fuera.statusCode, 416)
  assert.equal(fuera.headers['content-range'], 'bytes */20')
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

  const activo = await env.app.inject({ url: '/assets/app-abc123.js' })
  assert.equal(activo.statusCode, 200)
  assert.match(activo.headers['cache-control'], /max-age=31536000/)
  assert.match(activo.headers['cache-control'], /immutable/)
  const raiz = await env.app.inject({ url: '/' })
  assert.equal(raiz.statusCode, 200)
  assert.match(raiz.body, /<title>Panel/)
  assert.equal(raiz.headers['cache-control'], 'no-cache')
  const index = await env.app.inject({ url: '/index.html' })
  assert.equal(index.headers['cache-control'], 'no-cache')
  const ruta = await env.app.inject({ url: '/mensajes/12' })
  assert.equal(ruta.statusCode, 200)
  assert.match(ruta.body, /<title>Panel/) // ruta de la SPA
  assert.equal(ruta.headers['cache-control'], 'no-cache')
  const faltante = await env.app.inject({ url: '/assets/otro-compilado.js' })
  assert.equal(faltante.statusCode, 404)
  assert.equal(faltante.json().code, 'not_found') // un activo con hash de otra compilación no se confunde con una página
  const api404 = await env.app.inject({ url: '/api/no-existe' })
  assert.equal(api404.statusCode, 404)
  assert.equal(api404.headers['content-type'], 'application/json; charset=utf-8')
  assert.equal(api404.json().code, 'not_found')
  assert.equal((await env.app.inject({ method: 'POST', url: '/api/no-existe' })).statusCode, 404)
  assert.equal((await env.app.inject({ method: 'POST', url: '/cualquier-cosa' })).statusCode, 404) // sólo GET cae en la SPA
  // La CSP del panel: sólo el mismo origen.
  assert.match(raiz.headers['content-security-policy'], /connect-src 'self'/)
  assert.match(raiz.headers['content-security-policy'], /img-src 'self' blob: data:/)
  assert.match(raiz.headers['content-security-policy'], /frame-ancestors 'none'/)
  await env.close()
})

test('sin panel compilado la API arranca igual y la raíz responde 404 JSON', async () => {
  const env = await makeEnv()
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
  const env = await equipo()
  const r = await env.api('POST', '/messages/1/replies', env.c.ana, {})
  assert.equal(r.statusCode, 400)
  assert.deepEqual(r.json(), { code: 'validation', message: 'Falta el campo «body».' })
  const r2 = await env.api('GET', '/messages/abc', env.c.ana)
  assert.equal(r2.statusCode, 400)
  assert.equal(r2.json().code, 'validation')
  const r3 = await env.api('PATCH', '/members/me', env.c.ana, { nombre: 'x' })
  assert.match(r3.json().message, /no existe/)
  assert.equal((await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: '{roto', headers: { 'content-type': 'application/json' } })).json().code, 'bad_request')
  await env.close()
})

test('el panel no recibe columnas internas: el hash de contraseña y la ficha nunca salen', async () => {
  const env = await equipo()
  const cuerpos = [
    (await env.api('GET', '/me', env.c.ana)).body,
    (await env.api('GET', '/members', env.c.ana)).body,
    (await env.api('GET', '/areas', env.c.ana)).body
  ].join('')
  assert.ok(!/argon2|password_hash|token/.test(cuerpos))
  await env.close()
})

// ---------------------------------------------------------------- configuración de proveedores
test('Configuración de proveedores: el editor la lee y la cambia; un proveedor inválido se rechaza al configurarlo', async () => {
  const intentos = []
  const env = await equipo({ modules: {
    getProviders: () => ({ describe: () => [{ slot: 'text', provider: 'anthropic', model: 'claude-haiku-5-5', available: false, reason: 'Falta ANTHROPIC_API_KEY' }] }),
    buildProviders: (o) => { intentos.push(o); if (o.text?.provider === 'inexistente') throw new Error('Proveedor de texto desconocido «inexistente» en TEXT_PROVIDER'); return {} }
  } })
  assert.equal((await env.api('GET', '/settings/providers', env.c.ana)).statusCode, 403)
  const inicial = (await env.api('GET', '/settings/providers', env.c.ed)).json()
  assert.equal(inicial.analyzer, 'api')
  assert.deepEqual(inicial.items.map((i) => i.slot), ['text', 'vision', 'speech'])
  assert.equal(inicial.items[0].provider, 'anthropic')
  assert.equal(inicial.items[0].available, false)
  assert.equal(inicial.items[0].reason, 'Falta ANTHROPIC_API_KEY')
  assert.ok(!JSON.stringify(inicial).includes('API_KEY=')) // nunca una llave

  const malo = await env.api('PATCH', '/settings/providers', env.c.ed, { slot: 'text', provider: 'inexistente', model: 'x' })
  assert.equal(malo.statusCode, 422)
  assert.equal(malo.json().code, 'provider_invalid')
  assert.equal((await env.api('GET', '/settings/providers', env.c.ed)).json().items[0].provider, 'anthropic') // no se guardó

  const ok = await env.api('PATCH', '/settings/providers', env.c.ed, { slot: 'text', provider: 'deepseek', model: 'deepseek-flash' })
  assert.equal(ok.statusCode, 200)
  assert.deepEqual(intentos.at(-1).text, { provider: 'deepseek', model: 'deepseek-flash' })
  const cambio = await env.api('PATCH', '/settings/providers', env.c.ed, { analyzer: 'harness' })
  assert.equal(cambio.json().analyzer, 'harness')
  assert.equal((await env.api('PATCH', '/settings/providers', env.c.ed, { slot: 'text', api_key: 'x' })).statusCode, 400) // la llave no se acepta
  assert.equal((await env.api('PATCH', '/settings/providers', env.c.ed, { slot: 'otra', provider: 'x' })).statusCode, 400)
  assert.equal((await env.api('PATCH', '/settings/providers', env.c.ed, { analyzer: 'otro' })).statusCode, 400)
  await env.close()
})

test('loadModules arma los proveedores con lo guardado en Configuración sobre el entorno', async () => {
  const env = await equipo()
  const { loadModules } = await import('../domain/modules.js')
  const { setProviderOverrides } = await import('../domain/settings.js')
  const modulos = await loadModules(env.config, { db: env.db, env: { TEXT_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-prueba', TEXT_MODEL: 'claude-haiku-5-5' } })
  assert.equal(modulos.getProviders().text.name, 'anthropic')
  assert.equal(modulos.getAnalyzer(), 'api')
  setProviderOverrides(env.db, { analyzer: 'harness', text: { provider: 'deepseek', model: 'deepseek-flash' } })
  // Sin llave de DeepSeek el proveedor queda «no disponible» y lo dice, sin lanzar.
  const nuevo = modulos.getProviders()
  assert.equal(nuevo.text.unavailable, 'Falta DEEPSEEK_API_KEY')
  assert.equal(modulos.getAnalyzer(), 'harness')
  assert.throws(() => modulos.buildProviders({ text: { provider: 'inexistente' } }), /desconocido/)
  await env.close()
})
