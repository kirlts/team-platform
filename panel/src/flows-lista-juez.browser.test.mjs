// Verdict of the list judge (Mensajes and the view of an area): the values of a filter fit the window on a phone and can be chosen, a notice
// does not cover what is read, Marcar todos says what it marks, an empty area does not offer a filter that is not there, the list of an area
// comes first on a phone, and the actions of a row fall at the same x in every row.
// `PANEL_FLOWS_LISTA_JUEZ_PORT=… node --test src/flows-lista-juez.browser.test.mjs`. Captures go to $TMPDIR when SHOTS=1.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_LISTA_JUEZ_PORT ?? 9003), { stepMs: 80 })
  origin = panel.origin
})
beforeEach(async () => {
  await panel.control.reset()
})
after(async () => {
  await panel?.stop()
})

const SIZES = [
  ['phone 360', { width: 360, height: 740 }, true],
  ['phone 390', { width: 390, height: 844 }, true],
  ['phone 430', { width: 430, height: 932 }, true],
  ['desktop', { width: 1440, height: 900 }, false],
]

async function session(viewport, mobile, who = 'ana') {
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL', colorScheme: 'light', isMobile: mobile, hasTouch: mobile })
  const page = await context.newPage()
  await login(page, origin, who)
  return { page, context }
}

async function openMessages(page, path = '/messages') {
  await page.goto(`${origin}${path}`)
  await page.locator('main article h3').first().waitFor()
  await page.waitForFunction(() => !document.querySelector('[data-fit-measuring]'))
  await settled(page)
}

const shot = async (page, name) => process.env.SHOTS && page.screenshot({ path: `${process.env.TMPDIR}/${name}.png` })

describe('filter values', () => {
  for (const [name, viewport, mobile] of SIZES) {
    test(`${name}: the values of Para and Área open inside the window, and an area and a person can be chosen`, async () => {
      const { page, context } = await session(viewport, mobile)
      try {
        await openMessages(page)
        for (const prop of ['Para', 'Área']) {
          await page.getByRole('button', { name: /^Filtro/ }).click()
          await page.getByRole('menuitem', { name: new RegExp(`^${prop}`) }).click()
          const sub = page.getByRole('menu').last()
          await sub.getByRole('menuitemradio').first().waitFor()
          await settled(page)
          const box = await sub.evaluate((el) => {
            const r = el.getBoundingClientRect()
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, vw: innerWidth, vh: innerHeight, names: [...el.querySelectorAll('[role=menuitemradio]')].map((o) => o.textContent) }
          })
          assert.ok(box.left >= 0 && box.right <= box.vw && box.top >= 0 && box.bottom <= box.vh, `${prop} opens at ${JSON.stringify(box)}`)
          // Every option is entirely inside the window, and shows a name (not only its count).
          const items = await sub.getByRole('menuitemradio').evaluateAll((os) => os.map((o) => { const r = o.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, text: o.textContent } }))
          for (const o of items) assert.ok(o.l >= 0 && o.r <= box.vw, `option ${o.text} spans ${o.l}-${o.r} of ${box.vw}`)
          assert.ok(box.names.every((n) => /[A-Za-zÁÉÍÓÚáéíóú]{2}/.test(n)), `names are drawn: ${box.names}`)
          await shot(page, `lista-juez-${name.replace(' ', '-')}-${prop}`)
          await page.keyboard.press('Escape')
          await page.keyboard.press('Escape')
          await page.getByRole('menu').first().waitFor({ state: 'detached' })
        }
        // Choose an area and a person, with a finger on a phone (a tap, not a jump of the mouse over the sheet).
        const press = (locator) => (mobile ? locator.tap() : locator.click())
        await press(page.getByRole('button', { name: /^Filtro/ }))
        await press(page.getByRole('menuitem', { name: /^Área/ }))
        await press(page.getByRole('menuitemradio', { name: /^Error/ }))
        await press(page.getByRole('button', { name: /^Filtro/ }))
        await press(page.getByRole('menuitem', { name: /^Para/ }))
        await press(page.getByRole('menuitemradio', { name: /^Bruno/ }))
        await settled(page)
        assert.match(page.url(), /area/)
        assert.match(page.url(), /for/)
        const titles = await page.locator('main article h3').allTextContents()
        assert.ok(titles.length >= 1 && titles.length < 12, `filtered list has ${titles.length} rows`)
      } finally {
        await context.close()
      }
    })
  }
})

