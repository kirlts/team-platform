// M6: a message is answered and edited with the same attachments it was created with, the audio of the microphone included. The bar of Inicio takes
// a photo, a video, an audio, a PDF and a link and records with the microphone; the reply form, the edit of the message and the edit of a reply must
// take the same ones (UD-071, UD-279). Martín asked for it on 2026-10-24 18:11.
// Complement (against the development double, so not counted as coverage): panel/src/flows-respuestas-voz.browser.test.mjs, flows-adjuntos-ficha.browser.test.mjs.
import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import { FILES, harness, settled, until } from './harness.mjs'

let h
before(async () => { h = await harness() })

const LINK = 'https://ejemplo.invalid/documento'
const KINDS = ['audio', 'document', 'image', 'link', 'video']
const four = () => [FILES.photo('foto-m6.png'), FILES.video(), FILES.audio(), FILES.pdf()].map((f) => ({ name: f.name, mimeType: f.type, buffer: f.buffer }))
const kindsOf = (items) => items.map((a) => a.kind).sort()

/** Adds a link the way a person does: «Adjuntar», «Enlace», the address, «Agregar». `scope` is the form or bar that holds the clip. */
async function addLink (page, scope) {
  await scope.getByRole('button', { name: 'Adjuntar' }).click()
  await page.getByRole('menuitem', { name: 'Enlace' }).click()
  await page.locator('#compose-link').fill(LINK)
  await page.getByRole('button', { name: 'Agregar', exact: true }).click()
}

/** Records with the fake microphone of the browser for about two seconds. */
async function record (page, scope) {
  await scope.getByRole('button', { name: 'Grabar audio' }).click()
  const status = page.getByRole('status', { name: 'Grabando audio' })
  await status.waitFor({ timeout: 5000 })
  await page.waitForFunction(() => /0?0:0[2-9]|0?0:[1-5]\d/.test(document.querySelector('[role=status][aria-label="Grabando audio"]')?.textContent ?? ''), null, { timeout: 8000 })
  await scope.getByRole('button', { name: 'Detener grabación' }).click()
  await status.waitFor({ state: 'detached', timeout: 5000 })
}

/** The message as the bar of Inicio creates it, with the whole set; returns its id. */
async function created (who, title) {
  const { page, context } = await h.open(who)
  try {
    await page.goto(h.origin)
    const bar = page.locator('[data-compose-box]')
    await page.getByTestId('compose-text').fill(title)
    await page.locator('input[type=file]:not([capture])').first().setInputFiles(four())
    await addLink(page, bar)
    await page.getByTestId('compose-send').click()
    const found = await until(async () => {
      const list = (await h.api(who).get(`/messages?q=${encodeURIComponent(title)}`)).data
      return list.items.length === 1 ? list.items[0] : null
    }, { timeoutMs: 20000, everyMs: 50 })
    const detail = (await h.api(who).get(`/messages/${found.id}`)).data
    assert.deepEqual(kindsOf(detail.attachments), KINDS, `M6: the bar creates the message with photo, video, audio, PDF and link (it kept: ${kindsOf(detail.attachments).join(', ')})`)
    return found.id
  } finally {
    await context.close()
  }
}

// Found by its «Responder» button: while recording, the text field is replaced by the timer.
const replyForm = (page) => page.locator('form', { has: page.getByRole('button', { name: 'Responder', exact: true }) })

