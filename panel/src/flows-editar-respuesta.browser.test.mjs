// UD-253 (H-3714): the author of a reply edits its text in place, as the sender edits a message (UD-071, UD-017): a click on
// the text opens it, Enter saves, Escape cancels, the thread shows «Editada» by the time, and Deshacer of the detail takes
// the edit back. Another member and the Editor see the text read-only. Each test runs in a real browser against
// dev-server.mjs serving panel/dist: `PANEL_FLOWS_PORT=… node --test src/flows-editar-respuesta.browser.test.mjs`.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_PORT ?? 8807), { stepMs: 80 })
  origin = panel.origin
})
beforeEach(async () => {
  await panel.control.reset()
})
after(async () => {
  await panel?.stop()
})

async function session(who, viewport = { width: 1440, height: 900 }) {
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL', colorScheme: 'light' })
  const page = await context.newPage()
  await login(page, origin, who)
  return { page, context }
}

/** Opens a message from the list, narrowed by the search, as a person does. */
async function openFromList(page, titleStart) {
  await page.goto(`${origin}/messages?q=${encodeURIComponent(titleStart)}`)
  await page.locator('main#main').waitFor()
  const link = page.getByRole('link', { name: new RegExp(`^${titleStart}`) }).first()
  await link.waitFor()
  await link.click()
  await page.locator('main h1').waitFor()
  await settled(page)
}

// «Arreglar el error al iniciar sesión…» was sent by Carla and has one reply, by Bruno.
const ORIGINAL = 'Corregido en la rama de acceso: el correo se normaliza antes de buscar.'
const EDITED = 'Corregido en la rama de acceso: el correo se pasa a minúsculas antes de buscar.'

const replyBody = async (page) => {
  const body = await (await page.request.get(`${origin}/api/messages?q=may%C3%BAsculas`)).json()
  const detail = await (await page.request.get(`${origin}/api/messages/${body.items[0].id}`)).json()
  return detail.replies[0]
}

describe('editing a reply (H-3714)', () => {
  test('the author edits the text in place: Enter saves, «Editada» shows, Escape cancels and Deshacer takes it back', async () => {
    const { page, context } = await session('bruno')
    try {
      await openFromList(page, 'Arreglar el error')
      const thread = page.locator('section[aria-label="Respuestas"]')
      const text = thread.getByRole('button', { name: /^Texto de la respuesta: / })
      await text.first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
      assert.equal(await text.count(), 1, 'the author sees the text of the reply as editable')
      assert.equal(await thread.getByTestId('reply-edited').count(), 0, 'not edited yet')

      // Escape leaves the text as it was.
      await text.click()
      const field = thread.getByRole('textbox', { name: 'Texto de la respuesta' })
      await field.fill('descartado')
      await field.press('Escape')
      await thread.getByText(ORIGINAL).waitFor()
      assert.equal((await replyBody(page)).body, ORIGINAL)

      // Enter saves where it is.
      await text.click()
      await field.fill(EDITED)
      await field.press('Enter')
      await thread.getByText(EDITED).waitFor()
      await thread.getByTestId('reply-edited').waitFor()
      await settled(page)
      assert.match(await thread.getByTestId('reply-edited').innerText(), /^Editada /)
      const saved = await replyBody(page)
      assert.equal(saved.body, EDITED)
      assert.equal(saved.version, 2)

      // Deshacer of the detail brings the previous text back.
      await page.getByRole('group', { name: 'Historial de cambios' }).getByRole('button', { name: 'Deshacer', exact: true }).click()
      await thread.getByText(ORIGINAL).waitFor()
      await settled(page)
      assert.equal((await replyBody(page)).body, ORIGINAL)
    } finally {
      await context.close()
    }
  })

  test('another member and the Editor see the reply read-only', async () => {
    for (const who of ['carla', 'ana']) {
      const { page, context } = await session(who)
      try {
        await openFromList(page, 'Arreglar el error')
        const thread = page.locator('section[aria-label="Respuestas"]')
        await thread.getByText(ORIGINAL).waitFor()
        assert.equal(await thread.getByRole('button', { name: /^Texto de la respuesta/ }).count(), 0, `${who} did not write it`)
        assert.equal(await thread.locator('[data-editable]').count(), 0)
      } finally {
        await context.close()
      }
    }
  })
})
