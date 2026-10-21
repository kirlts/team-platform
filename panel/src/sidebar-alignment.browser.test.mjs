// UD-130: the rows of the sidebar sit on one grid. Counts share one right edge and one vertical center with their row, no label
// wraps in the 256 px panel, and hover and keyboard focus change the style of what can be clicked. Real browser: `npm run test:sidebar`.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_SIDEBAR_PORT ?? process.env.PANEL_FIT_PORT ?? 8981))
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
const TOLERANCE = 1

async function session(viewport) {
  const mobile = viewport.width < 768
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL', colorScheme: 'light', isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 })
  const page = await context.newPage()
  await login(page, origin, 'ana')
  await page.locator('main').first().waitFor()
  if (mobile) await page.getByRole('button', { name: 'Abrir navegación' }).click()
  await page.getByRole('link', { name: 'Retroalimentación', exact: true }).first().waitFor()
  await settled(page)
  return { page, context }
}

/** The geometry of every row of the visible sidebar: the row, its count column content and its label. */
const measure = (page) =>
  page.evaluate(() => {
    const nav = [...document.querySelectorAll('nav[aria-label="Navegación"]')].find((n) => n.getBoundingClientRect().width > 0)
    return [...nav.querySelectorAll('[data-nav-row]')].map((wrap) => {
      const link = wrap.querySelector('a, button')
      const label = [...link.querySelectorAll('span')].pop()
      const row = wrap.getBoundingClientRect()
      const lh = parseFloat(getComputedStyle(label).lineHeight)
      const marks = [...wrap.querySelectorAll('[data-nav-count] > *')].map((el) => el.getBoundingClientRect())
      const count = marks.length ? { right: Math.max(...marks.map((m) => m.right)), centerY: marks.reduce((a, m) => a + m.top + m.height / 2, 0) / marks.length } : null
      return { text: label.textContent.trim(), rowCenterY: row.top + row.height / 2, rowHeight: row.height, lines: Math.round(label.getBoundingClientRect().height / lh), count }
    })
  })

for (const [name, viewport] of [['desktop', DESKTOP], ['phone', PHONE]]) {
  describe(`sidebar grid at ${name} (UD-130)`, () => {
    test('counts share one right edge and the vertical center of their row', async () => {
      const { page, context } = await session(viewport)
      try {
        const rows = await measure(page)
        const counted = rows.filter((r) => r.count)
        assert.ok(counted.length >= 3, `rows with a count: ${counted.map((r) => r.text)}`)
        const edge = counted[0].count.right
        for (const r of counted) {
          assert.ok(Math.abs(r.count.right - edge) <= TOLERANCE, `${r.text}: right edge ${r.count.right} against ${edge}`)
          assert.ok(Math.abs(r.count.centerY - r.rowCenterY) <= TOLERANCE, `${r.text}: center ${r.count.centerY} against row ${r.rowCenterY}`)
        }
      } finally {
        await context.close()
      }
    })

    test('no label breaks into two lines, and the counts have no container', async () => {
      const { page, context } = await session(viewport)
      try {
        // A name typed by a person has no length limit and may wrap (the dev data has one of 50 characters); the fixed rows and the five template areas never do.
        const fixed = ['Inicio', 'Mensajes', 'Áreas', 'Idea', 'Error', 'Nueva funcionalidad', 'Retroalimentación', 'Pregunta', 'Equipo', 'Conexiones', 'Configuración', 'Cerrar sesión']
        const rows = (await measure(page)).filter((r) => fixed.includes(r.text))
        assert.ok(rows.length >= 11, `rows measured: ${rows.map((r) => r.text)}`)
        for (const r of rows) assert.equal(r.lines, 1, `${r.text} takes ${r.lines} lines`)
        const containers = await page.evaluate(() =>
          [...document.querySelectorAll('[data-nav-count] [data-status], [data-nav-count] [data-testid]')].map((el) => {
            const cs = getComputedStyle(el)
            return { id: el.getAttribute('data-testid'), bg: cs.backgroundColor, border: cs.borderTopColor, width: cs.borderTopWidth }
          }),
        )
        assert.ok(containers.length >= 3)
        for (const c of containers) assert.ok(c.bg === 'rgba(0, 0, 0, 0)' && (c.width === '0px' || c.border === 'rgba(0, 0, 0, 0)'), `a count has a container: ${JSON.stringify(c)}`)
      } finally {
        await context.close()
      }
    })
  })
}

describe('hover and focus of the sidebar (UD-130)', () => {
  const style = (loc) =>
    loc.evaluate((el) => {
      const cs = getComputedStyle(el.matches('.nav-ctl') ? el : (el.closest('[data-nav-row]') ?? el))
      const icon = el.querySelector('svg')
      return { bg: cs.backgroundColor, outline: cs.outlineStyle, icon: icon ? getComputedStyle(icon).color : '', color: cs.color }
    })
  const changed = (page, loc, key, from) => loc.evaluate((el, [k, f]) => {
    const get = () => { const cs = getComputedStyle(el.matches('.nav-ctl') ? el : (el.closest('[data-nav-row]') ?? el)); const icon = el.querySelector('svg'); return { bg: cs.backgroundColor, icon: icon ? getComputedStyle(icon).color : '', color: cs.color }[k] }
    return new Promise((res) => { const t0 = performance.now(); const tick = () => (get() !== f || performance.now() - t0 > 1500 ? res(get()) : requestAnimationFrame(tick)); tick() })
  }, [key, from])

  test('hovering a row lights its fill and its icon', async () => {
    const { page, context } = await session(DESKTOP)
    try {
      for (const name of ['Equipo', 'Conexiones', 'Error']) {
        const link = page.getByRole('link', { name, exact: true }).first()
        const before = await style(link)
        await link.hover()
        assert.notEqual(await changed(page, link, 'bg', before.bg), before.bg, `${name}: the fill does not change`)
        if (before.icon) assert.notEqual((await style(link)).icon, before.icon, `${name}: the icon does not change`)
        await page.mouse.move(700, 450)
      }
      for (const label of [/^Nueva área$/, /^Plegar áreas$/, /^Ocultar/]) {
        const btn = page.getByRole('button', { name: label }).first()
        const before = await style(btn)
        await btn.hover()
        assert.notEqual(await changed(page, btn, 'bg', before.bg), before.bg, `${label}: the fill does not change`)
        await page.mouse.move(700, 450)
      }
    } finally {
      await context.close()
    }
  })

  test('keyboard focus draws a ring and changes the style of the row and its controls', async () => {
    const { page, context } = await session(DESKTOP)
    try {
      await page.keyboard.press('Shift')
      for (const loc of [page.getByRole('link', { name: 'Equipo', exact: true }).first(), page.getByRole('button', { name: /^Nueva área$/ }).first(), page.getByRole('link', { name: /Error/ }).first()]) {
        await loc.evaluate((el) => el.blur())
        const before = await style(loc)
        await loc.focus()
        await page.waitForTimeout(0)
        const after = await loc.evaluate(async (el) => { await new Promise((r) => setTimeout(r, 200)); const cs = getComputedStyle(el.matches('.nav-ctl') ? el : (el.closest('[data-nav-row]') ?? el)); return { outline: cs.outlineStyle, bg: cs.backgroundColor } })
        assert.equal(after.outline, 'solid', 'no focus ring')
        assert.notEqual(before.outline, after.outline)
      }
    } finally {
      await context.close()
    }
  })
})
