// TP-14 (soft-locks 2026-11-04): a window with an identity of its own (the Guards of an area, the menu of a phone) is a state of the address, `?v=<id>`.
// Atrás closes the window and the page stays where it was; the address pasted in another tab shows the page with the window open; Escape on a window
// reached by the address removes `v` in place and does not leave the page. Every check is a prohibition: Atrás must not leave the page with a window open.
// `PANEL_FLOWS_VENTANA_PORT=… node --test src/every-window-closes-with-back.browser.test.mjs` against dev-server.mjs serving panel/dist.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_VENTANA_PORT ?? 9211), { stepMs: 40 })
  origin = panel.origin
})
beforeEach(async () => {
  await panel.control.reset()
})
after(async () => {
  await panel?.stop()
})

async function session(viewport = { width: 1440, height: 900 }) {
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL', colorScheme: 'light' })
  const page = await context.newPage()
  await login(page, origin, 'ana')
  await settled(page)
  return { page, context }
}

const dialog = (page) => page.getByRole('dialog')

async function firstAreaPath(page) {
  const res = await page.context().request.get(`${origin}/api/areas`)
  const area = (await res.json()).items[0]
  return `/areas/${area.id}`
}

describe('Atrás closes a window and stays in the page (TP-14)', () => {
  test('the Guards of an area: open, Atrás closes the window and keeps the area', async () => {
    const { page, context } = await session()
    try {
      const path = await firstAreaPath(page)
      await page.goto(`${origin}${path}`)
      await page.getByTestId('area-guards-open').click()
      await dialog(page).waitFor()
      assert.match(page.url(), /[?&]v=guards\b/)
      await page.goBack()
      await dialog(page).waitFor({ state: 'detached' })
      assert.equal(new URL(page.url()).pathname, path, 'Atrás stays in the area')
      assert.doesNotMatch(page.url(), /v=guards/)
    } finally {
      await context.close()
    }
  })

  test('the address with the window opens the page with the window, and Escape closes it without leaving', async () => {
    const { page, context } = await session()
    try {
      const path = await firstAreaPath(page)
      await page.goto(`${origin}${path}?v=guards`)
      await dialog(page).waitFor()
      await page.keyboard.press('Escape')
      await dialog(page).waitFor({ state: 'detached' })
      assert.equal(new URL(page.url()).pathname, path)
      assert.doesNotMatch(page.url(), /v=guards/)
      // The entry of the window was replaced, not added: Atrás leaves the area for the page before it.
      await page.goBack()
      assert.notEqual(new URL(page.url()).pathname, path)
    } finally {
      await context.close()
    }
  })

  test('the menu of a phone is a window too: Atrás closes it', async () => {
    const { page, context } = await session({ width: 390, height: 844 })
    try {
      await page.getByTestId('nav-open').click()
      await dialog(page).waitFor()
      assert.match(page.url(), /[?&]v=menu\b/)
      await page.goBack()
      await dialog(page).waitFor({ state: 'detached' })
      assert.equal(new URL(page.url()).pathname, '/')
    } finally {
      await context.close()
    }
  })

  test('a link of the menu takes the place of the window in the history: Atrás returns to the page that opened it', async () => {
    const { page, context } = await session({ width: 390, height: 844 })
    try {
      await page.getByTestId('nav-open').click()
      await dialog(page).waitFor()
      await dialog(page).locator('a[href$="/team"]').click()
      await page.waitForURL(/\/team$/)
      await dialog(page).waitFor({ state: 'detached' })
      await page.goBack()
      await page.waitForURL((url) => url.pathname === '/')
      assert.equal(await dialog(page).count(), 0, 'the menu does not reopen')
    } finally {
      await context.close()
    }
  })
})
