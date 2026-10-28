// The sidebar shows, for each area, the open count (triangle) and the answered count (clock), each one only when it is above zero, each one a link
// to Mensajes filtered by that area and state; the closed ones carry no mark (Martín, 2026-10-28). A count arriving changes neither the height
// of the row nor where the name wraps. Real browser: `npm --prefix panel run test:browser -- src/sidebar-counts.browser.test.mjs`.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_SIDEBAR_COUNTS_PORT ?? 8930))
  origin = panel.origin
})
beforeEach(async () => {
  await panel.control.reset()
})
after(async () => {
  await panel?.stop()
})

const LONG = 'Coordinación de proyectos transversales con proveedores externos de la región'
const VIEWPORTS = [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]
const TOLERANCE = 1

/**
 * Opens the shell with the summary and the areas rewritten: the first four areas of the dev data become the cases. `withCounts: false` serves
 * the same areas with every count at zero, to measure the rows before a count arrives.
 */
async function session(viewport, { withCounts = true } = {}) {
  const mobile = viewport.width < 768
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL', colorScheme: 'light', isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 })
  const page = await context.newPage()
  const cases = {}
  // The summary can arrive before the list of areas: the cases are read from the list itself, once.
  const known = async () => {
    if (!Object.keys(cases).length) {
      const body = await (await page.context().request.get(`${origin}/api/areas`)).json()
      ;(Array.isArray(body) ? body : body.items).slice(0, 4).forEach((a, i) => { cases[a.id] = i })
    }
  }
  await page.route(/\/api\/areas$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    await known()
    const res = await route.fetch()
    const body = await res.json()
    const areas = Array.isArray(body) ? body : body.items
    areas.slice(0, 4).forEach((a, i) => { a.title = ['Producto', 'Soporte', 'Archivo', LONG][i] })
    await route.fulfill({ response: res, json: body })
  })
  await page.route(/\/api\/messages\/summary$/, async (route) => {
    await known()
    const res = await route.fetch()
    const body = await res.json()
    const ids = Object.keys(cases)
    const counts = withCounts ? [[5, 2, 1], [0, 3, 0], [0, 0, 9], [12, 1, 0]] : [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]
    body.areas = ids.map((id, i) => ({ area_id: id, open: counts[i][0], answered: counts[i][1], closed: counts[i][2] }))
    await route.fulfill({ response: res, json: body })
  })
  await login(page, origin, 'ana')
  await page.locator('main').first().waitFor()
  if (mobile) await page.getByRole('button', { name: 'Abrir navegación' }).click()
  await page.getByRole('link', { name: LONG, exact: false }).first().waitFor()
  await settled(page)
  return { page, context, ids: () => Object.keys(cases) }
}

/** For each area row of the visible sidebar: its name, its box, the marks it draws and the line count of its name. */
const rows = (page) =>
  page.evaluate(() => {
    const nav = [...document.querySelectorAll('nav[aria-label="Navegación"]')].find((n) => n.getBoundingClientRect().width > 0)
    const navBox = nav.getBoundingClientRect()
    return [...nav.querySelectorAll('[data-lane="areas-nav"] [data-nav-row]')].map((wrap) => {
      const name = [...wrap.querySelector('a').querySelectorAll('span')].pop()
      const lh = parseFloat(getComputedStyle(name).lineHeight)
      const box = wrap.getBoundingClientRect()
      const nameBox = name.getBoundingClientRect()
      return {
        name: name.textContent.trim(),
        height: wrap.offsetHeight, // layout height: a drawer still sliding in would scale the rectangle
        right: box.right,
        navRight: navBox.right,
        nameRight: nameBox.right,
        lines: Math.round(nameBox.height / lh),
        marks: [...wrap.querySelectorAll('a.nav-count')].map((a) => {
          const r = a.getBoundingClientRect()
          return { status: a.getAttribute('data-count-status'), text: a.textContent.trim(), href: a.getAttribute('href'), label: a.getAttribute('aria-label'), title: a.getAttribute('title'), left: r.left, right: r.right, centerY: r.top + r.height / 2, hasShape: !!a.querySelector('svg'), word: /abiert|respond/i.test(a.textContent) }
        }),
        centerY: box.top + box.height / 2,
      }
    })
  })

