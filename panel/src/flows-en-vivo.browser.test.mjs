// A change made by somebody else reaches the screens that are open without reloading (Martín, 2026-10-24: "I do not want to have to
// reload the page to see updates"). Two sessions against dev-server.mjs, which announces every write as the real server does:
// Bruno has the message and the list open; Carla writes through the API. The waits are for the DOM that the event produces, never for a clock.
// `PANEL_FLOWS_PORT=… node --test src/flows-en-vivo.browser.test.mjs`.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

let panel
let origin = ''
const csrf = { 'x-team-request': 'panel' }

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_PORT ?? 8838), { stepMs: 80 })
  origin = panel.origin
})
beforeEach(async () => {
  await panel.control.reset()
})
after(async () => {
  await panel?.stop()
})

async function session(who) {
  const context = await panel.browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-CL', colorScheme: 'light' })
  const page = await context.newPage()
  await login(page, origin, who)
  return { page, context }
}

async function messageByTitle(page, start) {
  const list = await (await page.request.get(`${origin}/api/messages?q=${encodeURIComponent(start)}`)).json()
  return list.items[0]
}

describe('screens that show data the server changes by itself', () => {
  test('a reply, its edit, its deletion and the closing of the message appear in the open thread without a reload, and the draft and the scroll stay', async () => {
    const bruno = await session('bruno')
    const carla = await session('carla')
    try {
      const message = await messageByTitle(bruno.page, 'Confirmar el formato')
      await bruno.page.goto(`${origin}/messages/${message.id}`)
      await bruno.page.locator('main h1').waitFor()
      await settled(bruno.page)
      await bruno.page.evaluate(() => { window.__same_document = true })
      // Bruno is writing and has scrolled the thread: neither may move.
      const field = bruno.page.getByRole('textbox', { name: 'Respuesta' })
      await field.fill('Esto lo estoy escribiendo y no se pierde')
      const lane = bruno.page.locator('[data-lane="reply-thread"]')
      const before = await lane.evaluate((el) => { el.scrollTop = 0; return { top: el.scrollTop, win: window.scrollY } })
      const rows = bruno.page.locator('section[aria-label="Respuestas"] ol.thread > li')
      const count = await rows.count()

      // 1. A new reply by somebody else, in its place at the end of the thread.
      const sent = await carla.page.request.post(`${origin}/api/messages/${message.id}/replies`, { data: { body: 'Respuesta de Carla en vivo', kind: 'answer' }, headers: csrf })
      assert.equal(sent.status(), 201)
      const reply = (await sent.json()).replies.at(-1)
      await bruno.page.getByText('Respuesta de Carla en vivo').waitFor()
      assert.equal(await rows.count(), count + 1)
      assert.ok((await rows.last().innerText()).includes('Respuesta de Carla en vivo'), 'the new reply is the last of the thread')
      assert.equal(await field.inputValue(), 'Esto lo estoy escribiendo y no se pierde')
      const after1 = await lane.evaluate((el) => ({ top: el.scrollTop, win: window.scrollY }))
      assert.deepEqual(after1, before, 'the scroll did not jump')

      // 2. The edit of that reply.
      const edited = await carla.page.request.patch(`${origin}/api/messages/${message.id}/replies/${reply.id}`, { data: { body: 'Respuesta de Carla editada', version: reply.version }, headers: csrf })
      assert.ok(edited.ok(), `edit answered ${edited.status()}`)
      await bruno.page.getByText('Respuesta de Carla editada').waitFor()
      assert.equal(await bruno.page.getByText('Respuesta de Carla en vivo').count(), 0)

      // 3. Its deletion.
      const gone = await carla.page.request.delete(`${origin}/api/messages/${message.id}/replies/${reply.id}?confirm=true`, { headers: csrf })
      assert.ok(gone.ok(), `delete answered ${gone.status()}`)
      await bruno.page.getByText('Respuesta de Carla editada').waitFor({ state: 'detached' })
      assert.equal(await rows.count(), count)

      // 4. The state of the message.
      const ana = await session('ana') // the sender closes
      const closed = await ana.page.request.post(`${origin}/api/messages/${message.id}/close`, { headers: csrf })
      assert.ok(closed.ok(), `close answered ${closed.status()}`)
      await ana.context.close()
      await bruno.page.locator('section[aria-label="Respuestas"]').getByText('Cerrado').first().waitFor()
      assert.equal(await field.count(), 0, 'a closed message has no reply form')

      assert.equal(await bruno.page.evaluate(() => window.__same_document), true, 'the page was never reloaded')
    } finally {
      await bruno.context.close()
      await carla.context.close()
    }
  })

  test('the draft survives a change that arrives while it is written', async () => {
    const bruno = await session('bruno')
    const carla = await session('carla')
    try {
      const message = await messageByTitle(bruno.page, 'Confirmar el formato')
      await bruno.page.goto(`${origin}/messages/${message.id}`)
      await bruno.page.locator('main h1').waitFor()
      await settled(bruno.page)
      const field = bruno.page.getByRole('textbox', { name: 'Respuesta' })
      await field.click()
      await bruno.page.keyboard.type('Primera mitad ')
      await carla.page.request.post(`${origin}/api/messages/${message.id}/replies`, { data: { body: 'Llega mientras escribís', kind: 'answer' }, headers: csrf })
      await bruno.page.getByText('Llega mientras escribís').waitFor()
      await bruno.page.keyboard.type('segunda mitad')
      assert.equal(await field.inputValue(), 'Primera mitad segunda mitad')
      assert.ok(await field.evaluate((el) => el === document.activeElement), 'the field kept the focus')
    } finally {
      await bruno.context.close()
      await carla.context.close()
    }
  })

  test('the list of messages shows a change of state made by the sender without a reload', async () => {
    const bruno = await session('bruno')
    const carla = await session('carla') // sender of the first message of the list
    try {
      await bruno.page.goto(`${origin}/messages`)
      await bruno.page.locator('main#main').waitFor()
      await settled(bruno.page)
      await bruno.page.evaluate(() => { window.__same_document = true })
      const title = 'Revisar la lectura del panel en teléfonos pequeños'
      const message = await messageByTitle(carla.page, title)
      const card = bruno.page.locator('main').getByText(title).first().locator('xpath=ancestor::*[self::li or self::article][1]')
      await card.waitFor()
      assert.equal(await card.getByText('Respondido').count(), 1)
      const closed = await carla.page.request.post(`${origin}/api/messages/${message.id}/close`, { headers: csrf })
      assert.ok(closed.ok(), `close answered ${closed.status()}`)
      await card.getByText('Cerrado').first().waitFor()
      assert.equal(await bruno.page.evaluate(() => window.__same_document), true, 'the page was never reloaded')
    } finally {
      await bruno.context.close()
      await carla.context.close()
    }
  })
})
