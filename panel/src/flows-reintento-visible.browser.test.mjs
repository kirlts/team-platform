// UD-290: «Reintentar» answers on click. The notice of the failed session is replaced in place by «Reintentando» before the server answers, and comes
// back with the reason and the button if the server rejects the retry.
// Real browser against dev-server.mjs serving panel/dist: `PANEL_FLOWS_PORT=… node --test src/flows-reintento-visible.browser.test.mjs`.
import assert from 'node:assert'
import { mkdirSync } from 'node:fs'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

let panel
let origin = ''
const SHOTS = process.env.REINTENTO_CAPTURAS

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_PORT ?? 8821), { stepMs: 80 })
  origin = panel.origin
  if (SHOTS) mkdirSync(SHOTS, { recursive: true })
})
beforeEach(async () => {
  await panel.control.reset()
})
after(async () => {
  await panel?.stop()
})

const NOTICE = 'Claude no pudo responder: se acabó el tiempo.'

/** Opens a message whose last reply is the notice of a failed session, as the server draws it when «Reintentar» is possible. */
async function openFailed(page) {
  const list = await (await page.request.get(`${origin}/api/messages?q=${encodeURIComponent('Confirmar el formato')}`)).json()
  const id = list.items[0].id
  await page.route(`**/api/messages/${id}`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    try {
      const res = await route.fetch()
      const body = await res.json()
      const agent = body.replies[0]?.author_id ?? body.author_id
      body.replies.push({ id: '9001', message_id: id, author_id: agent, body: NOTICE, kind: 'answer', created_at: new Date().toISOString(), retryable: true, replaced_by_job_id: null, retrying: false, attachments: [], mentions: [] })
      await route.fulfill({ response: res, json: body })
    } catch {
      // the page closed with the request in flight: nothing is left to answer
    }
  })
  await page.goto(`${origin}/messages/${id}`)
  await page.locator('main h1').waitFor()
  await page.getByTestId('retry-execute').waitFor()
  await settled(page)
  return id
}

async function session(viewport) {
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL', colorScheme: 'light' })
  const page = await context.newPage()
  await login(page, origin, 'ana')
  return { page, context }
}

describe('Reintentar responde en el clic (UD-290)', () => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    test(`the notice is replaced by «Reintentando» before the server answers at ${viewport.width} px`, async () => {
      const { page, context } = await session(viewport)
      try {
        let release
        const gate = new Promise((resolve) => { release = resolve })
        let answered = false
        await page.route('**/api/messages/*/replies/9001/retry', async (route) => {
          await gate
          answered = true
          await route.fulfill({ status: 202, json: { job_id: '7' } })
        })
        const id = await openFailed(page)
        await page.getByText(NOTICE).first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
        assert.equal(await page.getByText(NOTICE).count(), 1)
        await page.getByTestId('retry-execute').click()
        await page.getByTestId('retrying').waitFor()
        assert.equal(answered, false, 'the server has not answered yet')
        assert.equal(await page.getByText(NOTICE).count(), 0, 'the error notice is gone')
        assert.equal(await page.getByTestId('retry-execute').count(), 0, 'and so is the button')
        assert.ok((await page.getByTestId('retrying').innerText()).includes('Reintentando'))
        await page.getByRole('progressbar', { name: 'Reintentando' }).first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
        assert.equal(await page.getByRole('progressbar', { name: 'Reintentando' }).count(), 1)
        await settled(page)
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/reintentando-${viewport.width}.png` })
        release()
        await page.waitForResponse((r) => r.url().includes('/retry'))
        await page.getByTestId('retrying').first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
        assert.equal(await page.getByTestId('retrying').count(), 1, 'with the job queued it stays «Reintentando»')
        assert.ok(id)
      } finally {
        await context.close()
      }
    })

    test(`if the server rejects, the notice comes back with the reason and the button at ${viewport.width} px`, async () => {
      const { page, context } = await session(viewport)
      try {
        let release
        const gate = new Promise((resolve) => { release = resolve })
        await page.route('**/api/messages/*/replies/9001/retry', async (route) => {
          await gate
          await route.fulfill({ status: 409, json: { code: 'retry_stale', message: 'Ya hay un intento posterior de este trabajo.' } })
        })
        await openFailed(page)
        await page.getByTestId('retry-execute').click()
        await page.getByTestId('retrying').waitFor()
        assert.equal(await page.getByText(NOTICE).count(), 0)
        release()
        await page.getByRole('alert').waitFor()
        await page.getByText(NOTICE).first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
        assert.equal(await page.getByText(NOTICE).count(), 1, 'vuelve el aviso')
        await page.getByTestId('retry-execute').first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
        assert.equal(await page.getByTestId('retry-execute').count(), 1, 'and the button')
        assert.equal(await page.getByTestId('retrying').count(), 0)
        await settled(page)
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/rechazado-${viewport.width}.png` })
      } finally {
        await context.close()
      }
    })
  }
})
