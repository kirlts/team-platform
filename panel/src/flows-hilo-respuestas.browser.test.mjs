// The replies of a message are one thread: every reply under the one before it, in order, with no pager; past the limit the first one and the
// last ones show and a control opens the hidden ones; the last reply is set apart; the form sits under the thread and there is no type selector.
// Real browser against dev-server.mjs serving panel/dist: `PANEL_FLOWS_PORT=… node --test src/flows-hilo-respuestas.browser.test.mjs`.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

let panel
let origin = ''
const csrf = { 'x-team-request': 'panel' }

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_PORT ?? 8808), { stepMs: 80 })
  origin = panel.origin
})
beforeEach(async () => {
  await panel.control.reset()
})
after(async () => {
  await panel?.stop()
})

async function session(who, viewport) {
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL', colorScheme: 'light' })
  const page = await context.newPage()
  await login(page, origin, who)
  return { page, context }
}

/** Adds `n` replies to the message with that title, each by someone who is not its sender, and opens it. */
async function openWithReplies(page, titleStart, n) {
  const list = await (await page.request.get(`${origin}/api/messages?q=${encodeURIComponent(titleStart)}`)).json()
  const message = list.items[0]
  for (let i = 0; i < n; i++) {
    await page.request.post(`${origin}/api/messages/${message.id}/replies`, { data: { body: `Respuesta número ${i + 1}`, kind: 'answer' }, headers: csrf })
  }
  await page.goto(`${origin}/messages/${message.id}`)
  await page.locator('main h1').waitFor()
  await settled(page)
}

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAKAAAABkCAIAAACO1KzYAAABAklEQVR4nO3RUQkAIBTAwNc/md82sIkpRBgHF2CwWfsQNt8LeMrgOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjDI4zOM7gOIPjLsouEJb933CqAAAAAElFTkSuQmCC'

const thread = (page) => page.locator('section[aria-label="Respuestas"] ol.thread > li')

describe('the thread of replies', () => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    test(`two replies show together, in order, with no pager and no type selector at ${viewport.width} px`, async () => {
      const { page, context } = await session('bruno', viewport)
      try {
        await openWithReplies(page, 'Confirmar el formato', 1) // it has one; this adds the second
        await thread(page).first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
        assert.equal(await thread(page).count(), 2)
        const [a, b] = await Promise.all([thread(page).nth(0).boundingBox(), thread(page).nth(1).boundingBox()])
        assert.ok(b.y > a.y + a.height - 1, 'the second reply is under the first')
        assert.equal(await page.getByText(/\d–\d de \d/).count(), 0, 'no pager')
        assert.equal(await page.getByRole('radiogroup').count(), 0, 'no type selector')
        const form = await page.getByRole('textbox', { name: 'Respuesta' }).boundingBox()
        assert.ok(form.y > b.y, 'the form is under the thread')
      } finally {
        await context.close()
      }
    })

    test(`eight replies fold the middle ones behind a count that opens them, and the last one is set apart at ${viewport.width} px`, async () => {
      const { page, context } = await session('bruno', viewport)
      try {
        await openWithReplies(page, 'Revisar el tiempo', 8)
        await thread(page).first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
        assert.equal(await thread(page).count(), 5, 'the first, the control and the last three')
        const more = page.getByRole('button', { name: '4 respuestas más' })
        await more.waitFor()
        assert.ok((await page.locator('section[aria-label="Respuestas"]').innerText()).includes('Respuesta número 1'))
        assert.ok(!(await page.locator('section[aria-label="Respuestas"]').innerText()).includes('Respuesta número 2'))
        const surface = (i) => thread(page).nth(i).locator('article').evaluate((el) => ({ shadow: getComputedStyle(el).boxShadow, size: getComputedStyle(el.querySelector('p, [data-editable]') ?? el).fontSize }))
        const [quiet, last] = [await surface(2), await surface(4)]
        assert.ok(last.shadow !== 'none' || quiet.shadow === 'none', 'the last reply is lifted over the earlier ones')
        assert.ok(parseFloat(last.size) >= parseFloat(quiet.size), 'the last reply is not smaller')
        await more.click()
        await thread(page).first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
        assert.equal(await thread(page).count(), 8)
        assert.equal(await page.getByRole('button', { name: /respuestas más/ }).count(), 0)
        const ys = await thread(page).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().y))
        assert.deepEqual(ys, [...ys].sort((x, y) => x - y), 'in order')
      } finally {
        await context.close()
      }
    })
  }

  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    test(`the before and the after are open, big and labeled, with the Markdown drawn, at ${viewport.width} px`, async () => {
      const { page, context } = await session('bruno', viewport)
      try {
        await openWithReplies(page, 'Corregir el contraste', 0)
        const sent = await page.evaluate(async (png) => {
          const blob = () => new Blob([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], { type: 'image/png' })
          const form = new FormData()
          form.append('body', '**Antes**: botón sin contraste.\n**Después**: contraste de 7:1.\n\n- Fondo más claro')
          form.append('kind', 'answer')
          form.append('files', blob(), 'Antes - Botón sin contraste.png')
          form.append('files', blob(), 'Después - Botón con contraste.png')
          const res = await fetch(location.pathname.replace(/\/messages\/.*/, '') + location.pathname.replace(/^.*(\/messages\/[^/]+).*$/, '/api$1/replies'), { method: 'POST', headers: { 'x-team-request': 'panel' }, body: form })
          return res.status
        }, PNG)
        assert.ok(sent < 300, `reply sent: ${sent}`)
        await page.reload()
        await page.locator('section[aria-label="Respuestas"] ul[aria-label="Adjuntos"] img').first().waitFor()
        await settled(page)
        const imgs = page.locator('section[aria-label="Respuestas"] ul[aria-label="Adjuntos"] img')
        await imgs.first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
        assert.equal(await imgs.count(), 2)
        const [a, b, card] = await Promise.all([imgs.nth(0).boundingBox(), imgs.nth(1).boundingBox(), imgs.nth(0).locator('xpath=ancestor::article').boundingBox()])
        // UD-309: the thread is the narrow column (at most 28 rem) at every width, so the two images always go one under the other.
        assert.ok(b.y > a.y + a.height - 1, 'one under the other')
        assert.ok(a.width >= card.width * 0.8, `each is ${a.width} px of ${card.width}`)
        const text = await page.locator('section[aria-label="Respuestas"]').innerText()
        assert.ok(/ANTES/i.test(text) && /DESPUÉS/i.test(text), 'the short labels')
        assert.ok(!text.includes('.png'), 'no file name')
        assert.ok(!text.includes('**'), 'no raw asterisks')
        await page.locator('section[aria-label="Respuestas"] strong', { hasText: 'Antes' }).first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
        assert.equal(await page.locator('section[aria-label="Respuestas"] strong', { hasText: 'Antes' }).count(), 1, 'bold is drawn')
        await imgs.nth(0).click()
        await page.getByRole('dialog').waitFor()
      } finally {
        await context.close()
      }
    })
  }
})
