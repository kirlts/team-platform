// UD-262: the «Tiempos» block on the sheet of a message an agent worked (folded by default; first reply, final reply, total, phases,
// slowest tools and the cascade) and the executions running now in the Cola. Against dev-server.mjs: `npm run test:flows`.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

process.env.PANEL_DEV_AUTO_PUBLISH = '0'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_TIEMPOS_PORT ?? 8741), { stepMs: 40 })
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

describe('Timing of a message (UD-262)', () => {
  test('the block is folded, opens with the figures and the cascade, which holds the slowest tools', async () => {
    const { done_id: doneId } = await panel.control.execution()
    const { page, context } = await session(`/messages/${doneId}`)
    try {
      const block = page // «Detalles» is the one fold that holds the times (UD-309)
      const toggle = block.getByRole('button', { name: 'Detalles' })
      await toggle.waitFor()
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
      assert.equal(await block.locator('[data-timing-figure]').count(), 0, 'nothing is asked or drawn while it is folded')
      await toggle.click()
      const figure = (name) => block.locator(`[data-timing-figure="${name}"]`)
      await figure('Primera respuesta').waitFor()
      assert.equal(await figure('Primera respuesta').innerText(), '41 s')
      assert.equal(await figure('Respuesta final').innerText(), '22 min 0 s')
      assert.equal(await figure('Total').innerText(), '23 min 0 s')
      assert.equal(await figure('Tiempo de espera').innerText(), '15 min 20 s')
      assert.deepEqual(await block.locator('[data-timing-phase]').evaluateAll((els) => els.map((e) => e.getAttribute('data-timing-phase'))), ['create', 'run', 'destroy'])
      assert.equal(await block.locator('[data-timing-slow]').count(), 0, 'with the cascade, the slowest tools are in it and not listed twice')
      assert.match(await block.locator('[data-span]', { hasText: 'Orden: npm test' }).first().innerText(), /Orden: npm test\s+1 min 34 s/)
      assert.ok(await block.locator('[data-span="execute.machine.run"]').count(), 'the cascade reuses the span rows')
      assert.ok(await block.locator('[data-span="execute.subagent"]').count())
    } finally {
      await context.close()
    }
  })

  test('a message nobody worked has no block', async () => {
    await panel.control.execution()
    const { page, context } = await session('/messages')
    try {
      const other = await page.evaluate(async () => (await (await fetch('/api/messages?limit=50')).json()).items.find((m) => !m.assignee_ids.includes('u-claude')).id)
      await page.goto(`${origin}/messages/${other}`)
      await page.locator('main#main h1, main#main h2').first().waitFor()
      await settled(page)
      assert.equal(await page.locator('[data-timing]').count(), 0)
    } finally {
      await context.close()
    }
  })

  test('the Cola lists the execution that is running with its step and time', async () => {
    const { live_id: liveId } = await panel.control.execution()
    const { page, context } = await session('/settings')
    try {
      const row = page.locator('[data-running-execution]')
      await row.waitFor()
      assert.equal(await row.locator('[data-execution-phase]').innerText(), 'Sesión')
      assert.match(await row.locator('[data-execution-elapsed]').innerText(), /^\d+ min \d+ s$|^\d+ s$/)
      assert.equal(await row.getByRole('link').getAttribute('href'), `/messages/${liveId}`)
    } finally {
      await context.close()
    }
  })
})
