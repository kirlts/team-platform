// UD-240: «Datos» in Configuración. The Editor empties the test data with one click and no step that confirms it (UD-253); a member never sees the section.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, openFolds, settled, startPanel } from './browser-support.mjs'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_VACIAR_PORT ?? 8947), { stepMs: 80 })
  origin = panel.origin
})

beforeEach(async () => {
  await panel.control.reset()
})

after(async () => {
  await panel?.stop()
})

const DESKTOP = { width: 1440, height: 900 }

async function session(who) {
  const context = await panel.browser.newContext({ viewport: DESKTOP, locale: 'es-CL' })
  const page = await context.newPage()
  await login(page, origin, who)
  await page.locator('main#main').waitFor()
  await page.goto(`${origin}/settings`)
  await page.getByRole('heading', { name: 'Cuenta' }).waitFor()
  await settled(page)
  await openFolds(page)
  return { page, context }
}

describe('Configuración, Datos', () => {
  test('a member sees the section too (UD-287)', async () => {
    const { page, context } = await session('bruno')
    try {
      await page.locator('[data-data-reset]').first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
      assert.equal(await page.locator('[data-data-reset]').count(), 1)
      await page.getByRole('button', { name: 'Vaciar contenido' }).first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
      assert.equal(await page.getByRole('button', { name: 'Vaciar contenido' }).count(), 1)
    } finally {
      await context.close()
    }
  })

  test('one click on «Vaciar contenido» empties the content, with no step that confirms it, and the notice and the figures say how much', async () => {
    const { page, context } = await session('ana')
    try {
      const section = page.locator('[data-data-reset]')
      await section.waitFor()
      await section.getByText('Borra envíos, mensajes, respuestas y adjuntos; conserva equipo, áreas y ajustes').first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
      assert.equal(await section.getByText('Borra envíos, mensajes, respuestas y adjuntos; conserva equipo, áreas y ajustes').count(), 1)
      const before = await page.evaluate(async () => (await (await fetch('/api/messages')).json()).total)
      assert.ok(before > 0)
      await section.getByRole('button', { name: 'Vaciar contenido' }).click()
      const figures = section.locator('[data-reset-figures]')
      await figures.waitFor()
      assert.equal(await section.getByRole('button', { name: 'Cancelar' }).count(), 0, 'no step that confirms it')
      assert.equal(await page.getByRole('dialog').count(), 0)
      await page.locator('[data-notice]').getByText(new RegExp(`^Datos vaciados · Envíos \\d+ · Mensajes ${before} · Respuestas \\d+$`)).waitFor()
      await settled(page)
      const rows = await figures.locator('dt').allTextContents()
      assert.deepEqual(rows, ['Envíos', 'Mensajes', 'Respuestas', 'Archivos', 'Espacio liberado'])
      const messagesFigure = await figures.locator('div').filter({ hasText: 'Mensajes' }).locator('dd').textContent()
      assert.equal(Number(messagesFigure), before, 'the figure is what the panel listed before')
      assert.equal(await page.evaluate(async () => (await (await fetch('/api/messages')).json()).total), 0)
      // The team is untouched.
      assert.ok((await page.evaluate(async () => (await (await fetch('/api/members')).json()).items.length)) > 1)
    } finally {
      await context.close()
    }
  })

  test('one click on «Vaciar todo» works with no word to type, removes the other members and lists them in the figures', async () => {
    const { page, context } = await session('ana')
    try {
      const section = page.locator('[data-data-reset]')
      await section.getByRole('button', { name: 'Vaciar todo' }).click()
      const figures = section.locator('[data-reset-figures]')
      await figures.waitFor()
      assert.equal(await section.getByRole('textbox').count(), 0, 'no word to type')
      await settled(page)
      const rows = await figures.locator('dt').allTextContents()
      assert.deepEqual(rows, ['Envíos', 'Mensajes', 'Respuestas', 'Miembros', 'Áreas', 'Archivos', 'Espacio liberado'])
      const members = await page.evaluate(async () => (await (await fetch('/api/members')).json()).items.map((m) => m.email))
      assert.deepEqual(members, ['ana@dev.invalid'])
    } finally {
      await context.close()
    }
  })
})
