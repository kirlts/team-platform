// GET /attachments/:id and GET /replies/attachments/:id: `?download=1` asks for a download with the original name,
// without it a PDF is shown inline; the Content-Type is the stored one, never application/octet-stream for a known file.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addMember, login, makeEnv, multipart, postInput, until } from '../testing/helpers.js'

const NAME = 'Subir fotos clínicas desde el teléfono.pdf'
const ENCODED = "UTF-8''Subir%20fotos%20cl%C3%ADnicas%20desde%20el%20tel%C3%A9fono.pdf"
const PDF = { field: 'files', name: NAME, type: 'application/pdf', content: '%PDF-1.4 contenido' }

test('a PDF of a message and one of a reply: inline by default, attachment with ?download=1, real type, accented name', async () => {
  const env = await makeEnv({ worker: true, config: { identity: { login: { ipMax: 1000 } } } })
  await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' })
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  const ana = await login(env, 'ana@x.org')
  const ed = await login(env, 'ed@x.org')
  const api = (method, url, cookie, payload) => env.app.inject({ method, url: `/api${url}`, headers: { cookie, 'x-team-request': 'panel' }, payload })

  const { input_id: id } = (await postInput(env, ana, { text: 'algo' }, [PDF])).json()
  const view = await until(async () => {
    const v = (await api('GET', `/inputs/${id}`, ana)).json()
    return v.status === 'proposed' ? v : null
  })
  const pdf = view.attachments[0]
  const published = await api('POST', `/inputs/${id}/publish`, ana, { messages: [{ ...view.proposal.messages[0], attachment_ids: [pdf.id] }] })
  const messageId = published.json().message_ids[0]

  const ask = (url, cookie) => env.app.inject({ url: `/api${url}`, headers: { cookie } })
  const inline = await ask(`/attachments/${pdf.id}`, ed)
  assert.equal(inline.statusCode, 200)
  assert.equal(inline.headers['content-type'], 'application/pdf')
  assert.equal(inline.headers['content-disposition'], `inline; filename*=${ENCODED}`)
  const download = await ask(`/attachments/${pdf.id}?download=1`, ed)
  assert.equal(download.headers['content-type'], 'application/pdf')
  assert.equal(download.headers['content-disposition'], `attachment; filename*=${ENCODED}`)
  assert.equal(download.body, PDF.content)

  const { payload, headers } = await multipart({ body: 'Aquí va el manual', kind: 'clarification' }, [PDF])
  const replied = await env.app.inject({ method: 'POST', url: `/api/messages/${messageId}/replies`, payload, headers: { ...headers, cookie: ed, 'x-team-request': 'panel' } })
  assert.equal(replied.statusCode, 201, replied.body)
  const file = replied.json().replies[0].attachments[0]
  const replyInline = await ask(`/replies/attachments/${file.id}`, ana)
  assert.equal(replyInline.headers['content-type'], 'application/pdf')
  assert.equal(replyInline.headers['content-disposition'], `inline; filename*=${ENCODED}`)
  const replyDownload = await ask(`/replies/attachments/${file.id}?download=1`, ana)
  assert.equal(replyDownload.headers['content-type'], 'application/pdf')
  assert.equal(replyDownload.headers['content-disposition'], `attachment; filename*=${ENCODED}`)
  assert.equal(replyDownload.body, PDF.content)
  assert.equal((await env.app.inject({ url: `/api/replies/attachments/${file.id}?download=1` })).statusCode, 401)
  await env.close()
})
