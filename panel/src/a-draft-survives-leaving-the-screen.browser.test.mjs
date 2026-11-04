// TP-04 (soft-locks 2026-11-04): what is written in the bar of Inicio and in the reply of a message is still there after going to another screen and
// coming back, after Atrás and after a reload. Every check is a prohibition: the text, «Enviar como» and «Para» must not be lost.
// `PANEL_FLOWS_BORRADOR_PORT=… node --test src/a-draft-survives-leaving-the-screen.browser.test.mjs` against dev-server.mjs serving panel/dist.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

process.env.PANEL_DEV_AUTO_PUBLISH = '0'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_BORRADOR_PORT ?? 9210), { stepMs: 40 })
  origin = panel.origin
})
beforeEach(async () => {
  await panel.control.reset()
})
after(async () => {
  await panel?.stop()
})

async function session(who = 'ana') {
  const context = await panel.browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-CL', colorScheme: 'light' })
  const page = await context.newPage()
  await login(page, origin, who)
  await settled(page)
  return { page, context }
}

/** Goes to another screen by the link of the sidebar, as a person does, and waits for it. */
async function leaveBySidebar(page) {
  await page.locator('[data-testid="sidebar"] a[href$="/team"]').click()
  await page.waitForURL(/\/team$/)
  await page.locator('main#main').waitFor()
}

describe('a draft survives leaving the screen (TP-04)', () => {
  test('the text of the bar of Inicio is there after a link of the sidebar, Atrás and a reload', async () => {
    const { page, context } = await session()
    try {
      const bar = page.getByTestId('compose-text')
      await bar.fill('Borrador que no se debe perder')
      await leaveBySidebar(page)
      await page.getByTestId('brand-link').click()
      assert.equal(await page.getByTestId('compose-text').inputValue(), 'Borrador que no se debe perder', 'after the sidebar')
      await leaveBySidebar(page)
      await page.goBack()
      await page.getByTestId('compose-text').waitFor()
      assert.equal(await page.getByTestId('compose-text').inputValue(), 'Borrador que no se debe perder', 'after Atrás')
      await page.reload()
      await page.getByTestId('compose-text').waitFor()
      assert.equal(await page.getByTestId('compose-text').inputValue(), 'Borrador que no se debe perder', 'after a reload')
    } finally {
      await context.close()
    }
  })

  test('the text of a reply is there after leaving the message and coming back, and only in that message', async () => {
    const { page, context } = await session()
    try {
      const listed = await page.context().request.get(`${origin}/api/messages`)
      const ids = (await listed.json()).items.map((m) => m.id)
      assert.ok(ids.length >= 2, 'the example server has messages')
      await page.goto(`${origin}/messages/${ids[0]}`)
      await page.locator('#reply-field').fill('Respuesta a medias')
      await leaveBySidebar(page)
      await page.goto(`${origin}/messages/${ids[0]}`)
      await page.locator('#reply-field').waitFor()
      assert.equal(await page.locator('#reply-field').inputValue(), 'Respuesta a medias', 'in the message it was written')
      await page.goto(`${origin}/messages/${ids[1]}`)
      await page.locator('#reply-field').waitFor()
      assert.equal(await page.locator('#reply-field').inputValue(), '', 'not in another message')
    } finally {
      await context.close()
    }
  })

  test('sending empties the draft: it does not come back', async () => {
    const { page, context } = await session()
    try {
      await page.getByTestId('compose-text').fill('Se envía y desaparece')
      await page.getByTestId('compose-send').click()
      await page.getByTestId('compose-text').waitFor()
      assert.equal(await page.getByTestId('compose-text').inputValue(), '')
      await page.reload()
      await page.getByTestId('compose-text').waitFor()
      assert.equal(await page.getByTestId('compose-text').inputValue(), '', 'after a reload')
    } finally {
      await context.close()
    }
  })
})
