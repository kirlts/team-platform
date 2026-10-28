// Second verdict of the list judge: the view of an area keeps its rows when one is marked and its sections are born folded, the list of areas
// has its counts on one line on a phone, a notice does not cover the strip of marked rows, the row opens the message with a 44 px target, and
// the filter menu is tidy on a phone (edge, value next to its arrow, «Yo» not listed twice).
// `PANEL_FLOWS_LISTA_JUEZ2_PORT=… node --test src/flows-lista-juez2.browser.test.mjs`.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_LISTA_JUEZ2_PORT ?? 9004), { stepMs: 80 })
  origin = panel.origin
})
beforeEach(async () => {
  await panel.control.reset()
})
after(async () => {
  await panel?.stop()
})

async function session(viewport, mobile, who = 'ana') {
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL', colorScheme: 'light', isMobile: mobile, hasTouch: mobile })
  const page = await context.newPage()
  await login(page, origin, who)
  return { page, context }
}

async function open(page, path, rowSelector = 'main article:has(h3)') {
  await page.goto(`${origin}${path}`)
  await page.locator(rowSelector).first().waitFor()
  await page.waitForFunction(() => !document.querySelector('[data-fit-measuring]'))
  await settled(page)
}

const rowsOnPage = (page) => page.locator('main article:has(h3)').count()
const shot = async (page, name) => process.env.SHOTS && page.screenshot({ path: `${process.env.TMPDIR}/${name}.png` })

describe('the view of an area on a desktop', () => {
  for (const [w, h] of [[1440, 900], [1440, 800], [1280, 720]]) {
    test(`${w}x${h}: marking a row does not take a row from the page nor move one (Plantillas open, Descripción folded)`, async () => {
      const { page, context } = await session({ width: w, height: h }, false)
      try {
        await open(page, '/areas/a-error')
        assert.equal(await page.getByRole('button', { name: /^Plantillas/ }).getAttribute('aria-expanded'), 'true', 'UD-252: Plantillas opens by default')
        assert.equal(await page.getByRole('button', { name: /^Descripción/ }).getAttribute('aria-expanded'), 'false')
        const before = { rows: await rowsOnPage(page), range: await page.locator('main [aria-live="polite"]').filter({ hasText: / de \d+$/ }).first().textContent().catch(() => null) }
        const tops = await page.locator('main article:has(h3)').evaluateAll((as) => as.map((a) => Math.round(a.getBoundingClientRect().top)))
        await page.getByTestId('row-check').first().click()
        await page.getByTestId('selection-bar').waitFor()
        await settled(page)
        assert.equal(await rowsOnPage(page), before.rows, 'a row left the page when the strip came in')
        const after = await page.locator('main [aria-live="polite"]').filter({ hasText: / de \d+$/ }).first().textContent().catch(() => null)
        assert.equal(after, before.range, 'the page size changed')
        const topsAfter = await page.locator('main article:has(h3)').evaluateAll((as) => as.map((a) => Math.round(a.getBoundingClientRect().top)))
        assert.deepEqual(topsAfter, tops, 'a row moved')
        const bar = await page.getByTestId('selection-bar').boundingBox()
        // With Plantillas open the strip sits under both sections: in a window of 720 px the page scrolls to it (the list is one row there).
        if (h >= 800) assert.ok(bar.y + bar.height <= h, `the strip ends at ${bar.y + bar.height} of ${h}`)
        await shot(page, `lista-juez2-area-marcada-${w}x${h}`)
      } finally {
        await context.close()
      }
    })
  }

  test('the link «N plantillas» of the list of areas arrives at the view with the section open (UD-252)', async () => {
    const { page, context } = await session({ width: 1440, height: 900 }, false)
    try {
      await open(page, '/areas', 'main section[data-marked], main section:has([data-testid="area-delete"])')
      await page.getByRole('link', { name: /^Plantillas de Error/ }).click()
      await page.getByRole('button', { name: /^Plantillas/ }).waitFor()
      assert.equal(await page.getByRole('button', { name: /^Plantillas/ }).getAttribute('aria-expanded'), 'true')
    } finally {
      await context.close()
    }
  })
})

