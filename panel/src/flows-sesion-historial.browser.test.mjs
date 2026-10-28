// The history of the session in the work panel (plan 1.0.0): each stretch in one line, the unfolding closed until someone opens it, the steps in order with their plain
// words, a screenshot that opens, the state of the delivery behind its own control, and the same history in Detalles › Tiempos once the work ended.
// Against dev-server.mjs: `npm run test:flows`. With SESSION_CAPTURES=<directory> it leaves screenshots (closed and open, light and dark, 1440x900 and 390x844).
import assert from 'node:assert'
import { mkdirSync } from 'node:fs'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

process.env.PANEL_DEV_AUTO_PUBLISH = '0'
const CAPTURES = process.env.SESSION_CAPTURES
if (CAPTURES) mkdirSync(CAPTURES, { recursive: true })

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_SESION_PORT ?? 8940), { stepMs: 40 })
  origin = panel.origin
})
beforeEach(async () => {
  await panel.control.reset()
})
after(async () => {
  await panel?.stop()
})

const SIZES = [
  ['1440x900', { width: 1440, height: 900 }],
  ['390x844', { width: 390, height: 844 }],
]

async function open(path, { viewport = SIZES[0][1], colorScheme = 'light' } = {}) {
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL', colorScheme })
  await context.addInitScript((theme) => { try { localStorage.setItem('team-theme', theme) } catch { /* the browser's own scheme is already the requested one */ } }, colorScheme)
  const page = await context.newPage()
  await login(page, origin, 'ana')
  await page.goto(`${origin}${path}`)
  await page.getByTestId('agent-work').waitFor({ timeout: 10000 })
  await settled(page)
  return { page, context }
}
const shot = (page, name) => (CAPTURES ? page.screenshot({ path: `${CAPTURES}/${name}.png` }) : undefined)
const box = async (locator) => locator.evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })

