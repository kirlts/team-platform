// UD-250 (H-3706): what was deleted comes back from the screen after a reload. Areas, templates, messages and discarded
// sends are listed behind a one-word control and restored with one click; the row returns to its list without reloading.
// `PANEL_FLOWS_RESTORE_PORT=… node --test src/flows-restaurar.browser.test.mjs` against dev-server.mjs serving panel/dist.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

// Auto-publication off: a send waits as a proposal, which is the state a person discards.
process.env.PANEL_DEV_AUTO_PUBLISH = '0'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_RESTORE_PORT ?? 8453), { stepMs: 80 })
  origin = panel.origin
})
beforeEach(async () => {
  await panel.control.reset()
})
after(async () => {
  await panel?.stop()
})

async function session(who = 'ana') {
  const context = await panel.browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-CL', colorScheme: 'light' })
  const page = await context.newPage()
  await login(page, origin, who)
  return { page, context }
}

describe('restore what was deleted, after a reload (UD-250)', () => {
  test('an area: delete, reload, Borradas lists it muted without counts, Restaurar moves it to the live rows', async () => {
    const { page, context } = await session('ana')
    try {
      await page.goto(`${origin}/areas`)
      const del = page.getByTestId('area-delete')
      await del.first().waitFor()
      const row = page.locator('main section').filter({ has: del.first() }).first()
      const title = (await row.locator('a').first().textContent()).trim()
      await del.first().click()
      await page.getByText('Área borrada').first().waitFor()
      await page.reload()
      await del.first().waitFor()
      assert.equal(await page.getByTestId('area-restore').count(), 0, 'deleted areas are hidden until asked for')
      await page.getByTestId('show-deleted').click()
      const deleted = page.locator('[data-deleted="true"]').filter({ hasText: title })
      await deleted.waitFor()
      assert.equal(await deleted.getByTestId('zero-count').count(), 0, 'no counters on a deleted area')
      const live = await del.count()
      await deleted.getByRole('button', { name: 'Restaurar' }).click()
      await page.waitForFunction((n) => document.querySelectorAll('[data-testid="area-delete"]').length === n + 1, live)
      assert.equal(await page.locator('[data-deleted="true"]').count(), 0)
      await settled(page)
    } finally {
      await context.close()
    }
  })

  test('a message: delete, reload, the «Borrados» filter lists it with Restaurar and no link, and it returns to the list', async () => {
    const { page, context } = await session('ana')
    try {
      await page.goto(`${origin}/messages`)
      const del = page.getByTestId('card-delete')
      await del.first().waitFor()
      const row = page.locator('main article').filter({ has: del }).first()
      const title = (await row.locator('h3').textContent()).trim()
      await row.getByTestId('card-delete').click()
      await page.getByText('Mensaje borrado').first().waitFor()
      await page.reload()
      await page.locator('main article h3').first().waitFor()
      await page.getByRole('button', { name: /^Filtro/ }).click()
      await page.getByRole('menuitemcheckbox', { name: 'Borrados' }).click()
      const card = page.locator('main article[data-deleted="true"]').filter({ hasText: title })
      await card.waitFor()
      assert.equal(await card.locator('a').count(), 0, 'a deleted message has no link to a detail that answers 404')
      assert.equal(await card.getByRole('button', { name: 'Cerrar' }).count(), 0)
      await card.getByRole('button', { name: /^Restaurar/ }).click()
      await page.waitForFunction((t) => ![...document.querySelectorAll('main article h3')].some((h) => h.textContent.trim() === t), title)
      await page.getByRole('button', { name: 'Quitar el filtro Borrados' }).click()
      await page.waitForFunction((t) => [...document.querySelectorAll('main article h3')].some((h) => h.textContent.trim() === t), title)
      await settled(page)
    } finally {
      await context.close()
    }
  })

  test('a template: delete, reload, Borradas inside Plantillas lists it and Restaurar brings it back', async () => {
    const { page, context } = await session('ana')
    try {
      // «Plantillas» is open by default (UD-252): no click to open it.
      await page.goto(`${origin}/areas/a-error`)
      const region = page.getByRole('region', { name: 'Plantillas' })
      await region.waitFor()
      await region.getByRole('button', { name: /^Eliminar/ }).first().click()
      await region.getByText('eliminada').first().waitFor()
      await page.reload()
      await region.waitFor()
      await region.getByTestId('show-deleted').click()
      const deleted = region.locator('[data-deleted="true"]')
      // The deleted rows come after the live ones; since «Salida» (H-3723) made each row taller, the list shows one row per page at this window.
      const next = region.getByRole('button', { name: 'Página siguiente' })
      await region.getByText('1–1 de 2').waitFor()
      await next.click()
      await deleted.waitFor()
      assert.ok((await deleted.first().textContent()).length > 0)
      const restoredName = (await deleted.first().locator('span').first().textContent()).trim()
      await deleted.first().getByRole('button', { name: 'Restaurar' }).click()
      await region.locator('[data-deleted="true"]').waitFor({ state: 'detached' })
      // It is a live row again, on whichever page the list puts it.
      const back = region.getByRole('button', { name: `Eliminar ${restoredName}`, exact: true })
      if (!(await back.isVisible())) await region.getByRole('button', { name: 'Página anterior' }).click()
      await back.waitFor()
      await settled(page)
    } finally {
      await context.close()
    }
  })
})