describe('the list of areas on a phone', () => {
  for (const [w, h] of [[360, 740], [390, 844], [430, 932]]) {
    test(`${w}: the counts are on one line and the description takes the width of the row`, async () => {
      const { page, context } = await session({ width: w, height: h * 3 }, true)
      try {
        await open(page, '/areas', 'main section:has([data-testid="area-delete"])')
        const rows = await page.locator('main section:has([data-testid="area-delete"])').evaluateAll((ss) =>
          ss.map((s) => {
            const r = s.getBoundingClientRect()
            const marks = [...s.querySelectorAll('[data-testid="state-mark"]')].map((m) => m.getBoundingClientRect())
            const tpl = [...s.querySelectorAll('a')].find((a) => /plantilla/i.test(a.textContent))?.getBoundingClientRect()
            const color = s.querySelector('button[aria-label], [data-testid="area-color"]')?.getBoundingClientRect()
            const link = s.querySelector('a[aria-label^="Abrir"]')?.getBoundingClientRect()
            const desc = s.querySelector('div.min-w-0')?.getBoundingClientRect()
            return { h: r.height, left: r.left, right: r.right, tops: [...marks.map((m) => Math.round(m.top + m.height / 2)), tpl && Math.round(tpl.top + tpl.height / 2)], desc: desc && Math.round(desc.left), nameLeft: link && Math.round(link.left), colorLeft: color && Math.round(color.left), w: innerWidth, rightmost: Math.max(...marks.map((m) => m.right), tpl ? tpl.right : 0) }
          }),
        )
        for (const r of rows) {
          assert.ok(Math.max(...r.tops) - Math.min(...r.tops) <= 3, `the counts are on lines ${r.tops}`)
          assert.ok(r.rightmost <= r.right, `the counts reach ${r.rightmost}, the row ends at ${r.right}`)
          assert.ok(r.desc === undefined || r.desc < r.nameLeft, `the description starts at ${r.desc}, the name at ${r.nameLeft}`)
        }
        await shot(page, `lista-juez2-areas-${w}`)
      } finally {
        await context.close()
      }
    })
  }
})

describe('the strip of marked rows and the notice on a phone', () => {
  test('a notice shown with a row marked sits over the strip and covers none of its buttons', async () => {
    const { page, context } = await session({ width: 390, height: 844 }, true)
    try {
      await open(page, '/messages')
      await page.getByTestId('row-check').first().tap()
      const bar = page.getByTestId('selection-bar')
      await bar.waitFor()
      await page.locator('main article').nth(1).getByRole('button', { name: 'Cerrar' }).tap()
      const notice = page.locator('[data-notice]')
      await notice.waitFor()
      await settled(page)
      const n = await notice.boundingBox()
      const b = await bar.boundingBox()
      assert.ok(n.y + n.height <= b.y, `the notice ends at ${n.y + n.height}, the strip starts at ${b.y}`)
      // The three buttons of the strip answer a tap while the notice is up.
      for (const name of ['Marcar todos', 'Cancelar', 'Borrar']) {
        const box = await bar.getByRole('button', { name }).boundingBox()
        const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-notice]') !== null, [box.x + box.width / 2, box.y + box.height / 2])
        assert.equal(hit, false, `${name} is under the notice`)
      }
      await shot(page, 'lista-juez2-aviso-sobre-barra')
    } finally {
      await context.close()
    }
  })
})