describe('History of the session', () => {
  test('a stretch is one line and the box measures the same with or without history while it is closed', async () => {
    const heights = []
    for (const steps of [0, 60]) {
      await panel.control.reset()
      const ids = await panel.control.agentWork({ steps })
      const { page, context } = await open(`/messages/${ids.session}`)
      try {
        const panelBox = await box(page.getByTestId('agent-work'))
        heights.push(Math.round(panelBox.h))
        assert.equal(await page.locator('[data-work-panel]').count(), 0)
        assert.equal(await page.locator('[data-lane="session-steps"]').count(), 0)
        assert.equal(await page.locator('[data-work-toggle="session"]').getAttribute('aria-expanded'), 'false')
        // The mark, the name, the bar, the control and the time share a line: their vertical centres are within 3 px.
        const row = page.locator('[data-work-step="session"]')
        const centres = await row.evaluate((li) => [...li.children].map((c) => { const r = c.getBoundingClientRect(); return r.y + r.height / 2 }))
        assert.ok(Math.max(...centres) - Math.min(...centres) < 3, `centres ${centres}`)
        // Nothing loose under the bar: no status line and no bar as wide as the box.
        assert.equal(await page.getByRole('status').count(), 0)
        const bar = await box(page.locator('[data-work-step="session"] [role="progressbar"]'))
        assert.ok(bar.w < panelBox.w - 150, `the bar leaves room for the name, the control and the time: ${bar.w} of ${panelBox.w}`)
        assert.ok(bar.h <= 8, `bar ${bar.h}`)
        // The time column is at the right edge of the box, in every row.
        const times = await page.locator('[data-work-time]').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().right)))
        assert.equal(new Set(times).size, 1, `time right edges ${times}`)
      } finally {
        await context.close()
      }
    }
    assert.equal(heights[0], heights[1], `closed box: ${heights}`)
  })

  for (const [size, viewport] of SIZES) {
    test(`Sesión opens the steps in order, in a lane of its own, at ${size}`, async () => {
      const ids = await panel.control.agentWork({ steps: 60 })
      for (const colorScheme of ['light', 'dark']) {
        const { page, context } = await open(`/messages/${ids.session}`, { viewport, colorScheme })
        try {
          await shot(page, `cerrado-${size}-${colorScheme}`)
          await page.locator('[data-work-toggle="session"]').click()
          const lane = page.locator('[data-lane="session-steps"]')
          await lane.waitFor()
          const items = await lane.locator('li').evaluateAll((els) => els.map((li) => ({ action: li.getAttribute('data-step-action'), text: li.innerText, time: li.querySelector('time')?.getAttribute('datetime'), current: li.hasAttribute('data-step-current') })))
          assert.equal(items.length, 60)
          assert.deepEqual(items.slice(0, 5).map((i) => i.action), ['read', 'search', 'read', 'edit', 'command'])
          assert.match(items[0].text, /Leyó un archivo[\s\S]*Read[\s\S]*Reservas\.tsx/)
          assert.match(items[4].text, /Corrió un comando[\s\S]*Bash[\s\S]*npm test/)
          const times = items.map((i) => Date.parse(i.time))
          assert.deepEqual([...times].sort((a, b) => a - b), times, 'in the order they happened')
          assert.deepEqual(items.map((i) => i.current), items.map((_, i) => i === 59), 'only the last call, which has not returned, is the one in progress')
          // The lane scrolls by itself, is bounded, stays at the last step while the session runs, and does not push the page sideways or lengthen the document.
          const m = await lane.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight, top: el.scrollTop, overflowY: getComputedStyle(el).overflowY, doc: document.documentElement.scrollWidth, win: window.innerWidth }))
          assert.ok(m.scroll > m.client, 'it has more steps than it shows')
          assert.ok(m.client <= viewport.height * 0.4 + 1, `lane ${m.client} of ${viewport.height}`)
          assert.ok(m.top + m.client >= m.scroll - 24, 'pinned to the last step')
          assert.equal(m.overflowY, 'auto')
          assert.ok(m.doc <= m.win, `horizontal overflow ${m.doc} > ${m.win}`)
          await shot(page, `sesion-abierta-${size}-${colorScheme}`)
        } finally {
          await context.close()
        }
      }
    })
  }

  test('a screenshot says what it shows and opens in the viewer of the sheet', async () => {
    const ids = await panel.control.agentWork({ steps: 12 })
    const { page, context } = await open(`/messages/${ids.session}`)
    try {
      await page.locator('[data-work-toggle="session"]').click()
      const lane = page.locator('[data-lane="session-steps"]')
      await lane.waitFor()
      const captures = lane.locator('li[data-step-action="capture"]')
      assert.equal(await captures.count(), 2)
      assert.match(await captures.nth(0).innerText(), /Tomó una captura[\s\S]*Agenda del día con el botón nuevo/)
      assert.equal(await captures.nth(0).locator('button').count(), 0, 'its file is not in the thread yet')
      await captures.nth(1).locator('button').click()
      const dialog = page.getByRole('dialog')
      await dialog.waitFor()
      await dialog.locator('img').first().waitFor()
      assert.ok(await dialog.locator('img').first().evaluate((img) => img.complete && img.naturalWidth > 0))
    } finally {
      await context.close()
    }
  })

  for (const [size, viewport] of SIZES) {
    test(`Publicación opens its detailed state at ${size}`, async () => {
      const ids = await panel.control.agentWork()
      for (const colorScheme of ['light', 'dark']) {
        const { page, context } = await open(`/messages/${ids.delivering}`, { viewport, colorScheme })
        try {
          assert.equal(await page.getByRole('status').count(), 0, 'nothing loose under the bar')
          await page.locator('[data-work-toggle="deliver"]').click()
          assert.equal((await page.locator('[data-work-status]').innerText()).trim(), 'Entrega: verificación')
          assert.equal(await page.locator('[data-work-toggle="machine"]').count(), 0)
          await shot(page, `publicacion-abierta-${size}-${colorScheme}`)
        } finally {
          await context.close()
        }
      }
    })
  }

  test('once the work ended the history is in Detalles › Tiempos behind the same row', async () => {
    const { done_id: doneId } = await panel.control.execution()
    const { page, context } = await (async () => {
      const context = await panel.browser.newContext({ viewport: SIZES[0][1], locale: 'es-CL', colorScheme: 'light' })
      const page = await context.newPage()
      await login(page, origin, 'ana')
      await page.goto(`${origin}/messages/${doneId}`)
      await settled(page)
      return { page, context }
    })()
    try {
      assert.equal(await page.getByTestId('agent-work').count(), 0, 'the panel is gone')
      await page.getByRole('button', { name: 'Detalles' }).click()
      const row = page.locator('[data-timing-session] [data-work-step="session"]')
      await row.waitFor()
      assert.equal(await page.locator('[data-lane="session-steps"]').count(), 0, 'closed until opened')
      await row.locator('[data-work-toggle="session"]').click()
      await page.locator('[data-lane="session-steps"] li').first().waitFor()
      assert.equal(await page.locator('[data-lane="session-steps"] li').count(), 24)
      assert.equal(await page.locator('[data-lane="session-steps"] li[data-step-current]').count(), 0, 'nothing is in progress once it ended')
      await shot(page, 'tiempos-1440x900-light')
    } finally {
      await context.close()
    }
  })
})