describe('M6: replying and editing take the same attachments as creating', () => {
  test('M6: the reply form takes a photo, a video, an audio and a PDF, as the bar does', async () => {
    const id = await created('bruno', h.unique('M6 crear'))
    const { page, context } = await h.open('carla')
    try {
      await page.goto(`${h.origin}/messages/${id}`)
      await page.locator('main h1').waitFor()
      const form = replyForm(page)
      await form.locator('input[type=file]:not([capture])').setInputFiles(four())
      await form.getByRole('textbox').fill('Respuesta con los archivos')
      await form.getByRole('button', { name: 'Responder', exact: true }).click()
      const reply = await until(async () => (await h.api('carla').get(`/messages/${id}`)).data.replies.find((r) => r.body === 'Respuesta con los archivos'), { timeoutMs: 10000, everyMs: 50 })
      assert.deepEqual(kindsOf(reply.attachments ?? []), ['audio', 'document', 'image', 'video'], `M6: the reply keeps the four kinds of file the message was created with (kept: ${kindsOf(reply.attachments ?? []).join(', ')})`)
      // The person sees them in the thread: the photo is drawn and the other three are named in the reply.
      await settled(page)
      const thread = page.locator('section[aria-label="Respuestas"]')
      // The photo can be drawn twice for a moment (the reply as sent and as saved): the first one is the one measured.
      await thread.locator('img[alt="foto-m6.png"]').first().waitFor({ timeout: 8000 })
      assert.ok(await thread.locator('img[alt="foto-m6.png"]').first().evaluate((img) => img.complete && img.naturalWidth > 0), 'M6: the photo of the reply loads')
      const said = await thread.innerText()
      for (const name of ['video.webm', 'audio.wav', 'documento.pdf']) assert.ok(said.includes(name), `M6: the reply names ${name} (it says: ${said.replace(/\n+/g, ' | ')})`)
    } finally {
      await context.close()
    }
  })

  test('M6: a link added in the reply form joins the reply and does not lose what was already attached', async () => {
    const id = await created('bruno', h.unique('M6 enlace'))
    const { page, context } = await h.open('carla')
    try {
      await page.goto(`${h.origin}/messages/${id}`)
      await page.locator('main h1').waitFor()
      const form = replyForm(page)
      await form.locator('input[type=file]:not([capture])').setInputFiles(four())
      await form.getByRole('textbox').fill('Respuesta con enlace')
      await page.evaluate(() => (window.__e2eMark = 'same-document'))
      await addLink(page, form)
      assert.equal(await page.evaluate(() => window.__e2eMark ?? null), 'same-document', 'M6: adding a link in the reply form reloaded the page (the link row is a form inside the reply form, and its «Agregar» submits the outer one)')
      assert.equal(await form.locator('ul[aria-label="Adjuntos"] li').count(), 5, 'M6: the four files and the link are in the draft of the reply after adding the link')
      assert.equal(await form.getByRole('textbox').inputValue(), 'Respuesta con enlace', 'M6: the text written is kept')
      await form.getByRole('button', { name: 'Responder', exact: true }).click()
      const reply = await until(async () => (await h.api('carla').get(`/messages/${id}`)).data.replies.find((r) => r.body === 'Respuesta con enlace'), { timeoutMs: 10000, everyMs: 50 })
      assert.deepEqual(kindsOf(reply.attachments ?? []), KINDS, `M6: the reply keeps the same kinds the message was created with, the link included (kept: ${kindsOf(reply.attachments ?? []).join(', ')})`)
    } finally {
      await context.close()
    }
  })

  test('M6: the sender edits the message and adds a photo, a video, an audio, a PDF and a link', async () => {
    const id = await h.message(h.unique('M6 editar'), { as: 'bruno', files: [FILES.photo('base.png')] })
    const { page, context } = await h.open('bruno')
    try {
      await page.goto(`${h.origin}/messages/${id}`)
      await page.locator('main h1').waitFor()
      await page.getByTestId('detail-files').setInputFiles(four())
      await until(async () => (await h.api('bruno').get(`/messages/${id}`)).data.attachments.length >= 5, { timeoutMs: 10000, everyMs: 50 })
      // A link pasted over the attachments joins the message as it does in the bar.
      await page.locator('[data-gallery]').evaluate((el, link) => {
        const data = new DataTransfer()
        data.setData('text', link)
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
      }, LINK)
      await until(async () => (await h.api('bruno').get(`/messages/${id}`)).data.attachments.length >= 6, { timeoutMs: 10000, everyMs: 50 })
      const detail = (await h.api('bruno').get(`/messages/${id}`)).data
      assert.deepEqual([...new Set(kindsOf(detail.attachments))], KINDS, `M6: the edit takes every kind the creation takes (kept: ${kindsOf(detail.attachments).join(', ')})`)
    } finally {
      await context.close()
    }
  })

  test('M6: the author of a reply edits it and adds a photo, a video, an audio and a PDF', async () => {
    const id = await h.message(h.unique('M6 editar respuesta'), { as: 'carla', recipients: ['bruno'] })
    await h.api('bruno').post(`/messages/${id}/replies`, { body: 'Respuesta que luego se completa', kind: 'answer' })
    const { page, context } = await h.open('bruno')
    try {
      await page.goto(`${h.origin}/messages/${id}`)
      await page.locator('main h1').waitFor()
      await page.getByTestId('reply-add-files').setInputFiles(four())
      const reply = await until(async () => {
        const r = (await h.api('bruno').get(`/messages/${id}`)).data.replies[0]
        return (r.attachments ?? []).length >= 4 ? r : null
      }, { timeoutMs: 10000, everyMs: 50 })
      assert.deepEqual(kindsOf(reply.attachments), ['audio', 'document', 'image', 'video'], 'M6: the edit of a reply takes the same files')
    } finally {
      await context.close()
    }
  })

  test('M6: the bar records with the microphone and the message is created with that audio', async () => {
    const title = h.unique('M6 microfono crear')
    const { page, context } = await h.open('bruno', { permissions: ['microphone'] })
    try {
      await page.goto(h.origin)
      const bar = page.locator('[data-compose-box]')
      await record(page, bar)
      await page.getByTestId('compose-text').fill(title)
      await page.getByTestId('compose-send').click()
      const found = await until(async () => (await h.api('bruno').get(`/messages?q=${encodeURIComponent(title)}`)).data.items[0], { timeoutMs: 20000, everyMs: 50 })
      const detail = (await h.api('bruno').get(`/messages/${found.id}`)).data
      assert.deepEqual(kindsOf(detail.attachments), ['audio'], 'M6: what the microphone recorded is an audio attachment of the message')
    } finally {
      await context.close()
    }
  })

  test('M6: the reply form records with the microphone and the reply keeps that audio', async () => {
    const id = await h.message(h.unique('M6 microfono responder'), { as: 'carla', recipients: ['bruno'] })
    const { page, context } = await h.open('bruno', { permissions: ['microphone'] })
    try {
      await page.goto(`${h.origin}/messages/${id}`)
      await page.locator('main h1').waitFor()
      const form = replyForm(page)
      await record(page, form)
      await form.getByRole('textbox').fill('Respuesta hablada')
      await form.getByRole('button', { name: 'Responder', exact: true }).click()
      const reply = await until(async () => (await h.api('bruno').get(`/messages/${id}`)).data.replies.find((r) => r.body === 'Respuesta hablada'), { timeoutMs: 10000, everyMs: 50 })
      assert.deepEqual(kindsOf(reply.attachments ?? []), ['audio'], 'M6: the reply has the audio the microphone recorded')
      assert.ok((reply.attachments[0].size ?? 0) > 0, 'M6: the recorded audio has content')
    } finally {
      await context.close()
    }
  })

  test('M6: the sender edits the message and records with the microphone: the audio joins the message', async () => {
    const id = await h.message(h.unique('M6 microfono editar'), { as: 'bruno', files: [FILES.photo('base-mic.png')] })
    const { page, context } = await h.open('bruno', { permissions: ['microphone'] })
    try {
      await page.goto(`${h.origin}/messages/${id}`)
      await page.locator('main h1').waitFor()
      const column = page.locator('[data-lane="message-column"]')
      assert.ok(await column.getByRole('button', { name: 'Grabar audio' }).count(), 'M6: editing the message offers no «Grabar audio»: the microphone exists when creating and replying, not when editing')
      await record(page, column)
      const detail = await until(async () => {
        const d = (await h.api('bruno').get(`/messages/${id}`)).data
        return d.attachments.some((a) => a.kind === 'audio') ? d : null
      }, { timeoutMs: 10000, everyMs: 50 })
      assert.ok(detail.attachments.some((a) => a.kind === 'audio' && a.size > 0), 'M6: the audio recorded while editing has no content')
    } finally {
      await context.close()
    }
  })

  test('M6: the author of a reply edits it and records with the microphone: the audio joins the reply', async () => {
    const id = await h.message(h.unique('M6 microfono editar respuesta'), { as: 'carla', recipients: ['bruno'] })
    await h.api('bruno').post(`/messages/${id}/replies`, { body: 'Respuesta que se completa con voz', kind: 'answer' })
    const { page, context } = await h.open('bruno', { permissions: ['microphone'] })
    try {
      await page.goto(`${h.origin}/messages/${id}`)
      await page.locator('main h1').waitFor()
      const mine = page.locator('section[aria-label="Respuestas"] ol.thread > li article', { hasText: 'Respuesta que se completa con voz' })
      assert.ok(await mine.getByRole('button', { name: 'Grabar audio' }).count(), 'M6: editing a reply offers no «Grabar audio»: the microphone exists when creating and replying, not when editing')
      await record(page, mine)
      const reply = await until(async () => {
        const r = (await h.api('bruno').get(`/messages/${id}`)).data.replies[0]
        return (r.attachments ?? []).some((a) => a.kind === 'audio') ? r : null
      }, { timeoutMs: 10000, everyMs: 50 })
      assert.ok(reply.attachments.some((a) => a.kind === 'audio' && a.size > 0), 'M6: the audio recorded while editing the reply has no content')
    } finally {
      await context.close()
    }
  })
})
