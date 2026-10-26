// UD-253 (H-3715): several things are marked and deleted at once, without a confirmation, and Deshacer brings them all back.
// Messages (Mensajes and the view of an area), areas and the templates of an area. A member only marks their own messages.
// The height of the rows with the check box, on a phone too, is measured by flows-tarjetas-vistazo (the Editor sees a box in every row).
// `PANEL_FLOWS_BULK_PORT=… node --test src/flows-borrado-multiple.browser.test.mjs` against dev-server.mjs serving panel/dist.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_BULK_PORT ?? 8454), { stepMs: 80 })
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

const titles = (page) => page.$$eval('main article h3', (hs) => hs.map((h) => h.textContent.trim()))
const noDialog = async (page) => assert.equal(await page.locator('[role="dialog"], [role="alertdialog"]').count(), 0, 'deleting asks nothing')

describe('mark several and delete them at once (UD-253)', () => {
  test('Mensajes: three marked, Borrar without a dialog, the notice says how many and Deshacer brings the three back', async () => {
    const { page, context } = await session('ana')
    try {
      await page.goto(`${origin}/messages`)
      const checks = page.getByTestId('row-check')
      await checks.nth(2).waitFor()
      assert.equal(await page.getByTestId('selection-bar').count(), 0, 'no strip until something is marked')
      const before = await titles(page)
      const rows = page.locator('main article').filter({ has: page.getByTestId('row-check') })
      const chosen = []
      for (let i = 0; i < 3; i++) {
        const row = rows.nth(i)
        chosen.push((await row.locator('h3').textContent()).trim())
        await row.getByTestId('row-check').click()
      }
      const bar = page.getByTestId('selection-bar')
      await bar.getByText('3 marcados').waitFor()
      await bar.getByRole('button', { name: 'Borrar' }).click()
      await page.getByText('3 mensajes borrados').first().waitFor()
      await noDialog(page)
      await page.waitForFunction((gone) => ![...document.querySelectorAll('main article h3')].some((h) => gone.includes(h.textContent.trim())), chosen)
      assert.equal(await bar.count(), 0, 'the strip leaves with the deleted rows')
      await page.getByRole('button', { name: 'Deshacer' }).first().click()
      await page.getByText('3 mensajes restaurados').first().waitFor()
      await page.waitForFunction((back) => back.every((t) => [...document.querySelectorAll('main article h3')].some((h) => h.textContent.trim() === t)), chosen)
      assert.deepEqual((await titles(page)).sort(), before.sort())
      await settled(page)
    } finally {
      await context.close()
    }
  })

  test('the mark-all button marks every row of the page that can be deleted, and Escape unmarks them', async () => {
    const { page, context } = await session('ana')
    try {
      await page.goto(`${origin}/messages`)
      const checks = page.getByTestId('row-check')
      await checks.nth(1).waitFor()
      await checks.first().click()
      const bar = page.getByTestId('selection-bar')
      await bar.getByText('1 marcado').waitFor()
      await bar.getByRole('button', { name: 'Marcar todos' }).click()
      await settled(page)
      const n = await checks.count()
      assert.ok(n > 1, 'the page holds more than one message')
      await bar.getByText(`${n} marcados`).waitFor()
      assert.equal(await page.locator('main article[data-marked]').count(), n)
      await page.keyboard.press('Escape')
      await bar.waitFor({ state: 'detached' })
      assert.equal(await page.locator('main article[data-marked]').count(), 0)
      await settled(page)
    } finally {
      await context.close()
    }
  })

  test('Áreas: two marked areas are deleted at once and Deshacer brings them back', async () => {
    const { page, context } = await session('ana')
    try {
      await page.goto(`${origin}/areas`)
      const rows = page.locator('main section').filter({ has: page.getByTestId('area-delete') })
      await rows.nth(1).waitFor()
      const count = await rows.count()
      const names = []
      for (let i = 0; i < 2; i++) {
        names.push((await rows.nth(i).locator('a').first().textContent()).trim())
        await rows.nth(i).getByTestId('row-check').click()
      }
      await page.getByTestId('selection-bar').getByRole('button', { name: 'Borrar' }).click()
      await page.getByText('2 áreas borradas').first().waitFor()
      await noDialog(page)
      await page.waitForFunction((n) => document.querySelectorAll('[data-testid="area-delete"]').length === n - 2, count)
      await page.getByRole('button', { name: 'Deshacer' }).first().click()
      await page.waitForFunction((n) => document.querySelectorAll('[data-testid="area-delete"]').length === n, count)
      for (const name of names) await page.locator('main section a').filter({ hasText: name }).first().waitFor()
      await settled(page)
    } finally {
      await context.close()
    }
  })

  test('Plantillas: two marked templates of an area are deleted at once and Deshacer brings them back', async () => {
    const { page, context } = await session('ana')
    try {
      await page.goto(`${origin}/areas/a-error`)
      const region = page.getByRole('region', { name: 'Plantillas' })
      // Depending on the window the templates share the page or are paged: the marks stay while the person pages.
      const checks = region.getByTestId('row-check')
      await checks.first().waitFor()
      await settled(page)
      const range = region.getByText(/^1–\d+ de \d+$/)
      const paged = (await range.count()) > 0
      const live = paged ? Number((await range.textContent()).split(' de ')[1]) : await checks.count()
      await checks.first().click()
      const bar = region.getByTestId('selection-bar')
      await bar.getByText('1 marcado').waitFor()
      // The strip of marked rows takes height, so a list that fit before may now be paged: go to the page that holds the other row.
      const unchecked = region.locator('[data-testid="row-check"]:not([data-state="checked"])')
      await settled(page)
      if ((await unchecked.count()) === 0) await region.getByRole('button', { name: 'Página siguiente' }).click()
      await region.locator('[data-testid="row-check"]:not([data-state="checked"])').first().click()
      await bar.getByText('2 marcados').waitFor()
      await bar.getByRole('button', { name: 'Borrar' }).click()
      await page.getByText('2 plantillas borradas').first().waitFor()
      await noDialog(page)
      await page.waitForFunction((n) => document.querySelector('section[aria-label="Plantillas"]').textContent.includes(`de ${n - 2}`) || document.querySelectorAll('section[aria-label="Plantillas"] button[aria-label^="Borrar "]').length === n - 2, live)
      await page.getByRole('button', { name: 'Deshacer' }).first().click()
      await page.waitForFunction((n) => document.querySelector('section[aria-label="Plantillas"]').textContent.includes(`de ${n}`) || document.querySelectorAll('section[aria-label="Plantillas"] button[aria-label^="Borrar "]').length === n, live)
      await settled(page)
    } finally {
      await context.close()
    }
  })

  test('a member has a check box on every message, theirs or not (UD-287)', async () => {
    const { page, context } = await session('bruno')
    try {
      await page.goto(`${origin}/messages`)
      await page.locator('main article h3').first().waitFor()
      // «video» matches «Definir el tamaño máximo de un video», sent by Bruno, and a recording sent by Diego.
      await page.getByRole('searchbox').fill('video')
      await page.getByTestId('row-check').first().waitFor()
      await settled(page)
      const counts = await page.$$eval('main article', (rows) => ({
        rows: rows.length,
        checks: rows.filter((r) => r.querySelector('[data-testid="row-check"]')).length,
        both: rows.filter((r) => !!r.querySelector('[data-testid="row-check"]') === !!r.querySelector('[data-testid="card-delete"]')).length,
      }))
      assert.ok(counts.rows > 1, `the search finds Bruno's and others' messages: ${JSON.stringify(counts)}`)
      assert.equal(counts.checks, counts.rows, 'every row has a check box')
      assert.equal(counts.both, counts.rows, 'a row has a check box exactly when it has the delete button')
      await settled(page)
    } finally {
      await context.close()
    }
  })

})
