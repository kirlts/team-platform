// UD-263: the delivery is a job of its own. While it runs, the Cola lists it with its phase and the sheet of the message shows the same phase
// in «Tiempos». Against dev-server.mjs: `npm run test:flows`.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

process.env.PANEL_DEV_AUTO_PUBLISH = '0'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_ENTREGA_PORT ?? 8742), { stepMs: 40 })
  origin = panel.origin
})
beforeEach(async () => {
  await panel.control.reset()
})
after(async () => {
  await panel?.stop()
})

async function session(path) {
  const context = await panel.browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-CL', colorScheme: 'light' })
  const page = await context.newPage()
  await login(page, origin, 'ana')
  await page.goto(`${origin}${path}`)
  await settled(page)
  return { page, context }
}

describe('Delivery of a message (UD-263)', () => {
  test('the Cola lists the delivery that is running with its phase', async () => {
    const { live_id: liveId } = await panel.control.execution({ deliver: true })
    const { page, context } = await session('/settings')
    try {
      const row = page.locator('[data-running-execution]')
      await row.waitFor()
      assert.equal(await row.locator('[data-execution-phase]').innerText(), 'Entrega: despliegue')
      assert.equal(await row.getByRole('link').getAttribute('href'), `/messages/${liveId}`)
    } finally {
      await context.close()
    }
  })

  test('the sheet of the message shows the phase of the delivery in Tiempos', async () => {
    const { live_id: liveId } = await panel.control.execution({ deliver: true })
    const { page, context } = await session(`/messages/${liveId}`)
    try {
      const block = page
      await block.getByRole('button', { name: 'Detalles' }).click()
      const running = block.locator('[data-timing-running]')
      await running.waitFor()
      assert.match(await running.innerText(), /^Entrega: despliegue · 20 s$/)
    } finally {
      await context.close()
    }
  })
})
