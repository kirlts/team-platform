// «Enviar como» (UD-255, H-3726) seen from the panel, in a real browser against dev-server.mjs serving panel/dist with
// auto-publication on: `npm run test:flows`. Ana sends as Bruno; the message is Bruno's and its page says who sent it.
import assert from 'node:assert'
import { mkdirSync } from 'node:fs'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

process.env.PANEL_DEV_AUTO_PUBLISH = '1'

let panel
let origin = ''
const SHOTS = process.env.ENVIAR_COMO_SHOTS ?? ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_ENVIAR_COMO_PORT ?? process.env.PANEL_FLOWS_PORT ?? 8962), { stepMs: 80 })
  origin = panel.origin
  if (SHOTS) mkdirSync(SHOTS, { recursive: true })
})

beforeEach(async () => {
  await panel.control.reset()
})

after(async () => {
  await panel?.stop()
})

const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1440, height: 900 }

async function session(who, viewport) {
  const mobile = viewport.width < 768
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL', isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 })
  const page = await context.newPage()
  await login(page, origin, who)
  await page.locator('main').first().waitFor()
  return { page, context }
}

const api = async (page, path) => {
  const res = await page.request.fetch(`${origin}/api${path}`, { headers: { 'x-team-request': 'panel' } })
  return res.json()
}

describe('send as another member (UD-255)', () => {
  for (const [name, viewport] of [['desktop', DESKTOP], ['phone', PHONE]]) {
    test(`${name}: Ana sends as Bruno, the message is Bruno's and its page says it was sent by Ana`, async () => {
      const { page, context } = await session('ana', viewport)
      try {
        const picker = page.getByTestId('compose-send-as')
        await picker.waitFor()
        assert.equal(await picker.inputValue(), 'u-ana', 'the picker starts on the member of the session')
        assert.equal(await page.getByLabel('Enviar como').inputValue(), 'u-ana')
        // On a desk the picker shares the row of «Para», right-aligned and above the tools and the send button (that row does not split when «Para» grows); on a phone it is on a row above the send button.
        const pick = await picker.boundingBox()
        const sendBox = await page.getByTestId('compose-send').boundingBox()
        if (viewport === DESKTOP) {
          const toBox = await page.getByTestId('compose-to').boundingBox()
          assert.ok(Math.abs((pick.y + pick.height / 2) - (toBox.y + toBox.height / 2)) < 12, 'same row as «Para» on a desk')
          assert.ok(pick.y + pick.height <= sendBox.y, 'above the send button on a desk')
        }
        else assert.ok(pick.y + pick.height <= sendBox.y, 'its own row on a phone')
        assert.ok(pick.x >= 0 && pick.x + pick.width <= viewport.width, 'inside the window')
        await settled(page)
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/enviar-como-${viewport.width}x${viewport.height}.png` })

        await picker.selectOption('u-bruno')
        const text = `Revisar la caldera del piso dos (${name})`
        await page.getByLabel('Nuevo mensaje', { exact: true }).last().fill(text)
        await page.getByTestId('compose-send').click()
        // The sender sees their send and its analysis as any other (UD-273): the drawer opens and the tray lists it.
        await page.getByTestId('send-drawer').waitFor()
        const tray = await api(page, '/inputs?mine=1')
        assert.ok(tray.items.some((i) => i.text === text && i.author_id === 'u-bruno' && i.sent_by_id === 'u-ana'), 'the tray of the sender lists what was sent on behalf of someone')

        let message
        for (;;) {
          message = (await api(page, `/messages?q=${encodeURIComponent(text)}`)).items?.[0]
          if (message) break
          await page.waitForResponse((r) => r.url().includes('/api/'))
        }
        assert.equal(message.author_id, 'u-bruno')
        assert.equal(message.sent_by_id, 'u-ana')
        const audit = (await api(page, '/audit?action=input.create')).items.find((a) => a.entity_id === message.input_id)
        assert.equal(audit.member_id, 'u-ana')
        assert.equal(audit.detail.author_id, 'u-bruno')

        await page.goto(`${origin}/messages/${message.id}`)
        const sentBy = page.getByTestId('sent-by')
        await sentBy.waitFor()
        assert.equal((await sentBy.textContent()).trim(), 'enviado por Ana Prueba')
        await settled(page)
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/ficha-enviado-por-${viewport.width}x${viewport.height}.png` })
      } finally {
        await context.close()
      }
    })
  }

  test('a message sent in one\'s own name says nothing about who sent it', async () => {
    const { page, context } = await session('ana', DESKTOP)
    try {
      const text = 'Llamar al proveedor de repuestos'
      await page.getByLabel('Nuevo mensaje', { exact: true }).last().fill(text)
      await page.getByTestId('compose-send').click()
      let message
      for (;;) {
        message = (await api(page, `/messages?q=${encodeURIComponent(text)}`)).items?.[0]
        if (message) break
        await page.waitForResponse((r) => r.url().includes('/api/'))
      }
      assert.equal(message.author_id, 'u-ana')
      await page.goto(`${origin}/messages/${message.id}`)
      await page.getByRole('heading', { level: 1 }).first().waitFor()
      await settled(page)
      assert.equal(await page.getByTestId('sent-by').count(), 0)
    } finally {
      await context.close()
    }
  })
})
