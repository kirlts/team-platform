// Team Platform 1.0, messages zone: what a screenshot showed broken, as prohibitions over every row and every sheet, so the next case
// cannot appear. Real browser against dev-server.mjs: `PANEL_FLOWS_PORT=… node --test src/flows-pulido-mensajes.browser.test.mjs`.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

let panel
let origin = ''
before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_PORT ?? 8847), { stepMs: 80 })
  origin = panel.origin
})
beforeEach(async () => {
  await panel.control.reset()
})
after(async () => {
  await panel?.stop()
})

const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1440, height: 900 }

async function session(viewport, who = 'ana') {
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL', colorScheme: 'light' })
  const page = await context.newPage()
  await login(page, origin, who)
  return { page, context }
}

async function idOf(page, title) {
  return (await (await page.request.get(`${origin}/api/messages?q=${encodeURIComponent(title)}`)).json()).items[0].id
}

/** Every chip of a row either fits or ends in a painted «…» (an inline-flex chip clipped its name mid-letter), and a short area name always fits. */
function clippedChips() {
  const out = []
  for (const el of document.querySelectorAll('[data-testid="area-chip"], .guard-mark')) {
    const r = el.getBoundingClientRect()
    if (!r.width) continue
    const cs = getComputedStyle(el)
    const over = el.scrollWidth > el.clientWidth + 1
    const ellipsisPaints = cs.textOverflow === 'ellipsis' && !cs.display.includes('flex')
    if (over && !ellipsisPaints) out.push(`${el.textContent} (${cs.display}, ${el.scrollWidth}>${el.clientWidth})`)
    // A short area name is never the one cut: «Error» ended as «E…» next to a Guard mark.
    if (over && el.matches('[data-testid="area-chip"]') && el.textContent.trim().length <= 12) out.push(`short area cut: ${el.textContent}`)
  }
  return out
}

/** Initials that overflow their sphere. */
function overflowingInitials() {
  return [...document.querySelectorAll('.orb')].filter((el) => el.getBoundingClientRect().width > 0 && el.scrollWidth > el.clientWidth + 1).map((el) => `${el.textContent} in ${el.clientWidth}px`)
}

