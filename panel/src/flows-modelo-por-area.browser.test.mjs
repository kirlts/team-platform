// The model of each area and the level of each message (UD-292) seen from the panel, in a real browser against dev-server.mjs: `npm run test:flows`.
// The Editor picks the model and the model of direct fixes in the area and they stay; the card shows the level as a badge and a person changes it from the badge.
import assert from 'node:assert'
import { mkdirSync } from 'node:fs'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

let panel
let origin = ''
const SHOTS = process.env.MODELO_SHOTS ?? ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_MODELO_PORT ?? process.env.PANEL_FLOWS_PORT ?? 8967), { stepMs: 80 })
  origin = panel.origin
  if (SHOTS) mkdirSync(SHOTS, { recursive: true })
})
beforeEach(async () => { await panel.control.reset() })
after(async () => { await panel?.stop() })

const SIZES = [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]

async function session(viewport, who = 'ana') {
  const mobile = viewport.width < 768
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL', isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 })
  const page = await context.newPage()
  await login(page, origin, who)
  await page.locator('main').first().waitFor()
  return { page, context }
}
const api = async (page, path) => (await page.request.fetch(`${origin}/api${path}`, { headers: { 'x-team-request': 'panel' } })).json()

describe('model of the area (UD-292)', () => {
  for (const [name, viewport] of SIZES) {
    test(`${name}: the Editor chooses the model and the model of direct fixes in the area, and it is saved`, async () => {
      const { page, context } = await session(viewport)
      try {
        await page.goto(`${origin}/areas/a-error`)
        const models = page.getByTestId('area-models')
        await models.waitFor()
        const model = models.getByLabel('Modelo', { exact: true })
        const direct = models.getByLabel('Arreglo directo', { exact: true })
        assert.equal(await model.inputValue(), 'claude-sonnet-5-5', 'the default is the one of today')
        assert.equal(await direct.inputValue(), '', 'direct fixes run with the area model until chosen')
        assert.deepEqual(await direct.locator('option').allInnerTexts(), ['Igual', 'Haiku 5.5', 'Sonnet 5.5', 'Opus 5.5', 'Fable 5.1'])
        await direct.selectOption('claude-haiku-5-5')
        await model.selectOption('claude-opus-5-5')
        await settled(page)
        const area = (await api(page, '/areas')).items?.find?.((a) => a.id === 'a-error') ?? (await api(page, '/areas')).find((a) => a.id === 'a-error')
        assert.deepEqual([area.execute_model, area.execute_model_direct], ['claude-opus-5-5', 'claude-haiku-5-5'])
        const box = await models.boundingBox()
        assert.ok(box.x >= 0 && box.x + box.width <= viewport.width, 'inside the window')
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/area-modelo-${viewport.width}x${viewport.height}.png` })
        await page.reload()
        await models.waitFor()
        assert.equal(await models.getByLabel('Arreglo directo', { exact: true }).inputValue(), 'claude-haiku-5-5', 'it survives a reload')
      } finally { await context.close() }
    })
  }
})

describe('level of a message (UD-292)', () => {
  for (const [name, viewport] of SIZES) {
    test(`${name}: the card shows the level as a badge in its state line and a person changes it from the badge`, async () => {
      const { page, context } = await session(viewport)
      try {
        await page.goto(`${origin}/areas/a-error`)
        // The list fits the window: the cards that show are the ones that fit, so the first one is the one of the test.
        const card = page.getByRole('article').first()
        await card.waitFor()
        const title = (await card.getByRole('heading').first().innerText()).trim()
        const badge = card.getByTestId('level-mark')
        assert.deepEqual(await badge.locator('optgroup').evaluateAll((g) => g.map((x) => x.label)), ['Arreglo directo', 'Complejo', 'Sólo persona'])
        const row = await card.boundingBox()
        const mark = await badge.boundingBox()
        assert.ok(mark.x >= row.x && mark.x + mark.width <= row.x + row.width, 'the badge sits inside the card')
        const saved = () => page.waitForResponse((r) => r.url().includes('/level') && r.request().method() === 'PUT')
        await Promise.all([saved(), badge.selectOption('apply')])
        await settled(page)
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/tarjeta-nivel-${viewport.width}x${viewport.height}.png` })
        const read = async () => (await api(page, `/messages?q=${encodeURIComponent(title.slice(0, 30))}`)).items.find((m) => m.title === title)
        assert.deepEqual([(await read()).bloom_level, (await read()).bloom_by], ['apply', 'u-ana'])
        assert.equal(await badge.evaluate((el) => el.options[el.selectedIndex].text), 'Aplicar')
        await Promise.all([saved(), badge.selectOption('decide')])
        await settled(page)
        assert.equal((await read()).bloom_level, 'decide')
        assert.equal(await badge.getAttribute('data-tier'), 'person')
        assert.equal(await badge.evaluate((el) => el.options[el.selectedIndex].text), 'Decisión')
      } finally { await context.close() }
    })
  }
})
