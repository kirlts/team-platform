// UD-240, H-3703: an Editor deletes a member from Equipo, in a real browser against dev-server.mjs serving panel/dist
// (`npm run test:flows`). UD-253: «Eliminar» deletes with one click, with everything of theirs, and no step that confirms it;
// the notice says how much went. «Desactivar» stays as the other way out.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_ELIMINAR_PORT ?? 8939), { stepMs: 80 })
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
  await page.goto(`${origin}/team`)
  await page.getByRole('button', { name: 'Agregar miembro' }).or(page.getByText('Perfil', { exact: true })).first().waitFor()
  await settled(page)
  return { page, context }
}

const rowOf = (page, email) => page.locator('main div.border-b').filter({ hasText: email }).first()
/** The list pages within the frame (UD-017): the row of a member added last may sit on a later page. */
async function findRow(page, email) {
  for (let guard = 0; guard < 8; guard++) {
    const row = rowOf(page, email)
    if ((await row.count()) > 0) return row
    const next = page.getByRole('button', { name: 'Página siguiente' })
    assert.ok((await next.count()) > 0 && (await next.isEnabled()), `${email}: not on any page`)
    await next.click()
    await settled(page)
  }
  throw new Error(`${email}: not found after paging`)
}
const members = (page) => page.evaluate(async () => ((b) => b.items ?? b)(await (await fetch('/api/members')).json()))

describe('Eliminar un miembro', () => {
  test('the Editor sees «Eliminar» on every other row and not on their own; a member sees none', async () => {
    const { page, context } = await session('ana')
    try {
      assert.equal(await rowOf(page, 'ana@dev.invalid').getByRole('button', { name: 'Eliminar a' }).count(), 0, 'own row offers deletion')
      assert.ok((await rowOf(page, 'eduardo@dev.invalid').getByRole('button', { name: 'Eliminar a Eduardo Valenzuela Ibáñez' }).count()) === 1)
    } finally {
      await context.close()
    }
    const other = await session('bruno')
    try {
      assert.equal(await other.page.getByRole('button', { name: /^Eliminar/ }).count(), 0, 'a member sees a delete button')
    } finally {
      await other.context.close()
    }
  })

  test('without history: one click on «Eliminar» removes the row, with no dialog and no step that confirms it', async () => {
    const { page, context } = await session('ana')
    try {
      // Every sample member is assigned to some message, which is history: a fresh member is the one without any.
      await page.getByRole('button', { name: 'Agregar miembro' }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByLabel('Nombre').fill('Nuevo Sin Historial')
      await dialog.getByLabel('Correo').fill('nuevo@dev.invalid')
      await dialog.getByRole('button', { name: 'Crear' }).click()
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
      await settled(page)
      const row = await findRow(page, 'nuevo@dev.invalid')
      await row.getByRole('button', { name: 'Eliminar a Nuevo Sin Historial' }).click()
      await page.locator('[data-notice]').getByText('Nuevo Sin Historial eliminado', { exact: true }).waitFor()
      assert.equal(await page.getByRole('dialog').count(), 0, 'a dialog opened')
      await settled(page)
      assert.equal(await rowOf(page, 'nuevo@dev.invalid').count(), 0, 'the row is still there')
      assert.ok(!(await members(page)).some((m) => m.email === 'nuevo@dev.invalid'), 'the server still lists him')
    } finally {
      await context.close()
    }
  })

  test('with history: one click deletes him with his messages and replies, and the notice gives the figures', async () => {
    const { page, context } = await session('ana')
    try {
      const expected = await page.evaluate(async () => {
        const list = ((b) => b.items ?? b)(await (await fetch('/api/messages?limit=100')).json())
        const mine = list.filter((m) => m.author_id === 'u-bruno')
        let replies = 0
        for (const m of list) {
          const d = await (await fetch(`/api/messages/${m.id}`)).json()
          replies += (d.replies ?? []).filter((r) => r.author_id === 'u-bruno').length
        }
        return { messages: mine.length, replies, ids: mine.map((m) => m.id) }
      })
      assert.ok(expected.messages > 0 && expected.replies > 0, 'Bruno has no history in the sample data')
      const row = rowOf(page, 'bruno@dev.invalid')
      await row.getByRole('button', { name: 'Eliminar a Bruno Prueba' }).click()
      await page.locator('[data-notice]').getByText(`Bruno Prueba eliminado · Envíos 0 · Mensajes ${expected.messages} · Respuestas ${expected.replies}`, { exact: true }).waitFor()
      assert.equal(await page.getByRole('dialog').count(), 0, 'a dialog opened')
      await settled(page)
      assert.equal(await rowOf(page, 'bruno@dev.invalid').count(), 0)
      assert.ok(!(await members(page)).some((m) => m.email === 'bruno@dev.invalid'), 'the server still lists him')
      const left = await page.evaluate(async () => ((b) => b.items ?? b)(await (await fetch('/api/messages?limit=100')).json()).map((m) => m.id))
      for (const id of expected.ids) assert.ok(!left.includes(id), `message ${id} of Bruno survived`)
    } finally {
      await context.close()
    }
  })

  test('«Desactivar» sits beside «Eliminar» and deactivates without deleting', async () => {
    const { page, context } = await session('ana')
    try {
      const row = rowOf(page, 'carla@dev.invalid')
      assert.equal(await row.getByRole('button', { name: 'Eliminar a Carla Prueba' }).count(), 1)
      await row.getByRole('button', { name: 'Desactivar a Carla Prueba' }).click()
      await row.getByText('Inactivo').waitFor()
      await settled(page)
      assert.equal((await members(page)).find((m) => m.email === 'carla@dev.invalid')?.active, false)
    } finally {
      await context.close()
    }
  })
})
