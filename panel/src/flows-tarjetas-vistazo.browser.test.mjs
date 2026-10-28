// UD-241: every row of a list measures the same, the extract is one line ended with an ellipsis, and the data of a row fall at the same x in
// every row. Measured in a real browser against dev-server.mjs serving panel/dist: `npm run test:flows`.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_PORT ?? 9205), { stepMs: 80 })
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

/** The three lists of cards: Inicio (messages and replies), Mensajes and the view of an area. */
const VIEWS = [
  ['inicio', '/'],
  ['mensajes', '/messages'],
  ['área', '/areas/a-error'],
]

async function session(viewport = DESKTOP, { mobile = false, scheme = 'light' } = {}) {
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL', colorScheme: scheme, isMobile: mobile, hasTouch: mobile })
  const page = await context.newPage()
  await login(page, origin)
  return { page, context }
}

async function open(page, path) {
  await page.goto(`${origin}${path}`)
  await page.locator('main h1').first().waitFor()
  await page.locator('main article h3').first().waitFor()
  // The view of an area opens with «Plantillas» unfolded (UD-252), which leaves room for one row at 1440x900: folded, the list has its rows to compare.
  const templates = page.getByRole('button', { name: /^Plantillas/, expanded: true })
  if (await templates.count()) await templates.click()
  // The lists draw sixty rows to measure what fits, and only then the page that fits (UD-017).
  await page.waitForFunction(() => !document.querySelector('[data-fit-measuring]'))
  await settled(page)
}

/**
 * Every visible row with what the measure needs: the height of its grid (the article itself loses its 1 px rule in the last row), and
 * which of its texts that may not be cut (the heading, the area chip, who and when, the recipients) wrap beyond the lines the grid reserves.
 */
const rows = (page) =>
  page.locator('main article').evaluateAll((articles) =>
    articles
      .filter((a) => a.querySelector('h3') && a.getBoundingClientRect().height > 0)
      .map((a) => {
        const grid = a.firstElementChild
        const lineHeight = (el) => parseFloat(getComputedStyle(el).lineHeight)
        const lines = (el) => (el ? Math.round(el.getBoundingClientRect().height / lineHeight(el)) : 0)
        const heading = a.querySelector('h3')
        const extract = a.querySelector('[data-testid="card-extract"]')
        const text = a.querySelector('[data-testid="card-text"]')
        const chip = a.querySelector('[data-testid="area-chip"]')
        const state = a.querySelector('[data-testid="card-state"]')
        const who = a.querySelector('[data-testid="card-who"]')
        const recipients = a.querySelector('ul[aria-label="Destinatarios"]')
        const foot = a.querySelector('[data-testid="card-foot"]')
        const box = (el) => (el ? el.getBoundingClientRect().toJSON() : null)
        const wrapped = []
        if (lines(heading) > 1) wrapped.push(`heading of ${lines(heading)} lines`)
        if (chip && lines(chip) > 1) wrapped.push(`area chip of ${lines(chip)} lines`)
        if (state && state.getBoundingClientRect().height > lineHeight(state) * 1.5) wrapped.push('state line wrapped')
        if (who && who.getBoundingClientRect().height > lineHeight(who) * 1.5) wrapped.push('who line wrapped')
        if (recipients && recipients.getBoundingClientRect().height > lineHeight(recipients) * 1.5) wrapped.push('recipients wrapped')
        // In the stacked layout the foot holds the recipients and the two actions (28 px): long names push the actions to a second line.
        if (foot && getComputedStyle(foot).display !== 'contents' && foot.getBoundingClientRect().height > 28 * 1.5) wrapped.push('foot wrapped')
        return {
          title: heading.textContent.trim().slice(0, 40),
          height: grid.offsetHeight,
          wrapped,
          text: box(text),
          extract: { ...box(extract), lines: lines(extract), overflow: getComputedStyle(extract).textOverflow, nowrap: getComputedStyle(extract).whiteSpace, title: extract.getAttribute('title'), scrollWidth: extract.scrollWidth, clientWidth: extract.clientWidth },
          heading: box(heading),
          state: box(state),
          who: box(who),
          thumb: box(a.querySelector('[data-testid="card-thumb"]')),
          hasMedia: !!a.querySelector('[data-testid="card-thumb"] button'),
        }
      }),
  )

/** The most frequent height among the rows with nothing wrapped (every row, when all of them wrap something). */
const mode = (list) => {
  const plain = list.filter((r) => r.wrapped.length === 0)
  const count = new Map()
  for (const r of plain.length ? plain : list) count.set(r.height, (count.get(r.height) ?? 0) + 1)
  return [...count].sort((a, b) => b[1] - a[1])[0][0]
}

