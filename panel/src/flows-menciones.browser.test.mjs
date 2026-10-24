// Mentions in a reply (UD-277): «@» opens the list of members but the one who writes, it filters, moves with the keyboard, picks with Enter and shows the
// token in the field; sending carries the ids picked; the thread draws the token highlighted and the mentioned member joins the recipients.
// Real browser against dev-server.mjs serving panel/dist: `PANEL_FLOWS_PORT=… node --test src/flows-menciones.browser.test.mjs`.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_PORT ?? 8812), { stepMs: 80 })
  origin = panel.origin
})
beforeEach(async () => {
  await panel.control.reset()
})
after(async () => {
  await panel?.stop()
})

const options = (page) => page.getByRole('option').locator('[data-mention-name]').allInnerTexts()

describe('mentioning a member in a reply', () => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    test(`«@» lists the others, filters, picks with the keyboard, and the thread shows the token highlighted at ${viewport.width} px`, async () => {
      const { done_id: id } = await panel.control.execution()
      const context = await panel.browser.newContext({ viewport, locale: 'es-CL', colorScheme: 'light' })
      const page = await context.newPage()
      try {
        await login(page, origin, 'ana')
        await page.goto(`${origin}/messages/${id}`)
        await page.locator('main h1').waitFor()
        await settled(page)
        const field = page.locator('#reply-field')
        await field.click()
        await field.pressSequentially('Mira esto @')
        await page.getByRole('listbox').waitFor()
        const all = await options(page)
        assert.ok(all.includes('Claude') && all.includes('Bruno Prueba'), all.join(','))
        assert.ok(!all.includes('Ana Prueba'), 'not the person who writes')
        await field.pressSequentially('cla')
        assert.deepEqual(await options(page), ['Claude'])
        await page.keyboard.press('Escape')
        await page.getByRole('listbox').waitFor({ state: 'detached' })
        await field.press('Backspace')
        await field.press('Backspace')
        await field.press('Backspace') // «@» again: the list opens once more
        await page.getByRole('listbox').waitFor()
        await field.pressSequentially('cla')
        await page.keyboard.press('Enter')
        await page.getByRole('listbox').waitFor({ state: 'detached' })
        assert.equal(await field.inputValue(), 'Mira esto @Claude ')
        await field.pressSequentially('y dime qué recomiendas')
        await page.getByRole('button', { name: 'Responder', exact: true }).click()
        const mark = page.locator('[data-mention]').first()
        await mark.waitFor()
        assert.equal(await mark.innerText(), '@Claude')
        const detail = await (await page.request.get(`${origin}/api/messages/${id}`)).json()
        assert.deepEqual(detail.replies.at(-1).mentions, ['u-claude'])
        assert.equal(detail.assignee_ids.includes('u-claude'), true)
      } finally {
        await context.close()
      }
    })
  }

  test('a name written by hand, without picking it, mentions nobody', async () => {
    const { done_id: id } = await panel.control.execution()
    const context = await panel.browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-CL' })
    const page = await context.newPage()
    try {
      await login(page, origin, 'ana')
      await page.goto(`${origin}/messages/${id}`)
      await page.locator('main h1').waitFor()
      await settled(page)
      await page.locator('#reply-field').fill('@Claude escrito a mano')
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'Responder', exact: true }).click()
      await page.getByText('Respuesta enviada').waitFor()
      const detail = await (await page.request.get(`${origin}/api/messages/${id}`)).json()
      assert.deepEqual(detail.replies.at(-1).mentions, [])
      assert.equal(await page.locator('[data-mention]').count(), 0)
    } finally {
      await context.close()
    }
  })
})
