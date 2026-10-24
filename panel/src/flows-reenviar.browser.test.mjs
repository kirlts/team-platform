// Forwarding a message (UD-272): «Reenviar» opens a window of the kit (never a side panel) with the member and the required reason; the button stays off and says what
// is missing; once sent, the thread shows the forward as a notice («Reenviado a …») with the reason under it, and the message has one more recipient.
// Real browser against dev-server.mjs serving panel/dist: `PANEL_FLOWS_PORT=… node --test src/flows-reenviar.browser.test.mjs`.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_PORT ?? 8809), { stepMs: 80 })
  origin = panel.origin
})
beforeEach(async () => {
  await panel.control.reset()
})
after(async () => {
  await panel?.stop()
})

describe('forwarding a message', () => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    test(`the window asks for member and reason, keeps the button off saying what is missing, and the thread shows the notice at ${viewport.width} px`, async () => {
      const { done_id: id } = await panel.control.execution()
      const context = await panel.browser.newContext({ viewport, locale: 'es-CL', colorScheme: 'light' })
      const page = await context.newPage()
      try {
        await login(page, origin, 'ana')
        await page.goto(`${origin}/messages/${id}`)
        await page.locator('main h1').waitFor()
        await settled(page)
        await page.getByTestId('forward-open').click()
        const dialog = page.getByRole('dialog')
        await dialog.waitFor()
        assert.equal(await dialog.getByText('Reenviar mensaje').count(), 1)
        const submit = page.getByTestId('forward-submit')
        assert.equal(await submit.isDisabled(), true)
        assert.equal(await dialog.getByRole('status').innerText(), 'Faltan el miembro y el motivo')
        const names = await page.getByTestId('forward-member').locator('option').allInnerTexts()
        assert.ok(names.includes('Claude') && names.includes('Bruno Prueba'), names.join(','))
        assert.ok(!names.includes('Ana Prueba'), 'not the person who forwards')
        await page.getByTestId('forward-member').selectOption({ label: 'Claude' })
        assert.equal(await dialog.getByRole('status').innerText(), 'Falta el motivo')
        assert.equal(await submit.isDisabled(), true)
        await page.getByTestId('forward-comment').fill('Investiga por qué falla y dime qué recomiendas.')
        assert.equal(await submit.isDisabled(), false)
        await submit.click()
        await dialog.waitFor({ state: 'detached' })
        const notice = page.getByTestId('forward-notice')
        await notice.waitFor()
        assert.match(await notice.innerText(), /Reenviado a Claude/)
        assert.match(await notice.innerText(), /por Ana Prueba/)
        assert.match(await notice.innerText(), /Investiga por qué falla y dime qué recomiendas\./)
        const detail = await (await page.request.get(`${origin}/api/messages/${id}`)).json()
        assert.equal(detail.replies.at(-1).kind, 'forward')
        assert.equal(detail.assignee_ids.includes('u-claude'), true)
      } finally {
        await context.close()
      }
    })
  }

  test('an empty reason is refused by the server and says why', async () => {
    const { done_id: id } = await panel.control.execution()
    const context = await panel.browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-CL' })
    const page = await context.newPage()
    try {
      await login(page, origin, 'ana')
      const r = await page.request.post(`${origin}/api/messages/${id}/forward`, { data: { member_id: 'u-claude', comment: '  ' }, headers: { 'x-team-request': 'panel' } })
      assert.equal(r.status(), 400)
      assert.equal((await r.json()).code, 'forward_comment_required')
    } finally {
      await context.close()
    }
  })
})
