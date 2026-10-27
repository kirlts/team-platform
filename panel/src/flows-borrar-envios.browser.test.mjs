// UD-240 (H-3702) seen from the panel: a send is deleted for real from the drawer of Inicio with one click and no step that
// confirms it (UD-253); a published send has «Borrar envío», which keeps its messages, and, in the menu beside it, «Borrar envío y mensajes», which takes them too (one control per block, I4). Against dev-server.mjs serving
// panel/dist with auto-publication on: `npm run test:flows`. Every test can fail if the defect it names comes back.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

process.env.PANEL_DEV_AUTO_PUBLISH = '1'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_BORRAR_PORT ?? 8323), { stepMs: 80 })
  origin = panel.origin
})

beforeEach(async () => {
  await panel.control.reset()
})

after(async () => {
  await panel?.stop()
})

const DESKTOP = { width: 1440, height: 900 }

async function session(who = 'bruno') {
  const context = await panel.browser.newContext({ viewport: DESKTOP, locale: 'es-CL', colorScheme: 'light' })
  const page = await context.newPage()
  await login(page, origin, who)
  await page.locator('main').first().waitFor()
  return { page, context }
}

const send = async (page, text) => {
  await page.getByLabel('Nuevo mensaje', { exact: true }).last().fill(text)
  await page.getByRole('button', { name: 'Enviar' }).first().click()
}
const api = async (page, path) => {
  const res = await page.request.fetch(`${origin}/api${path}`, { headers: { 'x-team-request': 'panel' } })
  return res.json()
}
const feed = (page) => page.getByRole('region', { name: 'Últimos mensajes' })

describe('deleting a send from the drawer (UD-240, UD-253)', () => {
  test('a published send offers one «Borrar envío» with the form that also takes the messages in the menu beside it; one click on «Borrar envío» deletes it and keeps the message', async () => {
    const { page, context } = await session()
    try {
      const title = 'El botón de guardar no responde en el móvil'
      await send(page, `${title}.`)
      const drawer = page.getByTestId('send-drawer')
      await drawer.getByTestId('published-message').first().waitFor({ timeout: 20000 })
      await settled(page)
      // The feed shows everybody's messages, so the one just published is there.
      await feed(page).getByRole('radio', { name: 'Todos' }).click()
      await feed(page).getByText(title, { exact: true }).waitFor()

      assert.equal(await drawer.getByTestId('delete-send').innerText(), 'Borrar envío')
      assert.equal(await drawer.getByTestId('delete-send-all').count(), 0, 'the second form is in the menu, not drawn beside the first')
      await drawer.getByRole('button', { name: /^Borrar/ }).first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
      assert.equal(await drawer.getByRole('button', { name: /^Borrar/ }).count(), 1, 'one delete button in the block')
      await drawer.getByTestId('delete-send-more').click()
      assert.equal((await page.getByTestId('delete-send-all').innerText()).trim(), 'Borrar envío y mensajes')
      await page.keyboard.press('Escape')
      const before = (await api(page, '/inputs?mine=1&order=desc')).items.length
      await drawer.getByTestId('delete-send').click()
      await page.locator('[data-notice]').getByText('Envío borrado', { exact: true }).waitFor()
      assert.equal(await page.getByRole('dialog').count(), 0, 'no window opens over the page')
      await page.getByTestId('send-drawer').waitFor({ state: 'detached' })
      await settled(page)
      assert.equal((await api(page, '/inputs?mine=1&order=desc')).items.length, before - 1)
      // The message stays, with no send behind it.
      await feed(page).getByText(title, { exact: true }).waitFor()
      const kept = (await api(page, '/messages?q=' + encodeURIComponent('no responde en el móvil'))).items
      assert.equal(kept.length, 1)
      assert.equal(kept[0].input_id, null)
    } finally {
      await context.close()
    }
  })

  test('«Borrar envío y mensajes» from the menu takes the message out of the feed too, and the notice counts it', async () => {
    const { page, context } = await session()
    try {
      const title = 'La exportación a PDF pierde las tildes'
      await send(page, `${title}.`)
      const drawer = page.getByTestId('send-drawer')
      await drawer.getByTestId('published-message').first().waitFor({ timeout: 20000 })
      await feed(page).getByRole('radio', { name: 'Todos' }).click()
      await feed(page).getByText(title, { exact: true }).waitFor()

      await drawer.getByTestId('delete-send-more').click()
      await page.getByTestId('delete-send-all').click()
      await page.locator('[data-notice]').getByText('Envío y 1 mensaje borrados', { exact: true }).waitFor()
      await page.getByTestId('send-drawer').waitFor({ state: 'detached' })
      await feed(page).getByText(title, { exact: true }).waitFor({ state: 'detached' })
      await settled(page)
      assert.equal((await api(page, '/messages?q=' + encodeURIComponent('pierde las tildes'))).items.length, 0)
    } finally {
      await context.close()
    }
  })

  test('a send still being analyzed offers only «Borrar envío», and one click takes it with its job', async () => {
    const { page, context } = await session()
    try {
      await panel.control.hold()
      await send(page, 'Revisar el tiempo de carga de la lista de áreas.')
      const drawer = page.getByTestId('send-drawer')
      await drawer.locator('[data-ui-stage="progress"]').waitFor()
      await settled(page)
      assert.equal(await drawer.getByTestId('delete-send-more').count(), 0, 'nothing published, so there is nothing more to take')
      await drawer.getByTestId('delete-send').click()
      await page.locator('[data-notice]').getByText('Envío borrado', { exact: true }).waitFor()
      await page.getByTestId('send-drawer').waitFor({ state: 'detached' })
      await panel.control.release()
      await settled(page)
      assert.equal((await api(page, '/inputs?mine=1&order=desc')).items.length, 0)
      assert.equal(await page.getByTestId('send-drawer').count(), 0, 'the released analysis does not bring the deleted send back')
    } finally {
      await context.close()
    }
  })
})