describe('Messages zone: rows and sheets do not clip, squeeze or float (Team Platform 1.0)', () => {
  for (const viewport of [PHONE, DESKTOP]) {
    test(`no chip is clipped without «…» and no initials overflow their sphere, in Inicio and Mensajes at ${viewport.width} px`, async () => {
      const { page, context } = await session(viewport)
      try {
        for (const path of ['/', '/messages']) {
          await page.goto(`${origin}${path}`)
          await page.locator('[data-testid="area-chip"]').first().waitFor()
          await settled(page)
          assert.deepEqual(await page.evaluate(clippedChips), [], `${path}: chips clipped without an ellipsis`)
          assert.deepEqual(await page.evaluate(overflowingInitials), [], `${path}: initials wider than their sphere`)
        }
      } finally {
        await context.close()
      }
    })
  }

  test('on a phone the recipients of a row take the whole width: the actions go to a line of their own', async () => {
    const { page, context } = await session(PHONE)
    try {
      await page.goto(`${origin}/messages`)
      await page.locator('[data-testid="card-foot"]').first().waitFor()
      await settled(page)
      const rows = await page.locator('article').evaluateAll((cards) =>
        cards.map((c) => {
          const text = c.querySelector('[data-testid="card-text"]').getBoundingClientRect().width
          const to = c.querySelector('[data-testid="card-foot"] ul')
          return { text, to: to ? to.getBoundingClientRect().width : text }
        }),
      )
      for (const r of rows) assert.ok(r.to >= r.text - 1, `the recipients are ${r.to}px wide in a text column of ${r.text}px`)
      // The «y N más» control of a row is a 44 px target on a phone, and its extra box does not make the row taller.
      const more = await page.locator('article [data-testid="card-foot"] button[aria-label^="Ver los"]').evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) } }))
      assert.ok(more.length > 0, 'a row folds its recipients')
      for (const m of more) assert.ok(m.w >= 44 && m.h >= 44, `the control of the folded recipients is ${m.w}x${m.h} px`)
    } finally {
      await context.close()
    }
  })

  test('on a touch phone no word of the brand breaks and the controls of the bar are still 44 px targets, at 360, 390 and 430 px', async () => {
    for (const width of [360, 390, 430]) {
      const context = await panel.browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, locale: 'es-CL', colorScheme: 'light' })
      const page = await context.newPage()
      try {
        await login(page, origin, 'ana')
        await page.goto(`${origin}/messages`)
        await page.getByTestId('status-bar').waitFor()
        await settled(page)
        const bar = await page.evaluate(() => {
          const mark = document.querySelector('.wordmark')
          const words = []
          const walker = document.createTreeWalker(mark, NodeFilter.SHOW_TEXT)
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            for (const m of n.textContent.matchAll(/\S+/g)) {
              const range = document.createRange()
              range.setStart(n, m.index)
              range.setEnd(n, m.index + m[0].length)
              words.push({ word: m[0], lines: new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size, top: Math.round(range.getClientRects()[0].top) })
            }
          }
          // The touch area of a control: the 44 px square around its center answers to it, which the box alone does not say.
          const targets = [...document.querySelectorAll('[data-testid="bell"], [data-testid="state-button"], [data-testid="brand-link"]')].map((el) => {
            const r = el.getBoundingClientRect()
            const cx = r.x + r.width / 2
            const cy = r.y + r.height / 2
            const corners = [[-21, -21], [21, -21], [-21, 21], [21, 21]].map(([dx, dy]) => el.contains(document.elementFromPoint(cx + dx, cy + dy)))
            return { name: el.getAttribute('aria-label'), corners }
          })
          // J3-D3-01: the name of the instance is not cut (no ellipsis) while the whole brand fits in one line.
          const project = mark.querySelector('.wordmark-project')
          return { words, targets, cut: project ? project.scrollWidth > project.clientWidth : false }
        })
        for (const w of bar.words) assert.equal(w.lines, 1, `«${w.word}» breaks inside the word at ${width} px`)
        assert.ok(bar.words.length >= 2)
        assert.equal(new Set(bar.words.map((w) => w.top)).size, 1, `the brand is on more than one line at ${width} px: ${JSON.stringify(bar.words)}`)
        assert.equal(bar.cut, false, `the name of the instance is cut with an ellipsis at ${width} px`)
        for (const t of bar.targets) assert.ok(t.corners.every(Boolean), `«${t.name}» does not answer to a 44 px square at ${width} px`)
      } finally {
        await context.close()
      }
    }
  })

  test('on a phone the number of a row sits beside its state, never alone on a line, and the thumbnail and the filter options are 44 px targets', async () => {
    const { page, context } = await session(PHONE)
    try {
      await page.goto(`${origin}/messages`)
      await page.locator('[data-testid="card-state"]').first().waitFor()
      await settled(page)
      const rows = await page.locator('article').evaluateAll((cards) =>
        cards.map((c) => {
          const state = c.querySelector('[data-testid="card-state"]')
          const mark = state.firstElementChild.getBoundingClientRect()
          const number = c.querySelector('[data-testid="card-number"]').getBoundingClientRect()
          const thumb = c.querySelector('[data-testid="card-thumb"] button')?.getBoundingClientRect()
          return { top: Math.round(number.top - mark.top), height: Math.round(mark.height), thumb: thumb ? { w: Math.round(thumb.width), h: Math.round(thumb.height) } : null }
        }),
      )
      for (const r of rows) assert.ok(r.top >= -2 && r.top <= r.height, `the number is ${r.top} px under the top of the state (${r.height} px high)`)
      for (const r of rows.filter((x) => x.thumb)) assert.ok(r.thumb.w >= 44 && r.thumb.h >= 44, `the thumbnail is ${r.thumb.w}x${r.thumb.h} px`)
      await page.getByRole('button', { name: /^Filtro/ }).click()
      const items = await page.locator('[role="menuitem"], [role="menuitemcheckbox"]').evaluateAll((els) => els.map((el) => ({ name: el.textContent.trim(), h: Math.round(el.getBoundingClientRect().height), box: !!el.querySelector('span[aria-hidden].border') })))
      assert.ok(items.length >= 5, 'the filter menu lists its filters')
      for (const i of items) assert.ok(i.h >= 44, `«${i.name}» is ${i.h} px high`)
      assert.ok(items.some((i) => i.box), 'the option that is on or off draws its box at rest')
    } finally {
      await context.close()
    }
  })

  test('Cerrar and Reabrir of a row leave the notice with Deshacer, as Borrar does', async () => {
    const { page, context } = await session(DESKTOP)
    try {
      await page.goto(`${origin}/messages`)
      const row = page.locator('article').filter({ hasText: 'Confirmar el formato' })
      await row.waitFor()
      await row.getByRole('button', { name: 'Cerrar', exact: true }).click()
      await page.getByText('Mensaje cerrado').first().waitFor()
      await page.getByRole('button', { name: 'Deshacer' }).first().click()
      await row.getByRole('button', { name: 'Cerrar', exact: true }).waitFor()
      await row.getByRole('button', { name: 'Cerrar', exact: true }).click()
      await row.getByRole('button', { name: 'Reabrir', exact: true }).waitFor()
      await row.getByRole('button', { name: 'Reabrir', exact: true }).click()
      await page.getByText('Mensaje reabierto').first().waitFor()
    } finally {
      await context.close()
    }
  })

  test('on a phone the title of a message takes the width of the sheet, not the space left by the reply count', async () => {
    const { page, context } = await session(PHONE)
    try {
      await page.goto(`${origin}/messages/${await idOf(page, 'Revisar la lectura')}`)
      await page.locator('main h1').waitFor()
      await settled(page)
      const { h1, main } = await page.evaluate(() => ({ h1: document.querySelector('main h1').getBoundingClientRect().width, main: document.querySelector('main').getBoundingClientRect().width }))
      assert.ok(h1 >= main * 0.7, `the title is ${h1}px wide in a sheet of ${main}px`)
    } finally {
      await context.close()
    }
  })

  for (const viewport of [PHONE, DESKTOP]) {
    test(`in the thread, the delete button stays on the line of the name and a named attachment keeps its name on at most two lines at ${viewport.width} px`, async () => {
      const { page, context } = await session(viewport, 'ana')
      try {
        await page.goto(`${origin}/messages/${await idOf(page, 'Revisar la lectura')}`)
        await page.locator('[data-testid="reply-head"]').first().waitFor()
        await settled(page)
        const heads = await page.locator('[data-testid="reply-head"]').evaluateAll((hs) =>
          hs.map((h) => {
            const name = h.querySelector('[data-repeat-ok="person"]').getBoundingClientRect()
            const del = h.querySelector('button')?.getBoundingClientRect()
            return del ? Math.abs(del.top + del.height / 2 - (name.top + Math.min(name.height, 24) / 2)) : 0
          }),
        )
        for (const d of heads) assert.ok(d <= 8, `the delete button is ${d}px off the line of the name`)
        const captions = await page.locator('section li button span.text-xs, section li a span.text-xs').evaluateAll((spans) => spans.map((s) => ({ text: s.textContent, lines: Math.round(s.getBoundingClientRect().height / parseFloat(getComputedStyle(s).lineHeight)) })))
        for (const c of captions) assert.ok(c.lines <= 2, `«${c.text}» takes ${c.lines} lines`)
      } finally {
        await context.close()
      }
    })
  }

  test('a slide of the gallery is exactly as wide as its viewer: no edge of the next one shows', async () => {
    const { page, context } = await session(DESKTOP)
    try {
      await page.goto(`${origin}/messages/${await idOf(page, 'Revisar la lectura')}`)
      await page.locator('[data-gallery-viewer]').waitFor()
      await settled(page)
      const { client, slide } = await page.locator('[data-gallery-viewer]').evaluate((v) => ({ client: v.clientWidth, slide: v.firstElementChild.getBoundingClientRect().width }))
      assert.ok(Math.abs(client - slide) <= 1, `the viewer shows ${client}px and a slide is ${slide}px wide`)
    } finally {
      await context.close()
    }
  })

  test('the author sees an empty required field as a dashed box with no «Completar», and the «+» square shares its row with the microphone', async () => {
    const { page, context } = await session(DESKTOP)
    try {
      await page.goto(`${origin}/messages/${await idOf(page, 'Confirmar el formato')}`)
      await page.locator('[data-testid="detail-add-row"]').waitFor()
      await settled(page)
      assert.doesNotMatch(await page.locator('[data-lane="message-column"]').innerText(), /Completar/)
      const row = page.locator('[data-testid="detail-add-row"]')
      const [tile, mic] = await Promise.all([row.locator('[data-gallery-add]').boundingBox(), row.getByRole('button', { name: /Grabar audio/ }).boundingBox()])
      assert.ok(tile && mic && Math.abs(tile.y + tile.height / 2 - (mic.y + mic.height / 2)) <= 4, 'the «+» square and «Grabar audio» are on one row')
    } finally {
      await context.close()
    }
  })

  test('a text box grows with its text and draws no resize grip', async () => {
    const { page, context } = await session(DESKTOP, 'bruno')
    try {
      await page.goto(`${origin}/messages/${await idOf(page, 'Confirmar el formato')}`)
      const field = page.locator('#reply-field')
      await field.waitFor()
      assert.equal(await field.evaluate((el) => getComputedStyle(el).resize), 'none')
      const before = (await field.boundingBox()).height
      await field.fill(Array.from({ length: 6 }, (_, i) => `Línea ${i + 1}`).join('\n'))
      await settled(page)
      assert.ok((await field.boundingBox()).height > before + 20, 'the reply field grows with six lines')
    } finally {
      await context.close()
    }
  })

  for (const [viewport, high] of [[PHONE, 44], [DESKTOP, 40]]) {
    test(`the search field of Mensajes is ${high} px tall at ${viewport.width} px (J3-D3-02)`, async () => {
      const { page, context } = await session(viewport)
      try {
        await page.goto(`${origin}/messages`)
        const box = await page.getByRole('searchbox').first().boundingBox()
        assert.ok(Math.round(box.height) === high, `the search field is ${box.height} px tall`)
      } finally {
        await context.close()
      }
    })
  }

  test('the pulse of the bar follows the round shape of the marks, and the target of the brand is 44 px (J3-D3-04, J3-D3-06)', async () => {
    const { page, context } = await session(PHONE)
    try {
      await page.goto(`${origin}/messages`)
      await page.getByTestId('status-bar').waitFor()
      const radius = await page.getByTestId('status-bar').evaluate((el) => getComputedStyle(el).borderTopLeftRadius)
      assert.notEqual(radius, '0px', 'the element that pulses has square corners')
      const brand = await page.getByTestId('brand-link').evaluate((el) => parseFloat(getComputedStyle(el, '::after').height))
      assert.ok(brand >= 44, `the touch area of the brand is ${brand} px high`)
    } finally {
      await context.close()
    }
  })

  test('on a phone the target of the folded recipients is not covered by the actions of its row (J3-D3-05)', async () => {
    const { page, context } = await session(PHONE)
    try {
      await page.goto(`${origin}/messages`)
      await page.locator('article [data-testid="card-foot"] button[aria-label^="Ver los"]').first().waitFor()
      await settled(page)
      const hits = await page.locator('article [data-testid="card-foot"] button[aria-label^="Ver los"]').evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect()
          const cx = r.x + r.width / 2
          const corners = [[-21, -21], [21, -21], [-21, 21], [21, 21]].map(([dx, dy]) => el.contains(document.elementFromPoint(cx + dx, r.y + r.height / 2 + dy)))
          return corners.every(Boolean)
        }),
      )
      assert.ok(hits.length > 0 && hits.every(Boolean), `a 44 px square around the control is covered: ${JSON.stringify(hits)}`)
    } finally {
      await context.close()
    }
  })

  test('the waiting rows of Mensajes are as tall as the rows that arrive (J3-D3-03)', async () => {
    const { page, context } = await session(PHONE)
    try {
      // The list is held on the wire until the waiting rows are measured: an event, not a wait.
      let release
      const held = new Promise((resolve) => { release = resolve })
      await page.route('**/api/messages**', async (route) => { await held; await route.continue() })
      await page.goto(`${origin}/messages`, { waitUntil: 'commit' })
      await page.getByTestId('load-row').first().waitFor()
      const waiting = await page.getByTestId('load-row').first().evaluate((el) => el.getBoundingClientRect().height)
      release()
      await page.locator('article').first().waitFor()
      const real = await page.locator('article').first().evaluate((el) => el.getBoundingClientRect().height)
      assert.ok(Math.abs(waiting - real) <= 6, `a waiting row is ${waiting} px and a row of the list ${real} px`)
    } finally {
      await context.close()
    }
  })
})
