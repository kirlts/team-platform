// Round 5, lists (home, messages and areas findings): each test reads what the screen shows, in a real browser, against dev-server.mjs
// serving panel/dist: `npm run test:flows`.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, startPanel, settled } from './browser-support.mjs'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_PORT ?? 8807), { stepMs: 80 })
  origin = panel.origin
})
beforeEach(async () => {
  await panel.control.reset()
})
after(async () => {
  await panel?.stop()
})

const DESKTOP = { width: 1440, height: 900 }
const PHONE = { width: 390, height: 844 }
const ACTIONS = /^(Responder|Cerrar|Reabrir)$/

async function session(who = 'ana', viewport = DESKTOP, scheme = 'light') {
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL', colorScheme: scheme })
  const page = await context.newPage()
  await login(page, origin, who)
  return { page, context }
}

const json = async (page, path) => (await page.request.get(`${origin}${path}`)).json()

/** The geometry of the actions of every row drawn inside `scope`, relative to the row and to its line of metadata. */
const actionRows = (scope) =>
  // Message rows only: the view of an area also lists its templates as articles, open by default (UD-252).
  scope.locator('article:has(h3 a[href^="/messages/"])').evaluateAll((articles, actions) =>
    articles.map((a) => {
      const box = a.getBoundingClientRect()
      const buttons = [...a.querySelectorAll('a, button')].filter((x) => new RegExp(actions).test(x.textContent.trim()))
      const meta = a.querySelector('time').parentElement.getBoundingClientRect()
      const close = buttons.find((x) => /^(Cerrar|Reabrir)$/.test(x.textContent.trim())).getBoundingClientRect()
      return { title: a.querySelector('h3').textContent.trim(), reply: buttons.some((x) => x.textContent.trim() === 'Responder'), closeFromRight: Math.round(box.right - close.right), closeBelowMeta: Math.round(close.top - meta.bottom), closeLeft: Math.round(close.left) }
    }),
  ACTIONS.source)

/** Space between the last row of a frame and its pager, and the height of the first row of the next page: a row that fits is never left for the next page. */
async function leftover(page, frame) {
  const measure = () =>
    frame.evaluate((el) => {
      const rows = [...el.querySelectorAll('article')]
      const pager = el.querySelector('[aria-live="polite"]').parentElement.getBoundingClientRect()
      return { n: rows.length, gap: pager.top - rows.at(-1).getBoundingClientRect().bottom, first: rows[0].getBoundingClientRect().height }
    })
  const page1 = await measure()
  await frame.getByRole('button', { name: 'Página siguiente' }).click()
  await page.waitForTimeout(400)
  const page2 = await measure()
  return { page1, nextRow: page2.first }
}

