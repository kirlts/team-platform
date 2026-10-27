// The entry and Inicio after the judge of 2026-10-27 (I1, I3 to I7, E3), in a real browser against dev-server.mjs with publication by hand, so a send ends in a
// proposal to review: `node scripts/browser-tests.mjs src/flows-inicio-revision.browser.test.mjs`. Every test can fail if the defect it names comes back.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

process.env.PANEL_DEV_AUTO_PUBLISH = '0'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_INICIO_REVISION_PORT ?? 9209), { stepMs: 80 })
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
const THREE = 'Corregir el desalineado del sidebar en la vista dashboard.\n\nAgregar la sincronización con WhatsApp en el sidebar.\n\nPregunta: ¿el audio máximo sigue en 25 MB?'

async function session(who = 'bruno', viewport = DESKTOP) {
  const mobile = viewport.width < 768
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL', colorScheme: 'light', isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 })
  const page = await context.newPage()
  await login(page, origin, who)
  await page.locator('main').first().waitFor()
  return { page, context }
}

const bar = (page) => page.getByLabel('Nuevo mensaje', { exact: true }).last()
async function sendAndReview(page, text = THREE) {
  await bar(page).fill(text)
  await page.getByRole('button', { name: 'Enviar' }).first().click()
  // The messages of a proposal start folded (UD-257): the first one is opened, as a person does before editing or removing it.
  await page.getByRole('button', { name: /^Abrir el mensaje 1:/ }).click({ timeout: 30000 })
  await page.getByRole('button', { name: /^Área:/ }).first().waitFor()
}

const apart = (a, b) => a.x + a.width <= b.x + 0.5 || b.x + b.width <= a.x + 0.5 || a.y + a.height <= b.y + 0.5 || b.y + b.height <= a.y + 0.5

describe('the proposal block (I1, I4, I5)', () => {
  test('on a phone the title of the analysis, its marks and «Volver a analizar» do not overlap, with or without the history (I1)', async () => {
    const { page, context } = await session('bruno', PHONE)
    try {
      await sendAndReview(page)
      const region = page.getByRole('region', { name: 'Análisis' })
      const parts = [region.getByRole('heading', { name: 'Análisis' }), region.getByRole('button', { name: 'Volver a analizar' })]
      const boxes = []
      for (const part of parts) boxes.push(await part.boundingBox())
      assert.ok(apart(boxes[0], boxes[1]), `«Análisis» ${JSON.stringify(boxes[0])} is drawn over «Volver a analizar» ${JSON.stringify(boxes[1])}`)
      const frame = await region.boundingBox()
      for (const box of boxes) assert.ok(box.x >= frame.x - 0.5 && box.x + box.width <= frame.x + frame.width + 0.5, 'a part of the header leaves the box of the analysis')
      // With a change made the history joins the row: it still overlaps nothing.
      await page.getByRole('button', { name: /^Quitar el mensaje/ }).first().click()
      await page.getByRole('button', { name: 'Deshacer' }).first().waitFor()
      const undo = await region.getByRole('button', { name: 'Deshacer' }).first().boundingBox()
      const again = await region.getByRole('button', { name: 'Volver a analizar' }).boundingBox()
      const title = await region.getByRole('heading', { name: 'Análisis' }).boundingBox()
      assert.ok(apart(undo, again) && apart(title, again) && apart(title, undo), 'the history, the title and «Volver a analizar» overlap')
    } finally {
      await context.close()
    }
  })

  test('a proposal has one way out of the send, «Descartar envío», and «Enviar N mensajes» is the gel button that stays on one line at the right edge (I4, I5)', async () => {
    for (const viewport of [DESKTOP, PHONE]) {
      const { page, context } = await session('bruno', viewport)
      try {
        await sendAndReview(page)
        const region = page.getByRole('region', { name: 'Análisis' })
        assert.equal(await region.getByRole('button', { name: /^Borrar/ }).count(), 0, `a second red way out beside «Descartar envío» (${viewport.width} px)`)
        await region.getByRole('button', { name: 'Descartar envío' }).first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
        assert.equal(await region.getByRole('button', { name: 'Descartar envío' }).count(), 1)
        const send = region.getByRole('button', { name: 'Enviar 3 mensajes', exact: true })
        assert.match(await send.getAttribute('class'), /btn-gel/, 'the action the screen asks for is the gel')
        const box = await send.boundingBox()
        const line = await send.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight) || 20)
        assert.ok(box.height < line * 2 + 16, `«Enviar 3 mensajes» is split over two lines: ${box.height} px high`)
        const actions = await region.locator('[data-actions]').boundingBox()
        assert.ok(actions.x + actions.width - (box.x + box.width) <= 24, `«Enviar 3 mensajes» is ${actions.x + actions.width - (box.x + box.width)} px from the right edge (${viewport.width} px)`)
        // The bar of text waits as glass while it is empty, so the gel is only the one of the proposal; with something to send it is the gel again.
        const compose = page.getByTestId('compose-send')
        assert.match(await compose.getAttribute('class'), /btn-glass/, 'two gel buttons in the view')
        await bar(page).fill('Otra cosa para enviar')
        assert.match(await compose.getAttribute('class'), /btn-gel/, 'with text to send the bar is the action of the screen')
      } finally {
        await context.close()
      }
    }
  })

  test('the part of the text without a message has a name that says what it holds and opens a list (I6)', async () => {
    const { page, context } = await session('bruno')
    try {
      await sendAndReview(page, 'Primera idea para el equipo.\n\nSegunda idea para el equipo.')
      await page.getByRole('button', { name: /^Quitar el mensaje/ }).first().click()
      const trigger = page.getByRole('button', { name: /^Texto sin mensaje/ })
      await trigger.waitFor()
      assert.equal(await page.getByText('Partes sin mensaje').count(), 0, 'the old name is gone')
      await trigger.locator('svg').first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
      assert.equal(await trigger.locator('svg').count(), 1, 'a mark says it opens something')
    } finally {
      await context.close()
    }
  })
})

