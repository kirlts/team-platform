// UD-240: «Datos» in Configuración. The Editor empties the test data with a confirmation in place; a member never sees the section.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

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
  return { page, context }
}

describe('Configuración, Datos', () => {
  test('a member does not see the section', async () => {
    const { page, context } = await session('bruno')
    try {
      assert.equal(await page.locator('[data-data-reset]').count(), 0)
      assert.equal(await page.getByRole('button', { name: 'Vaciar contenido' }).count(), 0)
    } finally {
      await context.close()
    }
  })

  test('«Vaciar contenido» confirms in place, Cancelar takes it back, and the figures appear after the reset', async () => {
    const { page, context } = await session('ana')
    try {
      const section = page.locator('[data-data-reset]')
      await section.waitFor()
      assert.equal(await section.getByText('Borra envíos, mensajes, respuestas y adjuntos; conserva equipo, áreas y ajustes').count(), 1)
      await section.getByRole('button', { name: 'Vaciar contenido' }).click()
      await settled(page)
      await section.getByRole('button', { name: 'Cancelar' }).waitFor()
      assert.equal(await section.getByRole('button', { name: 'Vaciar contenido' }).count(), 1, 'the verb stays as the confirming button')
      await section.getByRole('button', { name: 'Cancelar' }).click()
      await settled(page)
      assert.equal(await section.getByRole('button', { name: 'Cancelar' }).count(), 0)
      assert.equal(await section.locator('[data-reset-figures]').count(), 0, 'nothing was deleted')
      const before = await page.evaluate(async () => (await (await fetch('/api/messages')).json()).total)
      assert.ok(before > 0)
      await section.getByRole('button', { name: 'Vaciar contenido' }).click()
      await section.getByRole('button', { name: 'Cancelar' }).waitFor()
      await section.getByRole('button', { name: 'Vaciar contenido' }).click()
      const figures = section.locator('[data-reset-figures]')
      await figures.waitFor()
      await settled(page)
      const rows = await figures.locator('dt').allTextContents()
      assert.deepEqual(rows, ['Envíos', 'Mensajes', 'Respuestas', 'Archivos', 'Espacio liberado'])
      const messagesFigure = await figures.locator('div').filter({ hasText: 'Mensajes' }).locator('dd').textContent()
      assert.equal(Number(messagesFigure), before, 'the figure is what the panel listed before')
      assert.equal(await page.evaluate(async () => (await (await fetch('/api/messages')).json()).total), 0)
      assert.equal(await section.getByRole('button', { name: 'Cancelar' }).count(), 0, 'the buttons go back to rest')
      // The team is untouched.
      assert.ok((await page.evaluate(async () => (await (await fetch('/api/members')).json()).items.length)) > 1)
    } finally {
      await context.close()
    }
  })

  test('«Vaciar todo» stays off until the word VACIAR is typed, then removes the other members and lists them in the figures', async () => {
    const { page, context } = await session('ana')
    try {
      const section = page.locator('[data-data-reset]')
      await section.getByRole('button', { name: 'Vaciar todo' }).click()
      const word = section.getByLabel('Palabra de confirmación: VACIAR')
      await word.waitFor()
      const confirm = section.getByRole('button', { name: 'Vaciar todo' })
      assert.equal(await confirm.isDisabled(), true)
      await word.fill('vacia')
      assert.equal(await confirm.isDisabled(), true)
      await word.fill('vaciar')
      await settled(page)
      assert.equal(await confirm.isDisabled(), false, 'the word is accepted in any case')
      await confirm.click()
      const figures = section.locator('[data-reset-figures]')
      await figures.waitFor()
      await settled(page)
      const rows = await figures.locator('dt').allTextContents()
      assert.deepEqual(rows, ['Envíos', 'Mensajes', 'Respuestas', 'Miembros', 'Áreas', 'Archivos', 'Espacio liberado'])
      const members = await page.evaluate(async () => (await (await fetch('/api/members')).json()).items.map((m) => m.email))
      assert.deepEqual(members, ['ana@dev.invalid'])
      assert.equal(await section.getByLabel('Palabra de confirmación: VACIAR').count(), 0, 'the field leaves with the confirmation')
    } finally {
      await context.close()
    }
  })
})
