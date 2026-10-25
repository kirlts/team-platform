// The models, the Guards and the assessment of a message (UD-292) seen from the panel, in a real browser against dev-server.mjs: `npm run test:flows`.
// The Editor picks the light and the larger model and writes the Guards of an area; the card shows the Guards a message touches; the detail shows the assessment and the
// IMK judgement, and a person changes the assessment from it.
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
const areaOf = async (page, id) => { const r = await api(page, '/areas'); return (r.items ?? r).find((a) => a.id === id) }
const saved = (page, pattern, method = 'PATCH') => page.waitForResponse((r) => r.url().includes(pattern) && r.request().method() === method)

describe('models and Guards of the area (UD-292)', () => {
  for (const [name, viewport] of SIZES) {
    test(`${name}: the Editor chooses the light and the larger model and they are saved`, async () => {
      const { page, context } = await session(viewport)
      try {
        await page.goto(`${origin}/areas/a-error`)
        const models = page.getByTestId('area-owner')
        await models.waitFor()
        const light = models.getByLabel('Ligero', { exact: true })
        const major = models.getByLabel('Mayor', { exact: true })
        assert.deepEqual([await light.inputValue(), await major.inputValue()], ['claude-haiku-5-5', 'claude-sonnet-5-5'], 'light by default, and the one of today as the larger')
        assert.deepEqual(await major.locator('option').allInnerTexts(), ['Haiku 5.5', 'Sonnet 5.5', 'Opus 5.5', 'Fable 5.1'])
        await Promise.all([saved(page, '/areas/a-error'), major.selectOption('claude-opus-5-5')])
        await Promise.all([saved(page, '/areas/a-error'), light.selectOption('claude-sonnet-5-5')])
        await settled(page)
        const area = await areaOf(page, 'a-error')
        assert.deepEqual([area.execute_model, area.execute_model_light], ['claude-opus-5-5', 'claude-sonnet-5-5'])
        const box = await models.boundingBox()
        assert.ok(box.x >= 0 && box.x + box.width <= viewport.width, 'inside the window')
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/area-modelos-${viewport.width}x${viewport.height}.png` })
        await page.reload()
        await models.waitFor()
        assert.equal(await models.getByLabel('Mayor', { exact: true }).inputValue(), 'claude-opus-5-5', 'it survives a reload')
      } finally { await context.close() }
    })

    test(`${name}: the Editor writes a Guard of the area, marks it about a person, and it keeps its id`, async () => {
      const { page, context } = await session(viewport)
      try {
        await page.goto(`${origin}/areas/a-error`)
        await page.getByTestId('area-guards-open').click()
        const guards = page.getByTestId('area-guards')
        await guards.waitFor()
        assert.equal(await guards.getByTestId('area-guard').count(), 1)
        await Promise.all([saved(page, '/areas/a-error'), guards.getByTestId('guard-add').click()])
        await settled(page)
        assert.equal(await guards.getByTestId('area-guard').count(), 2)
        const second = guards.getByTestId('area-guard').nth(1)
        await Promise.all([saved(page, '/areas/a-error'), second.getByRole('checkbox').click()])
        await settled(page)
        const area = await areaOf(page, 'a-error')
        assert.deepEqual(area.guards.map((g) => [g.id, g.person === true]), [[1, true], [2, true]], 'the first keeps its id and the new one takes the next')
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/area-guardias-${viewport.width}x${viewport.height}.png` })
        const box = await guards.boundingBox()
        assert.ok(box.x >= 0 && box.x + box.width <= viewport.width, 'inside the window')
      } finally { await context.close() }
    })
  }

  test('a member who is not an Editor does not reach the areas: nothing to change', async () => {
    const { page, context } = await session(SIZES[0][1], 'bruno')
    try {
      await page.goto(`${origin}/areas/a-error`)
      await page.getByText('Sólo el Editor administra las áreas').waitFor()
      assert.equal(await page.getByTestId('area-owner').count(), 0)
    } finally { await context.close() }
  })
})