describe('Inicio on a phone (I3)', () => {
  test('what a finger presses in the lists is at least 44 px: the filters, the pager, the thumbnails and the rest of the recipients', async () => {
    const { page, context } = await session('bruno', PHONE)
    try {
      await settled(page)
      const small = await page.evaluate(() => {
        const names = []
        const pick = (el) => (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40)
        for (const el of document.querySelectorAll('main button, main [role="radio"]')) {
          if (!el.closest('section[aria-label^="Últimos"], section[aria-label^="Últimas"]')) continue
          const r = el.getBoundingClientRect()
          if (r.width === 0 || r.height === 0) continue
          if (r.width < 43.5 || r.height < 43.5) names.push(`${r.width.toFixed(0)}x${r.height.toFixed(0)} ${pick(el)}`)
        }
        return names
      })
      assert.deepEqual(small, [], `targets under 44 px in the lists: ${small.join(' | ')}`)
    } finally {
      await context.close()
    }
  })

  test('the filter keeps the height of its row on a phone: the bigger buttons do not make the list header taller', async () => {
    const desktop = await session('bruno', DESKTOP)
    const phone = await session('bruno', PHONE)
    try {
      const heights = []
      for (const { page } of [desktop, phone]) {
        const header = page.getByRole('region', { name: 'Últimos mensajes' }).locator('div').first()
        await header.waitFor()
        heights.push((await header.boundingBox()).height)
      }
      assert.ok(Math.abs(heights[1] - heights[0]) <= 2, `the header of the list is ${heights[0]} px on a desktop and ${heights[1]} px on a phone`)
    } finally {
      await desktop.context.close()
      await phone.context.close()
    }
  })
})

describe('Inicio when the lists do not load (I7)', () => {
  test('both lists failing say it once, with one Reintentar that asks for both', async () => {
    const { page, context } = await session('bruno', DESKTOP)
    try {
      let refused = true
      await page.route(/\/api\/messages(\?|$)/, (route) => (refused ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'unavailable', message: 'El servidor no responde' }) }) : route.continue()))
      await page.reload()
      await page.locator('main#main').waitFor()
      const retry = page.locator('main').getByRole('button', { name: 'Reintentar' })
      await retry.first().waitFor({ timeout: 20000 })
      await retry.first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
      assert.equal(await retry.count(), 1, 'one Reintentar for the two lists')
      await page.locator('main').getByRole('alert').first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
      assert.equal(await page.locator('main').getByRole('alert').count(), 1, 'the failure is said once')
      refused = false
      await retry.click()
      await page.getByRole('region', { name: 'Últimos mensajes' }).waitFor({ timeout: 20000 })
      await page.getByRole('region', { name: 'Últimas respuestas' }).waitFor()
      assert.equal(await page.locator('main').getByRole('button', { name: 'Reintentar' }).count(), 0)
    } finally {
      await context.close()
    }
  })
})
