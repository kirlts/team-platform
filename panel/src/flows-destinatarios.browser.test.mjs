// «Para» in the new message bar (UD-291) seen from the panel, in a real browser against dev-server.mjs serving panel/dist with
// auto-publication on: `npm run test:flows`. Choosing Claude and sending leaves the message assigned to Claude with its work running;
// taking every recipient out sends it to the automatic routing again.
import assert from 'node:assert'
import { mkdirSync } from 'node:fs'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

process.env.PANEL_DEV_AUTO_PUBLISH = '1'

let panel
let origin = ''
const SHOTS = process.env.DESTINATARIOS_SHOTS ?? ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_DESTINATARIOS_PORT ?? process.env.PANEL_FLOWS_PORT ?? 8964), { stepMs: 80 })
  origin = panel.origin
  if (SHOTS) mkdirSync(SHOTS, { recursive: true })
})

beforeEach(async () => {
  await panel.control.reset()
  await panel.control.execution() // adds Claude, the member of kind agent
})

after(async () => {
  await panel?.stop()
})

const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1440, height: 900 }

async function session(viewport) {
  const mobile = viewport.width < 768
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL', isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 })
  const page = await context.newPage()
  await login(page, origin, 'ana')
  await page.locator('main').first().waitFor()
  return { page, context }
}

const api = async (page, path) => (await page.request.fetch(`${origin}/api${path}`, { headers: { 'x-team-request': 'panel' } })).json()

async function messageOf(page, text) {
  for (;;) {
    const message = (await api(page, `/messages?q=${encodeURIComponent(text)}`)).items?.[0]
    if (message) return message
    await page.waitForResponse((r) => r.url().includes('/api/'))
  }
}

describe('«Para» in the new message bar (UD-291)', () => {
  for (const [name, viewport] of [['desktop', DESKTOP], ['phone', PHONE]]) {
    test(`${name}: choosing Claude and sending assigns the message to Claude and starts its work; removing it goes back to the automatic routing`, async () => {
      const { page, context } = await session(viewport)
      try {
        const to = page.getByTestId('compose-to')
        await to.waitFor()
        assert.equal((await to.innerText()).trim(), 'Para', 'empty: only the word')
        const field = page.getByLabel('Nuevo mensaje', { exact: true }).last()
        const text = `Corregir el espacio de la tabla (${name})`
        await field.fill(text)
        await to.getByRole('button', { name: 'Para' }).click()
        await page.getByRole('option', { name: 'Claude' }).click()
        await page.keyboard.press('Escape')
        const chip = to.getByRole('listitem').filter({ hasText: 'Claude' })
        await chip.waitFor()
        const box = await to.boundingBox()
        assert.ok(box.x >= 0 && box.x + box.width <= viewport.width, 'inside the window')
        await settled(page)
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/para-claude-${viewport.width}x${viewport.height}.png` })
        await page.getByTestId('compose-send').click()
        const message = await messageOf(page, text)
        assert.deepEqual(message.assignee_ids, ['u-claude'])
        assert.equal((await to.innerText()).trim(), 'Para', 'the bar is empty again after sending')
        const timing = await api(page, `/messages/${message.id}/timing`)
        assert.equal(timing.job_status, 'running', 'Claude has its work in course, with no second confirmation')
        const jobs = await api(page, '/jobs?kind=execute')
        assert.ok((jobs.items ?? []).some((j) => j.message_id === message.id), 'an execute job exists for the message')
        await page.goto(`${origin}/messages/${message.id}`)
        await page.getByRole('heading', { level: 1 }).first().waitFor()
        await settled(page)
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/ficha-claude-${viewport.width}x${viewport.height}.png` })

        // The same, but the recipient is taken out before sending: nobody chosen, the automatic routing assigns.
        await page.goto(`${origin}/`)
        await to.waitFor()
        const second = `Otro texto sin destinatarios (${name})`
        await page.getByLabel('Nuevo mensaje', { exact: true }).last().fill(second)
        await to.getByRole('button', { name: 'Para' }).click()
        await page.getByRole('option', { name: 'Claude' }).click()
        await page.keyboard.press('Escape')
        await chip.waitFor()
        await to.getByRole('button', { name: 'Quitar a Claude' }).click()
        await chip.waitFor({ state: 'detached' })
        await page.getByTestId('compose-send').click()
        const routed = await messageOf(page, second)
        assert.ok(routed.assignee_ids.length > 0 && !routed.assignee_ids.includes('u-claude'), `routed by the system: ${routed.assignee_ids}`)
        assert.equal((await api(page, `/messages/${routed.id}/timing`).catch(() => ({}))).job_status, undefined)
      } finally {
        await context.close()
      }
    })
  }
})

describe('«Para» does not move the rest of the bar', () => {
  test('desktop: with none, one or two people chosen the tools and the send button stay on one row and the bar keeps its height', async () => {
    const { page, context } = await session(DESKTOP)
    try {
      const to = page.getByTestId('compose-to')
      await to.waitFor()
      const bar = () => page.locator('[data-compose-box]').boundingBox()
      const rowOf = async () => {
        const tools = await page.getByRole('button', { name: 'Adjuntar' }).first().boundingBox()
        const send = await page.getByTestId('compose-send').boundingBox()
        return { tools: tools.y + tools.height / 2, send: send.y + send.height / 2 }
      }
      const empty = { bar: (await bar()).height, ...(await rowOf()) }
      assert.ok(Math.abs(empty.tools - empty.send) < 4, 'tools and send on one row at rest')
      for (const [i, name] of [[0, 'Claude'], [1, 'Bruno Prueba']]) {
        await to.getByRole('button', { name: /^Para$|^Agregar destinatario$|^\+$/ }).first().click().catch(async () => to.locator('button').last().click())
        await page.getByRole('listbox').getByRole('option', { name }).click()
        await page.keyboard.press('Escape')
        await page.getByRole('listbox').waitFor({ state: 'detached' })
        const now = { bar: (await bar()).height, ...(await rowOf()) }
        assert.ok(Math.abs(now.tools - now.send) < 4, `tools and send on one row with ${i + 1} chosen`)
        assert.equal(now.bar, empty.bar, `the bar keeps its height with ${i + 1} chosen`)
      }
    } finally {
      await context.close()
    }
  })
})