describe('assessment of a message (UD-292)', () => {
  for (const [name, viewport] of SIZES) {
    test(`${name}: the card shows the Guards the message touches, and the detail shows the assessment and lets a person change it`, async () => {
      const { page, context } = await session(viewport)
      try {
        // The list fits the window: the card of the message is on one of its pages.
        await page.goto(`${origin}/areas/a-error`)
        await page.getByRole('article').first().waitFor()
        for (let i = 0; i < 4 && (await page.getByTestId('guard-mark').count()) === 0; i++) {
          const next = page.getByRole('button', { name: 'Página siguiente' }).first()
          if ((await next.count()) === 0 || !(await next.isEnabled())) break
          await next.click()
          await settled(page)
        }
        const mark = page.getByTestId('guard-mark').first()
        await mark.waitFor()
        assert.equal(await mark.getAttribute('data-person'), '', 'a Guard about a person')
        assert.match(await mark.innerText(), /cobro/)
        const row = await page.getByRole('article').filter({ has: mark }).boundingBox()
        const m = await mark.boundingBox()
        assert.ok(m.x >= row.x && m.x + m.width <= row.x + row.width, 'the badge sits inside the card')
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/tarjeta-guardia-${viewport.width}x${viewport.height}.png` })

        const message = (await api(page, '/messages?q=contraste')).items[0]
        await page.goto(`${origin}/messages/${message.id}`)
        await page.getByRole('button', { name: 'Evaluación' }).click()
        const box = page.getByTestId('assessment')
        await box.waitFor()
        assert.match(await box.innerText(), /Cambiar el color del botón y mostrar el antes y el después\./)
        assert.equal(await box.getByTestId('guard-1').isChecked(), true)
        assert.match(await page.getByTestId('estimates').innerText(), /Crear\s*0\.15[\s\S]*Irreversibilidad\s*0\.10[\s\S]*Certeza\s*0\.90/)
        await Promise.all([saved(page, '/assessment', 'PUT'), box.getByTestId('guard-1').click()])
        await Promise.all([saved(page, '/assessment', 'PUT'), box.getByTestId('value-holder').selectOption('person')])
        await settled(page)
        const after = (await api(page, `/messages/${message.id}`)).assessment
        assert.deepEqual([after.guards, after.estimates.value_holder, after.by], [[], 'person', 'u-ana'])
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/ficha-evaluacion-${viewport.width}x${viewport.height}.png` })
      } finally { await context.close() }
    })
  }

  test('the detail of a worked message shows the model, the cost and the IMK judgement with its axes against their target', async () => {
    const { page, context } = await session(SIZES[0][1])
    try {
      const { done_id: doneId } = await panel.control.execution()
      await page.goto(`${origin}/messages/${doneId}`)
      await page.getByRole('button', { name: 'Tiempos' }).click()
      await page.locator('[data-timing-figure="Modelo"]').waitFor()
      assert.equal((await page.locator('[data-timing-figure="Modelo"]').innerText()).trim(), 'Haiku 5.5')
      assert.match(await page.locator('[data-timing-figure="Costo"]').innerText(), /US\$ 0\.31/)
      await page.getByRole('button', { name: 'Adecuación' }).click()
      const judgment = page.getByTestId('judgment')
      await judgment.waitFor()
      const axes = judgment.getByTestId('judgment-axis')
      assert.equal(await axes.count(), 4)
      assert.equal(await axes.nth(0).getAttribute('data-meets'), 'true')
      assert.equal(await axes.nth(1).getAttribute('data-meets'), 'false')
      assert.match(await axes.nth(1).innerText(), /Integridad del artefacto[\s\S]*1\.0[\s\S]*meta 2[\s\S]*No cumple/)
      assert.match(await judgment.innerText(), /Ya carga con tus datos/)
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/ficha-adecuacion-1440x900.png` })
    } finally { await context.close() }
  })
})