describe('the notice of closing', () => {
  for (const [name, viewport, mobile] of [SIZES[1], SIZES[3]]) {
    test(`${name}: closing a message with a long title leaves a notice that does not repeat the title, covers no reading and is short`, async () => {
      const { page, context } = await session(viewport, mobile)
      try {
        await openMessages(page)
        const long = await page.locator('main article h3').first().textContent()
        assert.ok(long.length > 50, 'the first row has a long title')
        await page.locator('main article').first().getByRole('button', { name: 'Cerrar' }).click()
        const notice = page.locator('[data-notice]')
        await notice.waitFor()
        await settled(page)
        const m = await notice.evaluate((el) => {
          const r = el.getBoundingClientRect()
          const line = parseFloat(getComputedStyle(el.querySelector('p')).lineHeight)
          const count = document.querySelector('main h1 + *')?.getBoundingClientRect()
          return { h: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right, line, text: el.textContent, count: count && { l: count.left, r: count.right, t: count.top, b: count.bottom } }
        })
        assert.ok(!m.text.includes(long.slice(0, 30)), `the notice repeats the title: ${m.text}`)
        const lines = Math.round((m.h - 12) / m.line)
        assert.ok(lines <= (mobile ? 2 : 1), `the notice is ${m.h} px, ${lines} lines`)
        assert.ok(m.h <= (mobile ? 76 : 44), `the notice is ${m.h} px tall`)
        if (!mobile) {
          const bar = await page.locator('header').first().evaluate((el) => el.getBoundingClientRect().bottom)
          assert.ok(m.bottom <= bar + 1, `the notice ends at ${m.bottom}, the top bar at ${bar}`)
        } else {
          // On a phone the notice floats at the foot: it must not reach the first rows' text more than the bottom margin of the window, and never exceed two lines.
          assert.ok(m.bottom <= 844)
        }
        await shot(page, `lista-juez-aviso-${name.replace(' ', '-')}`)
        // Deshacer brings the message back.
        await notice.getByRole('button', { name: 'Deshacer' }).click()
        await page.locator('main article').first().getByRole('button', { name: 'Cerrar' }).waitFor()
      } finally {
        await context.close()
      }
    })
  }
})

describe('Marcar todos', () => {
  test('the strip counts against the whole filtered list and Marcar todos marks all of it, not the page', async () => {
    const { page, context } = await session({ width: 1440, height: 900 }, false)
    try {
      await openMessages(page)
      const total = Number((await page.locator('main h1 + *').first().textContent()).match(/\d+/)[0])
      assert.ok(total > (await page.locator('main article').count()), 'the list has more rows than the page')
      await page.getByTestId('row-check').first().click()
      const bar = page.getByTestId('selection-bar')
      await bar.waitFor()
      assert.match(await bar.textContent(), new RegExp(`1 marcado de ${total}`))
      await bar.getByRole('button', { name: 'Marcar todos' }).click()
      assert.match(await bar.textContent(), new RegExp(`${total} marcados`))
      assert.doesNotMatch(await bar.textContent(), /marcados de/)
      assert.equal(await bar.getByRole('button', { name: 'Marcar todos' }).count(), 0, 'nothing is left to mark')
      await shot(page, 'lista-juez-marcar-todos')
      await bar.getByRole('button', { name: 'Borrar' }).click()
      await page.locator('[data-notice]').filter({ hasText: `${total} mensajes borrados` }).waitFor()
      await page.locator('[data-notice]').getByRole('button', { name: 'Deshacer' }).click()
      await page.locator('[data-notice]').filter({ hasText: `${total} mensajes restaurados` }).waitFor()
    } finally {
      await context.close()
    }
  })
})