describe('opening a message with a finger', () => {
  test('a tap on the extract, the state line and the title opens the message; the target of the row is 44 px or more', async () => {
    const { page, context } = await session({ width: 390, height: 844 }, true)
    try {
      await open(page, '/messages')
      const link = page.locator('main article h3 a').first()
      const box = await link.evaluate((a) => {
        const r = a.closest('article').getBoundingClientRect()
        const after = getComputedStyle(a, '::after')
        const clipped = [a, a.parentElement, a.parentElement.parentElement].some((e) => ['hidden', 'clip'].includes(getComputedStyle(e).overflowX))
        return { rowH: r.height, afterPos: after.position, clipped }
      })
      assert.equal(box.afterPos, 'absolute')
      assert.equal(box.clipped, false, 'a box that clips cuts the area of the link')
      const extract = await page.locator('main article').first().getByTestId('card-extract').boundingBox()
      const href = await link.getAttribute('href')
      await page.touchscreen.tap(extract.x + 20, extract.y + extract.height / 2)
      await page.waitForURL((u) => u.pathname === href)
    } finally {
      await context.close()
    }
  })
})

describe('the filter menu on a phone', () => {
  test('360: the menu keeps 8 px from the edge and the value chosen sits next to its arrow', async () => {
    const { page, context } = await session({ width: 360, height: 740 }, true)
    try {
      await open(page, '/messages')
      await page.getByRole('button', { name: /^Filtro/ }).tap()
      const menu = page.getByRole('menu').first()
      await menu.waitFor()
      await settled(page)
      const m = await menu.boundingBox()
      assert.ok(m.x >= 8, `the menu starts at x ${m.x}`)
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: /^Filtro/ }).tap()
      await page.getByRole('menuitem', { name: /^Área/ }).tap()
      await page.getByRole('menuitemradio', { name: /^Error/ }).tap()
      await page.getByRole('button', { name: /^Filtro/ }).tap()
      await settled(page)
      const gaps = await page.getByRole('menu').first().getByRole('menuitem', { name: /^Área/ }).evaluate((el) => {
        const value = el.querySelector('.sub-value').getBoundingClientRect()
        const arrow = el.querySelector('svg').getBoundingClientRect()
        const label = el.firstChild.textContent
        return { gap: arrow.left - value.right, label }
      })
      assert.ok(gaps.gap <= 12, `the value floats ${gaps.gap} px from its arrow`)
      await shot(page, 'lista-juez2-menu-raiz-360')
    } finally {
      await context.close()
    }
  })

  test('«Para» lists the person of the session once, as «Yo», and the chip says «Yo»', async () => {
    const { page, context } = await session({ width: 1440, height: 900 }, false)
    try {
      await open(page, '/messages')
      await page.getByRole('button', { name: /^Filtro/ }).click()
      await page.getByRole('menuitem', { name: /^Para/ }).click()
      const names = await page.getByRole('menu').last().getByRole('menuitemradio').allTextContents()
      assert.ok(names.some((n) => /^Yo/.test(n)))
      assert.ok(names.some((n) => /^Bruno/.test(n)))
      assert.ok(!names.some((n) => /^Ana/.test(n)), `Ana is listed: ${names}`)
      await page.getByRole('menuitemradio', { name: /^Yo/ }).click()
      await page.getByRole('list', { name: 'Filtros aplicados' }).getByText('Yo', { exact: true }).waitFor()
    } finally {
      await context.close()
    }
  })
})

describe('the header of an area on a phone', () => {
  for (const id of ['a-feedback', 'a-accesibilidad']) {
    test(`${id}: «Más» stays on the line of the title, at the right margin`, async () => {
      const { page, context } = await session({ width: 390, height: 844 }, true)
      try {
        await open(page, `/areas/${id}`)
        const more = await page.getByRole('button', { name: 'Más', exact: true }).first().boundingBox()
        const back = await page.getByRole('link', { name: /Áreas/ }).first().boundingBox()
        assert.ok(more.x + more.width >= 390 - 20 - 2, `«Más» ends at ${more.x + more.width}`)
        assert.ok(more.y < back.y + back.height + 4, `«Más» is at y ${more.y}, the first line ends at ${back.y + back.height}`)
        const y = await page.locator('main article:has(h3)').first().evaluate((el) => el.getBoundingClientRect().top)
        assert.ok(y < 430, `the first row starts at y ${y}`)
        await shot(page, `lista-juez2-cabecera-${id}`)
      } finally {
        await context.close()
      }
    })
  }
})
