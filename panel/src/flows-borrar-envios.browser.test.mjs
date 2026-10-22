// UD-240 (H-3702) seen from the panel: a send is deleted for real from the drawer of Inicio. The button becomes the step that
// confirms it, in its place; a published send offers to keep its messages or to take them too. Against dev-server.mjs serving
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

describe('deleting a send from the drawer (UD-240)', () => {
  test('a published send: Borrar becomes Borrar envío, Borrar con mensajes and Cancelar; Cancelar goes back; Borrar envío keeps the message', async () => {
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

      await drawer.getByTestId('delete-send').click()
      const group = drawer.getByTestId('delete-send-confirm')
      await group.waitFor()
      assert.deepEqual(await group.getByRole('button').allTextContents(), ['Borrar envío', 'Borrar con mensajes', 'Cancelar'])
      assert.equal(await page.getByRole('dialog').count(), 0, 'no window opens over the page')
      await group.getByRole('button', { name: 'Cancelar' }).click()
      await drawer.getByTestId('delete-send').waitFor()
      assert.equal(await group.count(), 0)

      const before = (await api(page, '/inputs?mine=1&order=desc')).items.length
      await drawer.getByTestId('delete-send').click()
      await group.getByRole('button', { name: 'Borrar envío', exact: true }).click()
      await page.getByText('Envío borrado').waitFor()
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

  test('Borrar con mensajes takes the message out of the feed too', async () => {
    const { page, context } = await session()
    try {
      const title = 'La exportación a PDF pierde las tildes'
      await send(page, `${title}.`)
      const drawer = page.getByTestId('send-drawer')
      await drawer.getByTestId('published-message').first().waitFor({ timeout: 20000 })
      await feed(page).getByRole('radio', { name: 'Todos' }).click()
      await feed(page).getByText(title, { exact: true }).waitFor()

      await drawer.getByTestId('delete-send').click()
      await drawer.getByTestId('delete-send-confirm').getByRole('button', { name: 'Borrar con mensajes' }).click()
      await page.getByText('Envío borrado').waitFor()
      await page.getByTestId('send-drawer').waitFor({ state: 'detached' })
      await feed(page).getByText(title, { exact: true }).waitFor({ state: 'detached' })
      await settled(page)
      assert.equal((await api(page, '/messages?q=' + encodeURIComponent('pierde las tildes'))).items.length, 0)
    } finally {
      await context.close()
    }
  })

  test('a send still being analyzed offers only Borrar envío and Cancelar, and goes with its job', async () => {
    const { page, context } = await session()
    try {
      await panel.control.hold()
      await send(page, 'Revisar el tiempo de carga de la lista de áreas.')
      const drawer = page.getByTestId('send-drawer')
      await drawer.locator('[data-ui-stage="progress"]').waitFor()
      await settled(page)
      await drawer.getByTestId('delete-send').click()
      const group = drawer.getByTestId('delete-send-confirm')
      await group.waitFor()
      assert.deepEqual(await group.getByRole('button').allTextContents(), ['Borrar envío', 'Cancelar'])
      await group.getByRole('button', { name: 'Borrar envío', exact: true }).click()
      await page.getByText('Envío borrado').waitFor()
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
