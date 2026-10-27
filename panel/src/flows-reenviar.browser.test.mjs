// Forwarding a message (UD-272): «Reenviar» opens a window of the kit (never a side panel) with the member and the required reason; sending without them says what
// is missing under each field; once sent, the thread shows the forward as a notice («Reenviado a …») with the reason under it, and the message has one more recipient.
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
    test(`the window asks for member and reason, says what is missing under its field after trying, and the thread shows the notice at ${viewport.width} px`, async () => {
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
        await dialog.getByText('Reenviar mensaje').first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
        assert.equal(await dialog.getByText('Reenviar mensaje').count(), 1)
        const submit = page.getByTestId('forward-submit')
        // Nothing is said to be missing until sending is tried, and then it is said under its own field.
        assert.equal(await dialog.getByRole('alert').count(), 0)
        await submit.click()
        assert.equal(await page.getByTestId('forward-member-error').innerText(), 'Falta el miembro')
        assert.equal(await page.getByTestId('forward-comment-error').innerText(), 'Falta el motivo')
        // Cancelar and Reenviar share one row, Reenviar last, at 44 px on a phone.
        const cancel = await dialog.getByRole('button', { name: 'Cancelar' }).boundingBox()
        const send = await submit.boundingBox()
        assert.ok(Math.abs(cancel.y - send.y) < 2 && cancel.x < send.x, 'the two buttons share a row')
        if (viewport.width < 768) assert.ok(cancel.height >= 44 && send.height >= 44, 'targets of 44 px')
        const names = await page.getByTestId('forward-member').locator('option').allInnerTexts()
        assert.ok(names.includes('Claude') && names.includes('Bruno Prueba'), names.join(','))
        assert.ok(!names.includes('Ana Prueba'), 'not the person who forwards')
        await page.getByTestId('forward-member').selectOption({ label: 'Claude' })
        assert.equal(await page.getByTestId('forward-member-error').count(), 0)
        assert.equal(await page.getByTestId('forward-comment-error').innerText(), 'Falta el motivo')
        await page.getByTestId('forward-comment').fill('Investiga por qué falla y dime qué recomiendas.')
        assert.equal(await dialog.getByRole('alert').count(), 0)
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

  // The refusal of a forward with no reason is checked once, on the real server: test M4 of the e2e contract suite.
})
