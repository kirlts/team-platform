// Replying by voice and editing a reply (UD-278): an audio sent in a reply shows its transcript under it (folded when long); a reply with only an audio and a
// mention is sent; the author adds and takes off files of their reply and adds a mention afterwards.
// Real browser against dev-server.mjs serving panel/dist: `PANEL_FLOWS_PORT=… node --test src/flows-respuestas-voz.browser.test.mjs`.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_PORT ?? 8813), { stepMs: 80 })
  origin = panel.origin
})
beforeEach(async () => {
  await panel.control.reset()
})
after(async () => {
  await panel?.stop()
})

const AUDIO = { name: 'nota.webm', mimeType: 'audio/webm', buffer: Buffer.from('audio-de-prueba') }
const PHOTO = { name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]) }

async function open(viewport, msgId) {
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL', colorScheme: 'light' })
  const page = await context.newPage()
  await login(page, origin, 'ana')
  await page.goto(`${origin}/messages/${msgId}`)
  await page.locator('main h1').waitFor()
  await settled(page)
  return { context, page }
}

describe('replying by voice', () => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    test(`an audio with a mention and no text beyond the token is sent, and its transcript shows under it at ${viewport.width} px`, async () => {
      const { done_id: id } = await panel.control.execution()
      const { context, page } = await open(viewport, id)
      try {
        const field = page.locator('#reply-field')
        await field.click()
        await field.pressSequentially('@cla')
        await page.keyboard.press('Enter')
        await page.locator('input[type=file]').first().setInputFiles(AUDIO)
        await page.getByRole('button', { name: 'Responder', exact: true }).click()
        const transcript = page.getByTestId('reply-transcript')
        await transcript.waitFor()
        assert.match(await transcript.innerText(), /Hola, te dejo este audio/)
        const detail = await (await page.request.get(`${origin}/api/messages/${id}`)).json()
        assert.deepEqual(detail.replies.at(-1).mentions, ['u-claude'])
        assert.equal(detail.replies.at(-1).attachments[0].kind, 'audio')
        // A long transcript reads as its first lines and opens whole.
        const more = transcript.getByRole('button')
        if (await more.count()) {
          assert.equal(await more.innerText(), 'Ver más')
          await more.click()
          assert.equal(await more.innerText(), 'Ver menos')
          assert.match(await transcript.innerText(), /qué recomiendas/)
        } else {
          assert.match(await transcript.innerText(), /qué recomiendas/)
        }
      } finally {
        await context.close()
      }
    })
  }

  test('the audio alone, with no text and no mention, is sent too', async () => {
    const { done_id: id } = await panel.control.execution()
    const { context, page } = await open({ width: 1440, height: 900 }, id)
    try {
      await page.locator('input[type=file]').first().setInputFiles(AUDIO)
      const send = page.getByRole('button', { name: 'Responder', exact: true })
      assert.equal(await send.isDisabled(), false)
      await send.click()
      await page.getByTestId('reply-transcript').waitFor()
    } finally {
      await context.close()
    }
  })

  test('the author takes a file off their reply, adds another and adds a mention afterwards', async () => {
    const { done_id: id } = await panel.control.execution()
    const { context, page } = await open({ width: 1440, height: 900 }, id)
    try {
      await page.locator('#reply-field').fill('Con adjunto')
      await page.locator('input[type=file]').first().setInputFiles(PHOTO)
      await page.getByRole('button', { name: 'Responder', exact: true }).click()
      const tools = page.getByTestId('reply-tools')
      await tools.waitFor()
      await tools.getByTestId('reply-add-files').setInputFiles(AUDIO)
      await page.getByTestId('reply-transcript').waitFor()
      await tools.getByRole('button', { name: 'Quitar foto.png' }).click()
      await tools.getByRole('button', { name: 'Quitar foto.png' }).waitFor({ state: 'detached' })
      await tools.getByRole('button', { name: 'Mencionar a un miembro' }).click()
      await page.getByRole('menuitemcheckbox', { name: 'Claude' }).click()
      await page.locator('[data-mention]').first().waitFor()
      const detail = await (await page.request.get(`${origin}/api/messages/${id}`)).json()
      const last = detail.replies.at(-1)
      assert.deepEqual(last.attachments.map((a) => a.name), ['nota.webm'])
      assert.deepEqual(last.mentions, ['u-claude'])
      assert.match(last.body, /^Con adjunto @Claude$/)
      assert.equal(detail.assignee_ids.includes('u-claude'), true)
    } finally {
      await context.close()
    }
  })
})
