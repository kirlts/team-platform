// H-901: the test sign-in returns when the person is inside, not when the sign-in page (which is also a <main>) is on screen.
// The server's answer to the sign-in is held, so «still signing in» is a state the test controls and not a race.
import assert from 'node:assert'
import { after, before, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

let panel

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_LOGIN_PORT ?? 8928), { build: false })
})

after(async () => {
  await panel?.stop()
})

test('login does not return while the sign-in is still waiting for the server', async () => {
  const context = await panel.browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-CL' })
  try {
    const page = await context.newPage()
    let reached = () => {}
    const intercepted = new Promise((resolve) => (reached = resolve))
    let answer = () => {}
    const gate = new Promise((resolve) => (answer = resolve))
    await page.route(/\/api\/auth\/login$/, async (route) => {
      reached()
      await gate
      await route.continue()
    })
    let returned = false
    const signing = login(page, panel.origin, 'ana', { form: true }).then(() => (returned = true))
    await intercepted
    await settled(page)
    assert.equal(returned, false, 'login returned with the entry page in view, before the server opened the session')
    answer()
    await signing
    await page.locator('main#main').first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
    assert.equal(await page.locator('main#main').count(), 1, 'the open session shows its shell')
  } finally {
    await context.close()
  }
})

test('while the sign-in waits for the server the entry says so: the button reads Entrando and the fields stop taking text (E3)', async () => {
  const context = await panel.browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-CL' })
  try {
    const page = await context.newPage()
    let reached = () => {}
    const intercepted = new Promise((resolve) => (reached = resolve))
    let answer = () => {}
    const gate = new Promise((resolve) => (answer = resolve))
    await page.route(/\/api\/auth\/login$/, async (route) => {
      reached()
      await gate
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ code: 'invalid_credentials', message: 'Correo o contraseña incorrectos' }) })
    })
    await page.goto(panel.origin)
    await page.getByLabel('Correo').fill('ana@dev.invalid')
    await page.getByLabel('Contraseña').fill('una-clave')
    await page.getByRole('button', { name: 'Entrar' }).click()
    await intercepted
    const button = page.getByRole('button', { name: 'Entrando' })
    await button.waitFor()
    assert.equal(await button.isDisabled(), true, 'the button cannot be pressed again')
    assert.equal(await page.getByLabel('Correo').getAttribute('readonly'), '', 'the email stops taking text')
    assert.equal(await page.getByLabel('Contraseña').getAttribute('readonly'), '', 'the password stops taking text')
    assert.equal(await page.locator('form').getAttribute('aria-busy'), 'true')
    answer()
    await page.getByRole('button', { name: 'Entrar' }).waitFor()
    assert.equal(await page.getByLabel('Correo').getAttribute('readonly'), null, 'the fields take text again after the refusal')
    assert.equal(await page.getByLabel('Correo').inputValue(), 'ana@dev.invalid', 'what was typed is kept')
  } finally {
    await context.close()
  }
})
