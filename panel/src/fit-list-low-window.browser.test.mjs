// H-96: a window lower than one row of a list must not paint the row over the pager. FitList gives a page at least one
// row (`fitCount` never returns less), so the frame has to be at least as tall as that row plus its pager; the page scrolls
// instead. Measured in the browser against dev-server.mjs serving panel/dist: `npm run test:fit`.
import assert from 'node:assert'
import { after, before, describe, test } from 'node:test'
import { login, startPanel, settled } from './browser-support.mjs'

let panel
before(async () => {
  panel = await startPanel(Number(process.env.PANEL_LOWWINDOW_PORT ?? 8892), { stepMs: 20 })
})
after(async () => {
  await panel?.stop()
})

/** For every pager on the page: how many rows of its list are drawn over it, and the height the row has. */
const pagerOverlaps = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('div.shrink-0.border-t > span[aria-live="polite"]')].map((span) => {
      const pager = span.parentElement
      const body = pager.previousElementSibling
      const mark = pager.getBoundingClientRect()
      const rows = [...body.children].map((el) => el.getBoundingClientRect())
      return {
        rows: rows.length,
        overlapped: rows.filter((r) => r.bottom > mark.top + 1 && r.top < mark.bottom).length,
        rowHeight: Math.round(rows[0]?.height ?? 0),
        gap: Math.round(mark.top - (rows[rows.length - 1]?.bottom ?? 0)),
      }
    }),
  )

describe('a list in a window lower than one of its rows (H-96)', () => {
  for (const [route, name] of [['/messages', 'Mensajes'], ['/', 'Inicio']]) {
    for (const height of [420, 300, 240]) {
      test(`${name} at 1280x${height}: no row is drawn over the pager`, async () => {
        const context = await panel.browser.newContext({ viewport: { width: 1280, height }, locale: 'es-CL' })
        try {
          const page = await context.newPage()
          await login(page, panel.origin, 'ana')
          await page.goto(panel.origin + route)
          await page.locator('article').first().waitFor()
          await settled(page)
          const lists = await pagerOverlaps(page)
          assert.ok(lists.length > 0, `${name}: expected a paged list`)
          for (const l of lists) {
            assert.equal(l.overlapped, 0, `${name} at ${height} px: ${l.overlapped} row(s) of ${l.rows} sit over the pager (row ${l.rowHeight} px)`)
            assert.ok(l.gap >= 0, `${name} at ${height} px: the pager starts ${-l.gap} px above the end of the last row`)
          }
        } finally {
          await context.close()
        }
      })
    }
  }
})
