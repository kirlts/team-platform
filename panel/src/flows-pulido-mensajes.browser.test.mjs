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

/** Every chip of a row either fits or ends in a painted «…»: an inline-flex chip clipped its name mid-letter with no ellipsis. */
function clippedChips() {
  const out = []
  for (const el of document.querySelectorAll('[data-testid="area-chip"], .guard-mark')) {
    const r = el.getBoundingClientRect()
    if (!r.width) continue
    const cs = getComputedStyle(el)
    const over = el.scrollWidth > el.clientWidth + 1
    const ellipsisPaints = cs.textOverflow === 'ellipsis' && !cs.display.includes('flex')
    if (over && !ellipsisPaints) out.push(`${el.textContent} (${cs.display}, ${el.scrollWidth}>${el.clientWidth})`)
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
})
