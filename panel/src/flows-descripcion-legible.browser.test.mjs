// UD-299: the description of a message, of an area, of a template and the profile of a member are read whole, as text, at the height
// they need. None of them is a box of one line with a scroll of its own. Each test runs in a real browser against dev-server.mjs:
// `PANEL_FLOWS_PORT=… node --test src/flows-descripcion-legible.browser.test.mjs`.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_PORT ?? 8842), { stepMs: 80 })
  origin = panel.origin
})
beforeEach(async () => {
  await panel.control.reset()
})
after(async () => {
  await panel?.stop()
})

const LINES = 8
const BODY = Array.from({ length: LINES }, (_, i) => `Línea ${i + 1}: una persona lo menciona como uno más de una serie de pedidos que llegan por voz y por foto.`).join('\n')
const LONG = Array.from({ length: 1024 / 64 }, (_, i) => `Frase ${i + 1} de la descripción larga.`.padEnd(63, ' x')).join(' ').slice(0, 1024)

async function session(viewport, colorScheme = 'light', who = 'ana') {
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL', colorScheme })
  const page = await context.newPage()
  await login(page, origin, who)
  return { page, context }
}

/** The message detail with an eight-line body and six attachments: the gallery and the folds take the room the text used to be left with. */
async function openCrowdedMessage(page) {
  await page.route(/\/api\/messages\/\d+$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const res = await route.fetch()
    const json = await res.json()
    const base = json.attachments?.[0]
    if (base) json.attachments = Array.from({ length: 6 }, (_, k) => ({ ...base, id: k ? `${base.id}~${k}` : base.id }))
    json.body = BODY
    await route.fulfill({ response: res, json })
  })
  // Carla wrote this one: the author edits the text in place.
  const all = await (await page.request.get(`${origin}/api/messages?q=${encodeURIComponent('Corregir el contraste')}`)).json()
  const hit = all.items[0]
  await page.goto(`${origin}/messages/${hit.id}`)
  await page.locator('main h1').waitFor()
  await page.locator('[data-message-body]').waitFor()
  await settled(page)
}

/** Boxes between the element and `main` that scroll by themselves on the vertical axis. */
const scrollingAncestors = (page, selector) =>
  page.locator(selector).first().evaluate((el) => {
    const found = []
    for (let n = el.parentElement; n && n.tagName !== 'MAIN'; n = n.parentElement) {
      const y = getComputedStyle(n).overflowY
      if ((y === 'auto' || y === 'scroll' || y === 'hidden') && n.scrollHeight > n.clientHeight) found.push(n.getAttribute('data-lane') ?? n.tagName)
    }
    return found
  })

describe('the description of a message is read whole (UD-299)', () => {
  for (const [width, height] of [[1440, 900], [1280, 720], [390, 844]]) {
    for (const scheme of ['light', 'dark']) {
      test(`${LINES} lines show whole with six attachments at ${width}x${height}, ${scheme}`, async () => {
        const { page, context } = await session({ width, height }, scheme, 'carla')
        try {
          await openCrowdedMessage(page)
          const body = await page.locator('[data-message-body]').evaluate((el) => {
            const text = el.querySelector('[data-editable]')
            const line = parseFloat(getComputedStyle(text).lineHeight)
            return { height: text.getBoundingClientRect().height, line, scroll: el.scrollHeight, client: el.clientHeight, overflow: getComputedStyle(el).overflowY }
          })
          assert.ok(body.height >= LINES * body.line - 1, `the text measures ${body.height} px for ${LINES} lines of ${body.line} px: it is cut`)
          assert.equal(body.scroll, body.client, 'the text block has no scroll of its own')
          assert.equal(body.overflow, 'visible', 'and does not hide what overflows')
          // The only box that scrolls is the column, and from its end the last line is in view.
          assert.deepEqual(await scrollingAncestors(page, '[data-message-body] [data-editable][aria-label^="Texto"]'), width >= 768 ? ['message-column'] : [], 'what scrolls around the text')
          await page.locator('[data-message-body] [data-editable][aria-label^="Texto"]').evaluate((el) => el.scrollIntoView({ block: 'end' }))
          const edge = await page.locator('[data-message-body] [data-editable][aria-label^="Texto"]').evaluate((el) => {
            const box = el.getBoundingClientRect()
            const lane = el.closest('[data-lane="message-column"]')
            const bottom = lane && lane.scrollHeight > lane.clientHeight ? lane.getBoundingClientRect().bottom : innerHeight
            return { box: box.bottom, bottom }
          })
          assert.ok(edge.box <= edge.bottom + 1, `the last line ends at ${edge.box} and the region at ${edge.bottom}`)
        } finally {
          await context.close()
        }
      })
    }
  }

  test('a click opens a field that grows with the text, with no handle and no scroll, and leaving gives the text back', async () => {
    const { page, context } = await session({ width: 1440, height: 900 }, 'dark', 'carla')
    try {
      await openCrowdedMessage(page)
      await page.locator('[data-message-body] [data-editable][aria-label^="Texto"]').first().click()
      const field = page.locator('[data-message-body] textarea')
      await field.waitFor()
      const box = await field.evaluate((el) => ({ resize: getComputedStyle(el).resize, scroll: el.scrollHeight, client: el.clientHeight, height: el.getBoundingClientRect().height, line: parseFloat(getComputedStyle(el).lineHeight) }))
      assert.equal(box.resize, 'none', 'no resize handle')
      assert.ok(box.scroll <= box.client + 1, `the field scrolls: ${box.scroll} in ${box.client}`)
      assert.ok(box.height >= LINES * box.line, `the field measures ${box.height} px for ${LINES} lines`)
      await page.keyboard.press('Escape')
      await page.locator('[data-message-body] [data-editable][aria-label^="Texto"]').first().waitFor()
      assert.equal(await page.locator('[data-message-body] textarea').count(), 0, 'it is text again')
    } finally {
      await context.close()
    }
  })
})

describe('the same piece in the other screens (UD-299)', () => {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    test(`the description of an area of 1024 characters has no box with a scroll at ${width}x${height}`, async () => {
      const { page, context } = await session({ width, height })
      try {
        await page.route(/\/api\/areas(\/a-error)?$/, async (route) => {
          if (route.request().method() !== 'GET') return route.continue()
          const res = await route.fetch()
          const json = await res.json()
          const put = (a) => (a.id === 'a-error' ? { ...a, description: LONG } : a)
          await route.fulfill({ response: res, json: Array.isArray(json) ? json.map(put) : json.items ? { ...json, items: json.items.map(put) } : put(json) })
        })
        await page.goto(`${origin}/areas/a-error`)
        await page.locator('main article').first().waitFor()
        await page.getByRole('button', { name: 'Descripción', exact: true }).click()
        const text = page.getByText(/^Frase 1 de la descripción larga/).first()
        await text.waitFor()
        await settled(page)
        const height = await text.evaluate((el) => el.getBoundingClientRect().height)
        const line = await text.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight))
        assert.ok(height >= (LONG.length / 90) * line * 0.5, `the description measures ${height} px`)
        assert.deepEqual(await scrollingAncestors(page, '[data-editable][aria-label^="Descripción"]'), [], 'nothing around the description scrolls by itself')
        assert.equal(await page.locator('[data-lane="area-description"]').count(), 0)
      } finally {
        await context.close()
      }
    })
  }
})