for (const [name, viewport] of VIEWPORTS) {
  describe(`counts by state in the areas of the sidebar at ${name}`, () => {
    test('draws exactly the counts above zero, with no word, each one a filtered link', async () => {
      const { page, context, ids } = await session(viewport)
      try {
        const [producto, soporte, archivo, largo] = await rows(page).then((all) => ['Producto', 'Soporte', 'Archivo', LONG].map((n) => all.find((r) => r.name === n)))
        const [a0, a1, a2, a3] = ids()
        const shape = (r) => r.marks.map((m) => `${m.status}:${m.text}`)
        assert.deepEqual(shape(producto), ['open:5', 'answered:2'])
        assert.deepEqual(shape(soporte), ['answered:3'])
        assert.deepEqual(shape(archivo), [], 'a closed count has no mark')
        assert.deepEqual(shape(largo), ['open:12', 'answered:1'])
        for (const [row, id] of [[producto, a0], [soporte, a1], [largo, a3]]) {
          for (const m of row.marks) {
            const url = new URL(m.href, 'http://x')
            assert.equal(url.pathname, '/messages')
            const query = decodeURIComponent(url.search)
            assert.ok(query.includes(id) && query.includes(m.status), `${row.name} ${m.status}: ${m.href}`)
            assert.ok(m.hasShape && !m.word, `${row.name} ${m.status}: a mark has its shape and no word`)
            assert.ok(m.label.includes(row.name) && m.label.includes('en el equipo'), `scope in the name: ${m.label}`)
            assert.equal(m.title, m.label)
          }
        }
        assert.equal(archivo.marks.length + 0, 0)
        void a2
        // The link goes where it says: the list filtered by that area and that state.
        await page.getByRole('link', { name: /Producto: 5 abiertos en el equipo/ }).click()
        await page.waitForURL(/\/messages\?/)
        const q = decodeURIComponent(new URL(page.url()).search)
        assert.ok(q.includes(a0) && q.includes('open'), q)
        if (viewport.width < 768) await page.getByRole('button', { name: 'Abrir navegación' }).click()
        await page.getByRole('link', { name: /Producto: 2 respondidos en el equipo/ }).click()
        await page.waitForURL((u) => decodeURIComponent(u.search).includes('answered'))
      } finally {
        await context.close()
      }
    })

    test('a count arriving changes no row height of a name that fits, the marks end at one right edge and the long name neither pushes them out nor splits the row', async () => {
      const bare = await session(viewport, { withCounts: false })
      let before
      try {
        before = await rows(bare.page)
      } finally {
        await bare.context.close()
      }
      const { page, context } = await session(viewport)
      try {
        const after = await rows(page)
        // The rows whose name fits beside the marks (all but the long one): a count arriving changes neither their height nor how their name wraps.
        for (const b of before.filter((r) => r.name !== LONG && !r.name.startsWith('Accesibilidad'))) {
          const a = after.find((r) => r.name === b.name)
          assert.ok(Math.abs(a.height - b.height) <= TOLERANCE, `${b.name}: ${b.height} px before, ${a.height} px after`)
          assert.equal(a.lines, b.lines, `${b.name} wraps the same before and after`)
        }
        const marked = after.filter((r) => r.marks.length)
        const edge = marked[0].marks.at(-1).right
        for (const r of marked) {
          assert.ok(Math.abs(r.marks.at(-1).right - edge) <= TOLERANCE, `${r.name}: right edge ${r.marks.at(-1).right} against ${edge}`)
          for (const m of r.marks) {
            assert.ok(Math.abs(m.centerY - r.centerY) <= TOLERANCE, `${r.name}: ${m.status} center ${m.centerY} against row ${r.centerY}`)
            assert.ok(m.right <= r.right + TOLERANCE, `${r.name}: a mark leaves its row`)
          }
          assert.ok(r.nameRight <= r.marks[0].left + TOLERANCE, `${r.name}: its name (right ${r.nameRight}) runs under the first mark (left ${r.marks[0].left})`)
        }
        // The name wraps whole: no ellipsis (UD-016), and it is the name that gives way, never the marks.
        const largo = after.find((r) => r.name === LONG)
        assert.ok(largo.lines >= 2, `the long name takes ${largo.lines} lines`)
        assert.equal(largo.marks.length, 2)
        assert.ok(largo.right <= largo.navRight + TOLERANCE)
        const short = after.find((r) => r.name === 'Producto')
        assert.equal(short.lines, 1)
        const clipped = await page.evaluate(() => [...document.querySelectorAll('[data-lane="areas-nav"] a span')].some((el) => getComputedStyle(el).textOverflow === 'ellipsis'))
        assert.equal(clipped, false)
        const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth - document.documentElement.clientWidth)
        assert.ok(overflow <= 0, `the page scrolls ${overflow} px sideways`)
      } finally {
        await context.close()
      }
    })
  })
}
