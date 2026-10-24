// UD-240: the delete button is where the thing is listed, not only in its detail. A row of Mensajes has its trash icon for the
// sender or the Editor, and a row of Áreas and the view of an area have theirs for the Editor; each is done with no dialog and
// Deshacer brings it back. `PANEL_FLOWS_PORT=… node --test src/flows-borrar-lista.browser.test.mjs`.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_PORT ?? 8816), { stepMs: 80 })
  origin = panel.origin
})
beforeEach(async () => {
  await panel.control.reset()
})
after(async () => {
  await panel?.stop()
})

async function session(who = 'ana', viewport = { width: 1440, height: 900 }) {
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL', colorScheme: 'light' })
  const page = await context.newPage()
  await login(page, origin, who)
  return { page, context }
}

describe('delete from the lists', () => {
  test('a row of Mensajes has its trash icon for the sender or the Editor; deleting takes the row out and Deshacer brings it back', async () => {
    const { page, context } = await session('ana')
    try {
      await page.goto(`${origin}/messages`)
      const del = page.getByTestId('card-delete')
      await del.first().waitFor()
      const row = page.locator('main article').filter({ has: del }).first()
      const title = (await row.locator('h3').textContent()).trim()
      await row.getByTestId('card-delete').click()
      await page.getByText('Mensaje borrado').waitFor()
      await page.waitForFunction((t) => ![...document.querySelectorAll('main article h3')].some((h) => h.textContent.trim() === t), title)
      await page.getByRole('button', { name: 'Deshacer' }).first().click()
      await page.waitForFunction((t) => [...document.querySelectorAll('main article h3')].some((h) => h.textContent.trim() === t), title)
      await settled(page)
    } finally {
      await context.close()
    }
  })

  test('the actions of every row end at the same right edge, with or without the trash icon', async () => {
    const { page, context } = await session('ana')
    try {
      await page.goto(`${origin}/messages`)
      await page.getByTestId('card-foot').first().waitFor()
      await settled(page)
      const edges = await page.locator('main article').evaluateAll((rows) =>
        rows.map((a) => {
          const buttons = [...a.querySelectorAll('[data-testid="card-foot"] button, [data-testid="card-foot"] a')]
          return Math.round(Math.max(...buttons.map((b) => b.getBoundingClientRect().right)))
        }),
      )
      assert.ok(edges.length >= 2)
      assert.ok(Math.max(...edges) - Math.min(...edges) <= 1, `the right edges are ${edges.join(', ')}`)
    } finally {
      await context.close()
    }
  })

  test('the list of areas has a trash icon per area for the Editor: deleting takes the area out of the list and the sidebar, and Deshacer brings it back', async () => {
    const { page, context } = await session('ana')
    try {
      await page.goto(`${origin}/areas`)
      const del = page.getByTestId('area-delete')
      await del.first().waitFor()
      const before = await del.count()
      await del.first().click()
      await page.getByText('Área borrada').waitFor()
      await page.waitForFunction((n) => document.querySelectorAll('[data-testid="area-delete"]').length === n - 1, before)
      await page.getByRole('button', { name: 'Deshacer' }).first().click()
      await page.waitForFunction((n) => document.querySelectorAll('[data-testid="area-delete"]').length === n, before)
    } finally {
      await context.close()
    }
  })

  test('the view of an area has «Borrar área» for the Editor: it returns to the list, and Deshacer restores the area', async () => {
    const { page, context } = await session('ana')
    try {
      await page.goto(`${origin}/areas/a-error`)
      // Rarely used, so it sits in the «Más» menu of the header (the guide: what is used now and then goes to one menu).
      await page.locator('main header').getByTestId('more-menu').click()
      await page.getByTestId('area-delete').click()
      await page.waitForURL(/\/areas$/)
      await page.getByText('Área borrada').waitFor()
      await page.getByRole('button', { name: 'Deshacer' }).first().click()
      await page.getByText('Área restaurada').waitFor()
      await page.goto(`${origin}/areas/a-error`)
      await page.locator('main header').getByTestId('more-menu').waitFor()
    } finally {
      await context.close()
    }
  })

  test('a member who is not an Editor sees no «Borrar área»', async () => {
    const { page, context } = await session('bruno')
    try {
      await page.goto(`${origin}/areas/a-error`)
      await page.locator('main h1').waitFor()
      await settled(page)
      assert.equal(await page.locator('main header').getByTestId('more-menu').count(), 0, 'a member without the Editor role has no menu to delete the area')
      assert.equal(await page.getByTestId('area-delete').count(), 0)
    } finally {
      await context.close()
    }
  })
})
