// «Cerrar sesión» does what it says, end to end: the session ends on the server, the shell leaves the screen and the entry form is drawn.
// Before 2026-10-26 the query cache was cleared from under the root's session observer: the cookie was gone, but the shell stayed with the
// old lists and an anonymous avatar, and no way to sign in again without reloading.
import assert from 'node:assert'
import { after, before, test } from 'node:test'
import { login, startPanel } from './browser-support.mjs'

let panel

before(async () => {
  panel = await startPanel(0, { build: false })
})

after(async () => {
  await panel?.stop()
})

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`signing out at ${viewport.width}px leaves the shell and draws the entry form`, async () => {
    const context = await panel.browser.newContext({ viewport, locale: 'es-CL' })
    try {
      const page = await context.newPage()
      await login(page, panel.origin, 'ana')
      if (viewport.width < 1024) await page.getByRole('button', { name: 'Abrir navegación' }).click()
      await page.getByRole('button', { name: 'Cerrar sesión' }).click()
      await page.getByLabel('Correo').waitFor()
      assert.equal(await page.locator('main#main').count(), 0, 'the signed-in shell is still on screen')
      const me = await page.request.get(`${panel.origin}/api/me`)
      assert.equal(me.status(), 401, 'the server still holds the session')
      // The same tab signs in again without a reload.
      await page.getByLabel('Correo').fill('bruno@dev.invalid')
      await page.getByLabel('Contraseña').fill('x'.repeat(16))
      await page.getByRole('button', { name: 'Entrar' }).click()
      await page.locator('main#main').waitFor()
      assert.equal((await (await page.request.get(`${panel.origin}/api/me`)).json()).name, 'Bruno Prueba')
    } finally {
      await context.close()
    }
  })
}
