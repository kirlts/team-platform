// UD-262: «Ejecuciones» in the Cola of Configuración: folded, it loads the figures of the history when it opens.
// Against dev-server.mjs: `npm run test:flows`.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

process.env.PANEL_DEV_AUTO_PUBLISH = '0'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_EJECUCIONES_PORT ?? 8742), { stepMs: 40 })
  origin = panel.origin
})
beforeEach(async () => {
  await panel.control.reset()
})
after(async () => {
  await panel?.stop()
})

describe('History of executions in the Cola (UD-262)', () => {
  test('it is folded, opens with the figures of the summary and changes with the period', async () => {
    const context = await panel.browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-CL', colorScheme: 'light' })
    const page = await context.newPage()
    try {
      await login(page, origin, 'ana')
      await page.goto(`${origin}/settings`)
      await settled(page)
      const block = page.locator('[data-execution-runs]')
      await block.waitFor()
      const toggle = block.getByRole('button', { name: 'Ejecuciones' })
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
      assert.equal(await block.locator('[data-runs-figure]').count(), 0, 'nothing is asked or drawn while it is folded')
      await toggle.click()
      const figure = (name) => block.locator(`[data-runs-figure="${name}"]`)
      await figure('Costo medio').waitFor()
      assert.equal(await figure('Ejecuciones').innerText(), '5')
      assert.equal(await figure('Con error').innerText(), '1')
      assert.equal(await figure('Costo medio').innerText(), 'US$ 1,62')
      assert.equal(await figure('Entrega').innerText(), '50 %')
      assert.equal(await figure('Resueltas').innerText(), '20 %')
      assert.deepEqual(await block.locator('[data-runs-phase]').evaluateAll((els) => els.map((e) => e.getAttribute('data-runs-phase'))), ['queue_wait_ms', 'first_reply_ms', 'final_reply_ms', 'total_ms', 'create_ms', 'run_ms', 'destroy_ms', 'tools_ms', 'delivery_ms'], 'a phase nobody reported has no row')
      assert.match(await block.locator('[data-runs-phase="total_ms"]').innerText(), /19 min 40 s\s+18 min 30 s\s+23 min 0 s/)
      assert.match(await block.locator('[data-runs-slow]').first().innerText(), /Orden: npm test\s+1 min 34 s/)
      await block.getByRole('combobox', { name: 'Período' }).selectOption({ label: 'Todo' })
      await figure('Costo medio').waitFor()
      await toggle.click()
      assert.equal(await block.locator('[data-runs-figure]').count(), 0)
    } finally {
      await context.close()
    }
  })
})
