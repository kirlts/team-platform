// UD-308: when the 401 of /api/me names the host's entry, the panel goes there and draws no form; without it, the form stays.
import assert from 'node:assert'
import { after, before, test } from 'node:test'
import { settled, startPanel } from './browser-support.mjs'

let panel

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_HOST_ENTRY_PORT ?? 8929), { build: false })
})

after(async () => {
  await panel?.stop()
})

const unauthenticated = (body) => (route) =>
  route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ code: 'unauthenticated', message: 'Se requiere iniciar sesión.', ...body }) })

test('with a host entry in the 401, the panel redirects to it and never draws the sign-in form', async () => {
  const context = await panel.browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'es-CL' })
  try {
    const page = await context.newPage()
    await page.route(/\/api\/me$/, unauthenticated({ login_url: '/session/login' }))
    let target = ''
    await page.route(/\/session\/login/, (route) => {
      target = route.request().url()
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Entrada del anfitrion</title>' })
    })
    await page.goto(`${panel.origin}/mensajes`)
    await page.waitForURL(/\/session\/login/)
    assert.match(target, /\/session\/login\?next=%2Fmensajes$/)
    assert.equal(await page.locator('[data-screen="login"]').count(), 0)
  } finally {
    await context.close()
  }
})

test('without a host entry in the 401, the panel draws its own form', async () => {
  const context = await panel.browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'es-CL' })
  try {
    const page = await context.newPage()
    await page.route(/\/api\/me$/, unauthenticated({}))
    await page.goto(panel.origin)
    await page.locator('[data-screen="login"]').waitFor()
    await settled(page)
    assert.equal(await page.locator('[data-screen="host-login"]').count(), 0)
  } finally {
    await context.close()
  }
})
