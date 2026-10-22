// H-3707 (UD-071): the sender adds and removes the attachments of a published message from its detail, not only from
// Inicio > Envíos. Each test runs in a real browser against dev-server.mjs serving panel/dist:
// `PANEL_FLOWS_PORT=… node --test src/flows-adjuntos-ficha.browser.test.mjs`.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_PORT ?? 8806), { stepMs: 80 })
  origin = panel.origin
})
beforeEach(async () => {
  await panel.control.reset()
})
after(async () => {
  await panel?.stop()
})

async function session(who, viewport = { width: 1440, height: 900 }, colorScheme = 'light') {
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL', colorScheme })
  const page = await context.newPage()
  await login(page, origin, who)
  return { page, context }
}

/** Opens a message from the list, searching its title, as a person does. */
async function openFromList(page, titleStart) {
  await page.goto(`${origin}/messages?q=${encodeURIComponent(titleStart)}`)
  await page.locator('main#main').waitFor()
  const link = page.getByRole('link', { name: new RegExp(`^${titleStart}`) }).first()
  await link.waitFor()
  await link.click()
  await page.locator('main h1').waitFor()
  await settled(page)
}

const stored = async (page, q) => {
  const list = await (await page.request.get(`${origin}/api/messages?q=${encodeURIComponent(q)}`)).json()
  return (await (await page.request.get(`${origin}/api/messages/${list.items[0].id}`)).json()).attachments.map((a) => a.name)
}

const note = { name: 'nota.txt', mimeType: 'text/plain', buffer: Buffer.from('nota de prueba') }

describe('attachments from the detail (H-3707)', () => {
  test('the sender adds a file, removes it from the gallery, and Deshacer puts it back', async () => {
    const { page, context } = await session('carla')
    try {
      await openFromList(page, 'Corregir el contraste')
      const before = await stored(page, 'Corregir el contraste')
      assert.equal(before.length, 1)
      const add = page.getByRole('button', { name: 'Agregar adjuntos' })
      assert.equal(await add.count(), 1, 'the sender sees «Adjunto»')
      assert.equal(await page.getByTestId('detach-attachment').count(), 1, 'and «Quitar» over the medium shown')
      await page.getByTestId('detail-files').setInputFiles(note)
      await page.locator('[data-gallery-count]').waitFor()
      await settled(page)
      assert.equal((await stored(page, 'Corregir el contraste')).length, 2, 'the file is saved')
      // The new file is the last one: go to it and remove it.
      await page.getByRole('button', { name: /^Archivo 2 de 2|2 de 2/ }).first().click()
      await page.getByRole('button', { name: 'Quitar nota.txt' }).and(page.getByTestId('detach-attachment')).click()
      await page.locator('[data-gallery-count]').waitFor({ state: 'detached' })
      await settled(page)
      assert.equal((await stored(page, 'Corregir el contraste')).length, 1, 'the file is out')
      await page.getByRole('button', { name: 'Deshacer', exact: true }).first().click()
      await page.locator('[data-gallery-count]').waitFor()
      await settled(page)
      assert.equal((await stored(page, 'Corregir el contraste')).length, 2, 'Deshacer brings it back')
    } finally {
      await context.close()
    }
  })

  test('a message with no attachments still offers «Adjunto» to its sender', async () => {
    const { page, context } = await session('bruno')
    try {
      await openFromList(page, 'Definir el tamaño')
      assert.equal(await page.getByTestId('detach-attachment').count(), 0)
      await page.getByTestId('detail-files').setInputFiles(note)
      await page.locator('[data-gallery-count], [aria-label="Galería de medios"]').first().waitFor()
      await settled(page)
      assert.deepEqual(await stored(page, 'Definir el tamaño'), ['nota.txt'])
      assert.equal(await page.getByRole('button', { name: 'Quitar nota.txt' }).and(page.getByTestId('detach-attachment')).count(), 1)
    } finally {
      await context.close()
    }
  })

  test('another member and the Editor see no attachment controls', async () => {
    for (const who of ['bruno', 'ana']) {
      const { page, context } = await session(who)
      try {
        await openFromList(page, 'Corregir el contraste')
        assert.equal(await page.getByRole('button', { name: 'Agregar adjuntos' }).count(), 0, `${who}: no «Adjunto»`)
        assert.equal(await page.getByTestId('detach-attachment').count(), 0, `${who}: no «Quitar»`)
        assert.equal(await page.getByTestId('detail-files').count(), 0)
      } finally {
        await context.close()
      }
    }
  })
})
