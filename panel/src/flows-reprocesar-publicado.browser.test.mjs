// UD-258 (H-3729) seen from the panel: the Editor analyzes a published send again with one click on «Reprocesar», visible in the
// drawer of Inicio where the send is seen. No window asks first (UD-253); the notice says how many messages were set aside and leads
// to «Borrados», where Restaurar brings them back. A member has no such control. Against dev-server.mjs serving panel/dist with
// auto-publication on: `npm run test:flows`. Every test can fail if the defect it names comes back.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

process.env.PANEL_DEV_AUTO_PUBLISH = '1'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_REPROCESAR_PORT ?? 8724), { stepMs: 80 })
  origin = panel.origin
})

beforeEach(async () => {
  await panel.control.reset()
})

after(async () => {
  await panel?.stop()
})

async function session(who) {
  const context = await panel.browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-CL', colorScheme: 'light' })
  const page = await context.newPage()
  await login(page, origin, who)
  await page.locator('main').first().waitFor()
  return { page, context }
}

const send = async (page, text) => {
  await page.getByLabel('Nuevo mensaje', { exact: true }).last().fill(text)
  await page.getByRole('button', { name: 'Enviar' }).first().click()
}
const api = async (page, path) => (await page.request.fetch(`${origin}/api${path}`, { headers: { 'x-team-request': 'panel' } })).json()

describe('reprocessing a published send (UD-258)', () => {
  test('the Editor presses «Reprocesar»: no window, «1 mensaje apartado» with a link to Borrados, the send is published again and Restaurar returns the old message', async () => {
    const { page, context } = await session('ana')
    try {
      await send(page, 'El botón de guardar no responde en el móvil.')
      const drawer = page.getByTestId('send-drawer')
      await drawer.getByTestId('published-message').first().waitFor({ timeout: 20000 })
      await settled(page)
      const first = (await api(page, '/messages')).items.map((m) => m.id)
      assert.equal(first.length > 0, true)
      const sendId = (await api(page, '/inputs?mine=1&order=desc')).items[0].id
      const before = (await api(page, `/inputs/${sendId}`)).message_ids

      const button = drawer.getByTestId('reprocess-send')
      assert.equal((await button.innerText()).trim(), 'Reprocesar')
      await button.click()
      const notice = page.locator('[data-notice]')
      await notice.getByText('1 mensaje apartado', { exact: true }).waitFor()
      assert.equal(await page.getByRole('dialog').count(), 0, 'no window opens over the page')
      // The old message is out of the live list at once and the send is analyzed and published again with other messages.
      const live = (await api(page, '/messages')).items.map((m) => m.id)
      assert.equal(live.includes(before[0]), false)
      await drawer.getByTestId('published-message').first().waitFor({ timeout: 20000 })
      const after = (await api(page, `/inputs/${sendId}`)).message_ids
      assert.equal(after.includes(before[0]), false)

      await notice.getByRole('link', { name: 'Borrados' }).click()
      const deleted = page.locator('main article[data-deleted="true"]')
      await deleted.first().waitFor()
      assert.equal(await deleted.count(), 1)
      await deleted.getByRole('button', { name: 'Restaurar' }).click()
      await deleted.first().waitFor({ state: 'detached' })
      assert.equal((await api(page, '/messages')).items.map((m) => m.id).includes(before[0]), true, 'the old message is live again')
    } finally {
      await context.close()
    }
  })

  test('a member sees no «Reprocesar» on their own published send', async () => {
    const { page, context } = await session('bruno')
    try {
      await send(page, 'La exportación a PDF falla con tablas largas.')
      const drawer = page.getByTestId('send-drawer')
      await drawer.getByTestId('published-message').first().waitFor({ timeout: 20000 })
      await settled(page)
      assert.equal(await drawer.getByTestId('delete-send').count(), 1, 'the drawer is the published one')
      assert.equal(await drawer.getByTestId('reprocess-send').count(), 0)
    } finally {
      await context.close()
    }
  })
})