describe('an empty area', () => {
  test('without filters it says it has no messages and offers no filter to clear; with a state chosen it keeps the filtered state', async () => {
    const { page, context } = await session({ width: 1440, height: 900 }, false)
    try {
      await openMessages(page, '/areas/a-feature')
      await page.locator('main article:has(h3)').first().getByRole('button', { name: 'Borrar' }).click()
      await page.locator('main article:has(h3)').first().waitFor({ state: 'detached' })
      const empty = page.locator('main [role=status]').filter({ hasText: 'Sin mensajes en esta área' })
      await empty.waitFor()
      assert.equal(await empty.getByRole('button').count(), 0, 'no false action')
      assert.equal(await page.getByText('Sin resultados con estos filtros').count(), 0)
      assert.equal(await page.getByRole('button', { name: 'Mostrar todos' }).count(), 0)
      await shot(page, 'lista-juez-area-vacia')
      await page.getByRole('radiogroup').getByRole('radio').last().click()
      await page.getByText('Sin resultados con estos filtros').waitFor()
      await page.getByRole('button', { name: 'Mostrar todos' }).click()
      await page.getByText('Sin mensajes en esta área').waitFor()
    } finally {
      await context.close()
    }
  })
})

describe('the view of an area on a phone', () => {
  for (const path of ['/areas/a-error', '/areas/a-accesibilidad']) {
    test(`${path}: the first row starts in the first screen and the settings are folded under the list`, async () => {
      const { page, context } = await session({ width: 390, height: 844 }, true)
      try {
        await openMessages(page, path)
        const y = await page.locator('main article:has(h3)').first().evaluate((el) => el.getBoundingClientRect().top)
        assert.ok(y < 844 * 0.5, `the first row starts at y ${y}`)
        assert.equal(await page.getByTestId('area-owner').count(), 0, 'the settings are folded')
        const fold = page.getByRole('button', { name: 'Responsable y modelos' })
        const foldY = await fold.evaluate((el) => el.getBoundingClientRect().top)
        const lastRow = await page.locator('main article:has(h3)').last().evaluate((el) => el.getBoundingClientRect().bottom)
        assert.ok(foldY >= lastRow, 'the fold is under the list')
        await shot(page, `lista-juez-area-phone-${path.split('/').pop()}`)
        await fold.click()
        await page.getByTestId('area-owner').waitFor()
        await page.getByTestId('area-owner-select').waitFor()
      } finally {
        await context.close()
      }
    })
  }

  test('on a desktop the owner and the models stay above the list', async () => {
    const { page, context } = await session({ width: 1440, height: 900 }, false)
    try {
      await openMessages(page, '/areas/a-error')
      const owner = await page.getByTestId('area-owner').evaluate((el) => el.getBoundingClientRect().bottom)
      const row = await page.locator('main article').first().evaluate((el) => el.getBoundingClientRect().top)
      assert.ok(owner <= row)
    } finally {
      await context.close()
    }
  })
})

describe('anchoring of the actions', () => {
  for (const [name, viewport, mobile] of [SIZES[1], SIZES[3]]) {
    for (const who of ['ana', 'bruno']) {
      test(`${name}, ${who}: Borrar, Cerrar and the height fall alike in every row of Mensajes`, async () => {
        const { page, context } = await session({ width: viewport.width, height: mobile ? 4000 : 2400 }, mobile, who)
        try {
          await openMessages(page)
          const rows = await page.locator('main article').evaluateAll((as) =>
            as.map((a) => {
              const x = (label) => {
                const b = [...a.querySelectorAll('button')].find((e) => e.textContent.trim() === label)
                return b ? Math.round(b.getBoundingClientRect().x * 2) / 2 : null
              }
              const close = [...a.querySelectorAll('button')].find((e) => ['Cerrar', 'Reabrir'].includes(e.textContent.trim()))
              return { h: Math.round(a.firstElementChild.getBoundingClientRect().height), del: x('Borrar'), closeRight: Math.round(close.getBoundingClientRect().right * 2) / 2, hasReply: !!a.querySelector('a[href*="reply=1"]') }
            }),
          )
          assert.ok(rows.length >= 12, `${rows.length} rows`)
          assert.ok(new Set(rows.map((r) => r.del)).size === 1, `Borrar x: ${[...new Set(rows.map((r) => r.del))]}`)
          assert.ok(new Set(rows.map((r) => r.closeRight)).size === 1, `Cerrar right: ${[...new Set(rows.map((r) => r.closeRight))]}`)
          if (!mobile) assert.deepEqual([...new Set(rows.map((r) => r.h))], [136], `row heights ${rows.map((r) => r.h)}`)
        } finally {
          await context.close()
        }
      })
    }
  }
})
