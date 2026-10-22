// UD-257 (H-3728) seen from the panel: the analysis of a send opens with the count of its messages and lists each one folded, one line
// per message, like the rows of «Últimos mensajes»; a click opens a row with its text and its actions, and another folds it. Against
// dev-server.mjs serving panel/dist: `npm run test:flows`. Every test can fail if the defect it names comes back.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

process.env.PANEL_DEV_AUTO_PUBLISH = '0'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_PLEGADO_PORT ?? 8680), { stepMs: 80 })
  origin = panel.origin
})

beforeEach(async () => {
  await panel.control.reset()
})

after(async () => {
  await panel?.stop()
})

async function session(who = 'bruno') {
  const context = await panel.browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-CL', colorScheme: 'light' })
  const page = await context.newPage()
  await login(page, origin, who)
  await page.locator('main').first().waitFor()
  return { page, context }
}

// Four paragraphs in two areas: the double of the analysis proposes the first three and leaves the fourth as a part without a message.
const FOUR = [
  'El botón de guardar no funciona en el formulario de clientes cuando el nombre lleva tildes y el texto sigue por bastante más de una línea para que el título no quepa.',
  'Agregar un filtro por fecha en la lista de pedidos.',
  'La exportación a PDF falla con tablas largas.',
  'Agregar soporte para adjuntar planillas desde el teléfono.',
].join('\n\n')

const send = async (page, text) => {
  await page.getByLabel('Nuevo mensaje', { exact: true }).last().fill(text)
  await page.getByRole('button', { name: 'Enviar' }).first().click()
}

const analysis = (page) => page.getByTestId('analysis-box')
const rows = (page) => analysis(page).getByRole('list', { name: 'Mensajes propuestos' }).locator(':scope > li')

describe('the messages of a send are listed folded with their count (UD-257)', () => {
  test('a send with 4 messages says «4 mensajes», lists 4 folded rows of one line, and a row opens and folds again', async () => {
    const { page, context } = await session()
    try {
      await send(page, FOUR)
      await page.getByRole('button', { name: 'Enviar 3 mensajes', exact: true }).waitFor({ timeout: 40000 })
      // The fourth part becomes a message; that one opens by itself, as it was just made, and is folded here like the rest.
      await page.getByRole('button', { name: /^Partes sin mensaje/ }).click()
      await page.getByRole('button', { name: 'Crear mensaje' }).first().click()
      await page.getByRole('button', { name: 'Enviar 4 mensajes', exact: true }).waitFor()
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: /^Plegar el mensaje 4:/ }).click()
      await settled(page)

      const tally = analysis(page).getByTestId('message-tally')
      assert.match(await tally.innerText(), /^4 mensajes/)
      // Two areas: the count of each one beside its chip.
      assert.equal(await tally.getByTestId('area-chip').count(), 2)

      assert.equal(await rows(page).count(), 4)
      for (let i = 0; i < 4; i++) {
        const row = rows(page).nth(i)
        const head = row.getByRole('button', { name: new RegExp(`^Abrir el mensaje ${i + 1}:`) })
        assert.equal(await head.getAttribute('aria-expanded'), 'false', `row ${i + 1} starts folded`)
        const title = row.getByTestId('fold-title')
        const lines = await title.evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)))
        assert.equal(lines, 1, `the title of row ${i + 1} takes one line`)
        // No body, no field and no action of a folded row is on the page.
        assert.equal(await row.getByRole('button', { name: /^Texto del mensaje:/ }).count(), 0)
      }
      // A title that does not fit ends with an ellipsis and keeps its whole text as the tooltip.
      const long = rows(page).first().getByTestId('fold-title')
      assert.equal(await long.evaluate((el) => getComputedStyle(el).textOverflow), 'ellipsis')
      assert.equal(await long.evaluate((el) => getComputedStyle(el).whiteSpace), 'nowrap')
      assert.match(await long.getAttribute('title'), /cuando el nombre lleva tildes/)

      await rows(page).nth(1).getByRole('button', { name: /^Abrir el mensaje 2:/ }).click()
      await settled(page)
      const open = rows(page).nth(1)
      assert.match(await open.getByRole('button', { name: /^Texto del mensaje:/ }).innerText(), /filtro por fecha/)
      await open.getByRole('button', { name: /^Área:/ }).waitFor()
      await open.getByRole('button', { name: /^Quitar el mensaje/ }).waitFor()
      // Only that one opened.
      assert.equal(await analysis(page).getByRole('button', { name: /^Abrir el mensaje/ }).count(), 3)

      await open.getByRole('button', { name: /^Plegar el mensaje 2:/ }).click()
      await settled(page)
      assert.equal(await rows(page).nth(1).getByRole('button', { name: /^Texto del mensaje:/ }).count(), 0)
      assert.equal(await analysis(page).getByRole('button', { name: /^Abrir el mensaje/ }).count(), 4)
    } finally {
      await context.close()
    }
  })

  test('a published send lists its messages folded too, and an open one keeps its text and «Abrir»', async () => {
    const { page, context } = await session('ana')
    try {
      const res = await page.request.fetch(`${origin}/api/settings/publication`, { method: 'PATCH', headers: { 'x-team-request': 'panel', 'content-type': 'application/json' }, data: { auto_publish: true } })
      assert.equal(res.status(), 200, 'the Editor turns publication on')
      await send(page, FOUR)
      const pane = page.getByTestId('published-pane')
      await pane.getByTestId('published-message').nth(2).waitFor({ timeout: 40000 })
      await settled(page)
      assert.match(await pane.getByTestId('message-tally').innerText(), /^3 mensajes/)
      const items = pane.getByTestId('published-message')
      assert.equal(await items.count(), 3)
      assert.equal(await pane.getByRole('button', { name: /^Abrir el mensaje \d:/, expanded: false }).count(), 3)
      assert.equal(await pane.getByTestId('published-body').count(), 0)

      await items.first().getByRole('button', { name: /^Abrir el mensaje 1:/ }).click()
      await items.first().getByTestId('published-body').waitFor()
      assert.match(await items.first().getByTestId('published-body').innerText(), /lleva tildes/)
      await items.first().getByRole('link', { name: /^Abrir el mensaje / }).waitFor()
      await items.first().getByRole('button', { name: /^Plegar el mensaje 1:/ }).click()
      await items.first().getByTestId('published-body').waitFor({ state: 'detached' })
    } finally {
      await context.close()
    }
  })
})