describe('rows of one height (UD-241)', () => {
  for (const [name, path] of VIEWS) {
    test(`${name} at 1440x900: every row measures the same, and each datum sits at the same x and the same offset in every row`, async () => {
      const { page, context } = await session()
      try {
        await open(page, path)
        const list = await rows(page)
        // The view of an area keeps the place of the strip of marked rows (DISENO.md «Tarjeta de lista»). Plantillas is folded by `open` above to compare rows: 2 are drawn at 1440x900 (with Plantillas open, 1).
        assert.ok(list.length >= (path.startsWith('/areas') ? 2 : 3), `${list.length} rows drawn`)
        // Inicio has two lists in columns of different widths: the rows are compared within each list (by their left edge).
        const byList = new Map()
        for (const r of list) byList.set(Math.round(r.heading.left), [...(byList.get(Math.round(r.heading.left)) ?? []), r])
        for (const group of byList.values()) {
          const expected = mode(group)
          for (const r of group) {
            // A text the interface never cuts (UD-016) that wraps beyond its reserved lines is the one thing that makes a row taller; the seeded data has one such row (an area name of 58 characters in the half column of Inicio).
            if (r.height !== expected) assert.ok(r.wrapped.length > 0, `«${r.title}» measures ${r.height} px and the others ${expected}, with nothing wrapped`)
            const first = group[0]
            assert.ok(Math.abs(r.text.top - r.heading.top) < 1, `«${r.title}»: the heading does not open the text block`)
            assert.ok(Math.abs(r.state.left - first.state.left) < 1 && Math.abs(r.who.left - first.who.left) < 1, `«${r.title}»: the state or who line is at another x`)
            assert.ok(Math.abs(r.thumb.left - first.thumb.left) < 1 && Math.abs(r.thumb.width - 40) < 1, `«${r.title}»: the thumbnail column (${r.thumb.left}, ${r.thumb.width} px) is not the same in every row`)
            // The offsets inside the row are the same in every row: the state line opens at the same distance under the top of the text block.
            assert.ok(Math.abs(r.state.top - r.text.top - (first.state.top - first.text.top)) < 1, `«${r.title}»: the state line is at another offset`)
          }
        }
        if (name !== 'inicio') {
          const odd = list.filter((r) => r.height !== mode(list))
          assert.deepEqual(odd.map((r) => r.title), [], `rows of another height in ${name}`)
        }
        // Mensajes shows rows with and without media on its first page: the thumbnail column is measured in both.
        if (name === 'mensajes') assert.ok(list.some((r) => r.hasMedia) && list.some((r) => !r.hasMedia), 'the page shows rows with and without media, so the thumbnail column is measured in both')
      } finally {
        await context.close()
      }
    })
  }

  test('on a phone the rows of Mensajes measure the same, except those whose heading or names wrap beyond their lines', async () => {
    const { page, context } = await session(PHONE, { mobile: true })
    try {
      await open(page, '/messages')
      const list = await rows(page)
      assert.ok(list.length >= 6, `${list.length} rows drawn`)
      const expected = mode(list)
      const regular = list.filter((r) => r.height === expected)
      assert.ok(regular.length >= list.length / 2, `only ${regular.length} of ${list.length} rows measure ${expected} px`)
      for (const r of list) if (r.height !== expected) assert.ok(r.wrapped.length > 0, `«${r.title}» measures ${r.height} px and the others ${expected}, with nothing wrapped`)
    } finally {
      await context.close()
    }
  })
})

describe('the extract is one line (UD-241)', () => {
  // On a phone too: the guide's «nothing is cut on a phone» does not reach the extract of a row (Martín, 2026-10-24, with a capture of 10 lines).
  for (const [label, viewport, mobile] of [['1440x900', DESKTOP, false], ['390x844', PHONE, true]]) test(`at ${label}, with a long text the extract is one line high, ends with an ellipsis and carries the whole text as its tooltip`, async () => {
    const { page, context } = await session(viewport, { mobile })
    try {
      await open(page, '/messages')
      const list = await rows(page)
      const long = list.find((r) => r.extract.scrollWidth > r.extract.clientWidth + 1)
      assert.ok(long, 'no row has an extract longer than its line: the test would prove nothing')
      for (const r of list) {
        assert.equal(r.extract.lines, 1, `«${r.title}»: the extract is ${r.extract.lines} lines high`)
        assert.equal(r.extract.overflow, 'ellipsis', `«${r.title}»: the extract does not end with an ellipsis`)
        assert.equal(r.extract.nowrap, 'nowrap', `«${r.title}»: the extract wraps`)
        assert.ok(r.extract.title && r.extract.title.length > 0, `«${r.title}»: the extract has no tooltip with the whole text`)
      }
      // The whole text is read in the detail.
      const body = await (await page.request.get(`${origin}/api/messages`)).json()
      const hit = (Array.isArray(body) ? body : body.items).find((m) => m.title.startsWith(long.title.slice(0, 20)))
      assert.ok(hit, 'the long row is a message of the server')
      assert.equal(long.extract.title, hit.body, 'the tooltip is the whole body')
      await page.goto(`${origin}/messages/${hit.id}`)
      await page.locator('main h1').waitFor()
      assert.ok((await page.locator('main').innerText()).includes(hit.body.split('\n')[0]), 'the detail shows the whole text')
    } finally {
      await context.close()
    }
  })
})
