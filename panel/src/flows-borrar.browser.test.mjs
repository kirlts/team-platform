// UD-240 (H-3700, H-3701): a published message and a reply are deleted from the screen where they are seen, with no
// dialog, and Deshacer brings them back. Each test runs in a real browser against dev-server.mjs serving panel/dist:
// `PANEL_FLOWS_PORT=… node --test src/flows-borrar.browser.test.mjs`.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_PORT ?? 9201), { stepMs: 80 })
  origin = panel.origin
})
beforeEach(async () => {
  await panel.control.reset()
})
after(async () => {
  await panel?.stop()
})

async function session(who = 'bruno', viewport = { width: 1440, height: 900 }) {
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL', colorScheme: 'light' })
  const page = await context.newPage()
  await login(page, origin, who)
  return { page, context }
}

/** Opens a message from the list, as a person does, so the detail has a page behind it to return to. */
async function openFromList(page, titleStart) {
  // The list paginates to the height of the frame: the search narrows it to the one message, as a person would.
  await page.goto(`${origin}/messages?q=${encodeURIComponent(titleStart)}`)
  await page.locator('main#main').waitFor()
  const link = page.getByRole('link', { name: new RegExp(`^${titleStart}`) }).first()
  await link.waitFor()
  await link.click()
  await page.locator('main h1').waitFor()
  await settled(page)
}

const titles = async (page) => {
  const body = await (await page.request.get(`${origin}/api/messages`)).json()
  return body.items.map((m) => m.title)
}

describe('deleting a message (H-3700)', () => {
  test('the sender deletes from the detail with no dialog, is back on the list without it, and Deshacer restores it', async () => {
    const { page, context } = await session('bruno')
    try {
      const title = 'Definir el tamaño máximo de un video'
      await openFromList(page, 'Definir el tamaño')
      const del = page.getByRole('button', { name: 'Borrar', exact: true })
      // «Borrar» depends on /api/me, which can arrive after the page settled under load.
      await del.waitFor({ timeout: 5000 }).catch(() => {})
      assert.equal(await del.count(), 1, 'the sender sees «Borrar»')
      assert.equal(await page.getByRole('dialog').count(), 0)
      await del.click()
      // No dialog: it is done and the list this came from is shown again.
      assert.equal(await page.getByRole('dialog').count(), 0, 'no confirmation dialog')
      await page.waitForURL((u) => u.pathname === '/messages')
      await settled(page)
      assert.ok(!(await titles(page)).includes(title), 'the message is out of the list')
      assert.equal(await page.getByRole('link', { name: new RegExp(`^${title}`) }).count(), 0, 'and out of the screen')
      // The strip says so and carries Deshacer.
      const notice = page.locator('[data-notice]')
      await notice.waitFor()
      assert.match(await notice.innerText(), /Mensaje borrado/)
      await notice.getByRole('button', { name: 'Deshacer', exact: true }).click()
      await page.locator('[data-notice]', { hasText: 'Mensaje restaurado' }).waitFor()
      await settled(page)
      assert.ok((await titles(page)).includes(title), 'the message is back')
      await page.getByRole('link', { name: new RegExp(`^${title}`) }).first().waitFor()
      // The strip links to what came back.
      await page.locator('[data-notice]').getByRole('link', { name: title }).click()
      await page.locator('main h1', { hasText: title }).waitFor()
    } finally {
      await context.close()
    }
  })

  test('another member and the Editor both see «Borrar» on a message that is not theirs (UD-287)', async () => {
    const { page, context } = await session('carla')
    try {
      await openFromList(page, 'Definir el tamaño')
      await page.getByRole('button', { name: 'Borrar', exact: true }).waitFor({ timeout: 5000 }).catch(() => {})
      assert.equal(await page.getByRole('button', { name: 'Borrar', exact: true }).count(), 1, 'any person of the team deletes any message')
    } finally {
      await context.close()
    }
    const editor = await session('ana')
    try {
      await openFromList(editor.page, 'Definir el tamaño')
      await editor.page.getByRole('button', { name: 'Borrar', exact: true }).waitFor({ timeout: 5000 }).catch(() => {})
      assert.equal(await editor.page.getByRole('button', { name: 'Borrar', exact: true }).count(), 1, 'the Editor deletes any message too')
    } finally {
      await editor.context.close()
    }
  })
})

describe('deleting a reply (H-3701)', () => {
  test('the Editor deletes a reply where it is; the row says so with Deshacer, the count follows, and Deshacer brings it back', async () => {
    const { page, context } = await session('ana')
    try {
      await openFromList(page, 'Agregar exportación')
      const thread = page.locator('section[aria-label="Respuestas"]')
      const count = page.getByTestId('reply-count').locator('span').last() // the counter sits next to the title (V4)
      assert.equal(await count.innerText(), '2')
      const diegoRow = thread.locator('article', { hasText: 'CSV alcanza.' })
      await diegoRow.waitFor()
      assert.equal(await page.getByRole('dialog').count(), 0)
      await diegoRow.getByRole('button', { name: 'Borrar respuesta' }).click()
      assert.equal(await page.getByRole('dialog').count(), 0, 'no confirmation dialog')
      // The reply is gone from the thread; the row where it was says so and carries Deshacer.
      const removed = thread.getByRole('status').filter({ hasText: 'Respuesta de Diego Prueba borrada' })
      await removed.waitFor()
      await settled(page)
      assert.equal(await thread.locator('article', { hasText: 'CSV alcanza.' }).count(), 0)
      assert.equal(await count.innerText(), '1', 'the count follows')
      const api = await (await page.request.get(`${origin}/api/messages?q=exportaci%C3%B3n`)).json()
      assert.equal(api.items[0].reply_count, 1)
      await removed.getByRole('button', { name: 'Deshacer', exact: true }).click()
      await thread.locator('article', { hasText: 'CSV alcanza.' }).waitFor()
      await settled(page)
      assert.equal(await removed.count(), 0, 'the deleted row leaves with the reply back')
      assert.equal(await count.innerText(), '2')
    } finally {
      await context.close()
    }
  })

  test('deleting the only reply returns the message to Abierto; any person of the team sees «Borrar respuesta» (UD-287)', async () => {
    const { page, context } = await session('bruno')
    try {
      // «Arreglar el error al iniciar sesión…» has one reply, by Bruno; Carla sent the message.
      await openFromList(page, 'Arreglar el error')
      const thread = page.locator('section[aria-label="Respuestas"]')
      assert.equal(await thread.getByRole('button', { name: 'Borrar respuesta' }).count(), 1)
      await thread.getByRole('button', { name: 'Borrar respuesta' }).click()
      await thread.getByRole('status').filter({ hasText: 'borrada' }).waitFor()
      await settled(page)
      const status = page.locator('main').getByText(/^Abierto$/).first()
      await status.waitFor()
      const api = await (await page.request.get(`${origin}/api/messages?q=may%C3%BAsculas`)).json()
      assert.equal(api.items[0].status, 'open')
      await thread.getByRole('button', { name: 'Deshacer', exact: true }).click()
      await page.locator('main').getByText(/^Respondido$/).first().waitFor()
    } finally {
      await context.close()
    }
    const other = await session('carla')
    try {
      await openFromList(other.page, 'Arreglar el error')
      assert.equal(await other.page.locator('section[aria-label="Respuestas"]').getByRole('button', { name: 'Borrar respuesta' }).count(), 1, 'Carla did not write it and still deletes it')
    } finally {
      await other.context.close()
    }
  })
})
