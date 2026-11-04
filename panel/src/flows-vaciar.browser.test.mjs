// UD-240: «Datos» in Configuración. Nothing comes back, so soft-lock TP-03 puts a step in front of it: «Vaciar contenido» asks one confirmation that says what goes,
// «Vaciar todo» asks for the name of the project typed in its own row (UD-253 asked for no step; this is the exception for what has no Deshacer).
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

  test('«Vaciar contenido» confirms in one step that says what goes, then empties the content, and the notice and the figures say how much', async () => {
    const { page, context } = await session('ana')
    try {
      const section = page.locator('[data-data-reset]')
      await section.waitFor()
      await section.getByText('Borra envíos, mensajes, respuestas y adjuntos; conserva equipo, áreas y ajustes').first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
      assert.equal(await section.getByText('Borra envíos, mensajes, respuestas y adjuntos; conserva equipo, áreas y ajustes').count(), 1)
      const before = await page.evaluate(async () => (await (await fetch('/api/messages')).json()).total)
      assert.ok(before > 0)
      await section.getByRole('button', { name: 'Vaciar contenido' }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByText('Se borran envíos, mensajes, respuestas y adjuntos. No se restaura').waitFor()
      assert.equal(await page.evaluate(async () => (await (await fetch('/api/messages')).json()).total), before, 'nothing went before the confirmation')
      await dialog.getByRole('button', { name: 'Cancelar' }).click()
      await dialog.waitFor({ state: 'detached' })
      assert.equal(await page.evaluate(async () => (await (await fetch('/api/messages')).json()).total), before, 'cancelling leaves everything')
      await section.getByRole('button', { name: 'Vaciar contenido' }).click()
      await dialog.getByRole('button', { name: 'Vaciar contenido' }).click()
      const figures = section.locator('[data-reset-figures]')
      await figures.waitFor()
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

  test('«Vaciar todo» waits for the name of the project typed in its row, then removes the other members and lists them in the figures', async () => {
    const { page, context } = await session('ana')
    try {
      const section = page.locator('[data-data-reset]')
      const field = section.getByTestId('reset-name')
      const name = await field.getAttribute('placeholder')
      assert.ok(name, 'the field shows the name to type')
      const button = section.getByTestId('reset-everything')
      assert.equal(await button.isDisabled(), true, 'disabled while nothing is typed')
      await field.fill(`${name} otro`)
      assert.equal(await button.isDisabled(), true, 'disabled with another text')
      assert.equal(await page.evaluate(async () => (await (await fetch('/api/members')).json()).items.length) > 1, true, 'nothing went yet')
      await field.fill(name)
      await button.click()
      const figures = section.locator('[data-reset-figures]')
      await figures.waitFor()
      assert.equal(await page.getByRole('dialog').count(), 0, 'the confirmation is in the row, not in a window')
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