describe('Inicio, Mensajes and Áreas lists (round 5)', () => {
  test('the marks of the top bar say they count what is for me, and the sidebar says its counts are the team\'s (UD-028, UD-210)', async () => {
    const { page, context } = await session('ana')
    try {
      const bar = page.getByTestId('status-bar')
      await bar.waitFor()
      for (const mark of await bar.getByTestId('state-button').all()) {
        const name = await mark.getAttribute('aria-label')
        assert.match(name, /^\d+ (abiertos?|respondidos?|cerrados?) para mí$/)
        assert.equal(await mark.getAttribute('title'), name)
      }
      const summary = await json(page, '/api/messages/summary')
      const counts = await page.locator('nav [data-nav-count] a.nav-count').evaluateAll((els) => els.map((el) => ({ name: el.getAttribute('aria-label'), title: el.getAttribute('title') })))
      assert.ok(counts.length >= 3)
      for (const c of counts) {
        assert.match(c.name, /: \d+ abiertos? en el equipo$/)
        assert.equal(c.title, c.name, 'the tooltip says the same as the accessible name')
      }
      // The two scopes differ in the sample data: the team has more open messages than the ones that are for me.
      const team = summary.areas.reduce((n, a) => n + a.open, 0)
      assert.ok(team > summary.mine.open, `team ${team}, mine ${summary.mine.open}`)
    } finally {
      await context.close()
    }
  })

  test('both blocks of Inicio name their filter the same way and put the actions in the same place (UD-210)', async () => {
    const { page, context } = await session('ana')
    try {
      await page.locator('article').first().waitFor()
      const blocks = [page.getByRole('region', { name: 'Últimos mensajes' }), page.getByRole('region', { name: 'Últimas respuestas' })]
      for (const block of blocks) {
        const tabs = await block.getByRole('radio').allTextContents().catch(() => [])
        const names = tabs.length ? tabs : await block.locator('[role="tab"], button').allTextContents()
        assert.ok(names.includes('Para mí') && names.includes('Todos'), `${names.join(' | ')}`)
        assert.equal(await block.getByText('Que me involucran').count(), 0)
      }
      const [a, b] = await Promise.all(blocks.map((block) => actionRows(block)))
      for (const row of [...a, ...b]) {
        assert.equal(row.closeFromRight, a[0].closeFromRight, `Cerrar sits ${row.closeFromRight} px from the right edge of «${row.title}»`)
        assert.equal(row.closeBelowMeta, a[0].closeBelowMeta, `the actions of «${row.title}» sit ${row.closeBelowMeta} px under the metadata`)
      }
    } finally {
      await context.close()
    }
  })

  test('no row that fits is left out of a page: the space above a pager is less than the next row (Inicio, Mensajes)', async () => {
    const { page, context } = await session('ana')
    try {
      await page.locator('article').first().waitFor()
      for (const name of ['Últimos mensajes', 'Últimas respuestas']) {
        const { page1, nextRow } = await leftover(page, page.getByRole('region', { name }))
        assert.ok(page1.n >= 2, `${name}: ${page1.n} rows`)
        assert.ok(page1.gap < nextRow, `${name}: ${Math.round(page1.gap)} px free above the pager and the next row is ${Math.round(nextRow)} px`)
      }
      await page.goto(`${origin}/messages`)
      await page.locator('article').first().waitFor()
      const { page1, nextRow } = await leftover(page, page.locator('main'))
      assert.ok(page1.gap < nextRow, `Mensajes: ${Math.round(page1.gap)} px free above the pager and the next row is ${Math.round(nextRow)} px`)
    } finally {
      await context.close()
    }
  })

  test('only the sender lacks «Responder», and «Cerrar» sits in the same place in every row (HP-009)', async () => {
    const { page, context } = await session('ana')
    try {
      const me = await json(page, '/api/me')
      const body = await json(page, '/api/messages')
      const list = Array.isArray(body) ? body : body.items
      await page.goto(`${origin}/messages`)
      await page.locator('article').first().waitFor()
      await settled(page) // the rows are measured once the list settled, not while the first page is being fitted
      const drawn = await actionRows(page.locator('main'))
      assert.ok(drawn.some((r) => !r.reply), 'the sample has a message sent by the session')
      for (const row of drawn) {
        const m = list.find((x) => x.title === row.title)
        assert.equal(row.reply, m.author_id !== me.id && m.status !== 'closed', `«${row.title}»: Responder follows the sender, not the state`)
        assert.equal(row.closeLeft, drawn[0].closeLeft, `Cerrar of «${row.title}» is not where the others are`)
      }
      const area = list.find((m) => m.author_id === me.id && m.status !== 'closed').area_id
      await page.goto(`${origin}/areas/${area}`)
      await page.locator('article').first().waitFor()
      const inArea = await actionRows(page.locator('main'))
      for (const row of inArea) assert.equal(row.closeLeft, inArea[0].closeLeft, `Cerrar of «${row.title}» in the view of the area`)
      assert.ok(inArea.some((r) => !r.reply), 'the area view has the sender\'s own message')
    } finally {
      await context.close()
    }
  })

  test('the title of an area view carries the color square of its area (UD-045)', async () => {
    const { page, context } = await session('ana')
    try {
      const areas = await json(page, '/api/areas')
      const area = (Array.isArray(areas) ? areas : areas.items).find((a) => a.title === 'Error')
      await page.goto(`${origin}/areas/${area.id}`)
      const swatch = page.locator('main header').getByTestId('area-color-trigger')
      await swatch.waitFor()
      const [inner, h1] = await Promise.all([swatch.locator('span').evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, box: el.getBoundingClientRect().toJSON() })), page.locator('main h1').boundingBox()])
      const hex = area.color.replace('#', '')
      assert.equal(inner.bg, `rgb(${[0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`)
      assert.ok(inner.box.right <= h1.x, 'the square goes before the title')
    } finally {
      await context.close()
    }
  })

  test('an area without messages shows its counts at zero, and on a phone the description has the width of the row (UD-211)', async () => {
    const { page, context } = await session('ana', PHONE)
    try {
      await page.goto(`${origin}/areas`)
      await page.locator('main section a[aria-label^="Abrir"]').first().waitFor()
      const rows = await page.evaluate(() =>
        [...document.querySelectorAll('main section')]
          .filter((r) => r.querySelector('a[aria-label^="Abrir"]'))
          .map((r) => {
            const card = r.getBoundingClientRect()
            const description = r.querySelector(':scope > div')
            return { title: r.querySelector('a[aria-label^="Abrir"]').getAttribute('aria-label'), marks: [...r.querySelectorAll('[data-testid="state-mark"]')].map((m) => m.textContent.trim()), described: description.getBoundingClientRect().width, card: card.width }
          }),
      )
      assert.ok(rows.some((r) => r.marks.join(' ') === '0 abiertos 0 respondidos'), 'the empty area says both counts at zero')
      for (const r of rows) {
        assert.ok(r.marks.length > 0, `${r.title}: blank column of counts`)
        assert.ok(r.described >= r.card * 0.6, `${r.title}: the description is ${Math.round(r.described)} px of a ${Math.round(r.card)} px row`)
      }
    } finally {
      await context.close()
    }
  })

  test('on a phone the name in the top bar takes at most two lines and never runs under the marks at 390 and 360 px', async () => {
    for (const width of [390, 360]) {
      const { page, context } = await session('ana', { width, height: 844 })
      try {
        await page.getByTestId('status-bar').waitFor()
        const wordmark = await page.locator('header a').first().evaluate((a) => {
          const text = a.querySelector('span span:last-child')
          const range = document.createRange()
          range.selectNodeContents(text)
          const lines = new Set([...range.getClientRects()].map((r) => Math.round(r.top)))
          return { lines: lines.size, right: text.getBoundingClientRect().right, fontSize: getComputedStyle(text).fontSize }
        })
        const first = await page.getByTestId('state-button').first().boundingBox()
        assert.ok(wordmark.right <= first.x, `the name ends at ${wordmark.right} and the marks start at ${first.x} (${width})`)
        assert.equal(wordmark.fontSize, '12px', 'the name keeps the support size of the scale')
        // The three marks are 16 px icons and, on a touch screen, 44 px targets: the name gives them the room and breaks in two lines, never in three.
        assert.ok(wordmark.lines <= 2, `the name takes ${wordmark.lines} lines at ${width} px`)
      } finally {
        await context.close()
      }
    }
  })
})
