// H-3722: what was fixed in the code is a setting of the installation. In a real browser against dev-server.mjs serving
// panel/dist (`npm run test:flows`): the Editor changes the project name and the analysis framing in Configuración, the top
// bar shows the new name, and a member sees neither setting. With SHOTS_DIR set the test also writes screenshots.
import assert from 'node:assert'
import { mkdirSync } from 'node:fs'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_ENCUADRE_PORT ?? 8621), { stepMs: 80 })
  origin = panel.origin
})

beforeEach(async () => {
  await panel.control.reset()
})

after(async () => {
  await panel?.stop()
})

const DESKTOP = { width: 1440, height: 900 }
const PHONE = { width: 390, height: 844 }
const SHOTS = process.env.SHOTS_DIR

async function settings(who, viewport = DESKTOP) {
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL' })
  const page = await context.newPage()
  await login(page, origin, who)
  await page.locator('main#main').waitFor()
  await page.goto(`${origin}/configuracion`)
  await page.getByRole('heading', { name: 'Proyecto', exact: true }).waitFor()
  await settled(page)
  return { page, context }
}
async function shot(page, name) {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
}
const api = (page, path) => page.evaluate(async (p) => (await fetch(`/api${p}`, { headers: { 'x-team-request': 'panel' } })).json(), path)

describe('Configuración: project name and analysis framing', () => {
  test('the Editor renames the project and the top bar shows the new name without reloading', async () => {
    const { page, context } = await settings('ana')
    try {
      const header = page.locator('header').first()
      assert.match(await header.innerText(), /Desarrollo/)
      const field = page.getByRole('textbox', { name: 'Nombre del proyecto' })
      assert.equal(await field.inputValue(), 'Desarrollo')
      assert.equal(await page.locator('#hint-project-name').count(), 1, 'the setting has its one-line explanation')
      await field.fill('Clínica Norte')
      await field.press('Enter')
      await page.waitForFunction(() => document.querySelector('header')?.textContent?.includes('Clínica Norte'))
      assert.equal((await api(page, '/settings/project')).name, 'Clínica Norte')
      // Escape discards what was typed.
      await field.fill('Otro nombre')
      await field.press('Escape')
      assert.equal(await field.inputValue(), 'Clínica Norte')
      await shot(page, 'encuadre-nombre-1440')
      // Reloading keeps it: it is saved, not local.
      await page.reload()
      await page.locator('main#main').waitFor()
      await page.waitForFunction(() => document.querySelector('header')?.textContent?.includes('Clínica Norte'))
    } finally {
      await context.close()
    }
  })

  test('the Editor edits the framing of a language, it is saved on leaving the field, and Restablecer goes back to the default', async () => {
    const { page, context } = await settings('ana')
    try {
      assert.equal(await page.getByRole('heading', { name: 'Encuadre del análisis' }).count(), 1)
      const es = page.getByRole('textbox', { name: 'Encuadre del análisis · Español' })
      const before = await es.inputValue()
      assert.match(before, /equipo de software pequeño/)
      const text = 'Esta es la bandeja de entrada de una clínica dental. Un mismo input puede traer una falla de agenda, un pedido y una duda de facturación.'
      await es.fill(text)
      await page.getByRole('heading', { name: 'Encuadre del análisis' }).click() // leaving the field saves
      await page.getByRole('button', { name: 'Restablecer' }).waitFor()
      const saved = await api(page, '/settings/analysis')
      assert.equal(saved.framing['es-419'].value, text)
      assert.equal(saved.framing['es-419'].custom, true)
      assert.equal(saved.framing.en.custom, false, 'the other language keeps its default')
      await shot(page, 'encuadre-editado-1440')
      await page.getByRole('button', { name: 'Restablecer' }).click()
      await page.waitForFunction(() => document.querySelector('[data-setting-field="framing-es-419"]')?.value.includes('equipo de software pequeño'))
      assert.equal((await api(page, '/settings/analysis')).framing['es-419'].custom, false)
    } finally {
      await context.close()
    }
  })

  test('a member sees neither the project name nor the framing settings, and the API refuses them the framing', async () => {
    const { page, context } = await settings('bruno')
    try {
      assert.equal(await page.getByRole('heading', { name: 'Nombre del proyecto' }).count(), 0)
      assert.equal(await page.getByRole('heading', { name: 'Encuadre del análisis' }).count(), 0)
      assert.equal(await page.locator('[data-setting-field]').count(), 0)
      const status = await page.evaluate(async () => (await fetch('/api/settings/analysis', { headers: { 'x-team-request': 'panel' } })).status)
      assert.equal(status, 403)
    } finally {
      await context.close()
    }
  })

  test('on a phone the two settings fit the width without horizontal scroll', async () => {
    const { page, context } = await settings('ana', PHONE)
    try {
      await page.getByRole('textbox', { name: 'Nombre del proyecto' }).waitFor()
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      assert.ok(overflow <= 0, `horizontal overflow of ${overflow} px`)
      for (const name of ['Nombre del proyecto', 'Encuadre del análisis · Español', 'Encuadre del análisis · English']) {
        const box = await page.getByRole('textbox', { name }).boundingBox()
        assert.ok(box && box.x >= 0 && box.x + box.width <= PHONE.width, `${name}: ${JSON.stringify(box)}`)
      }
      await shot(page, 'encuadre-390')
    } finally {
      await context.close()
    }
  })
})
