// E2: with an expired or invalid session, the platform takes the person to the host's entry, which works, and then brings her back to the page she asked for.
// It never shows a form that recognizes nobody (message of 2026-10-25 17:45: the host site showed a sign-in form whose credentials did not exist there).
// The host is a local server that signs people in like the real one (`startFakeHost`): the sign-in is the DiscourseConnect-style redirect of the platform (`sso-redirect`).
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { freePort, harness, startFakeHost } from './harness.mjs'

let h
let host
let server

before(async () => {
  h = await harness()
  host = await startFakeHost({ email: 'ana@e2e.invalid', name: 'Ana Editora' })
  const port = await freePort() // the server must name its own address in its configuration
  server = await h.another({
    port,
    config: {
      publicUrl: `http://127.0.0.1:${port}`,
      identity: { provider: 'local,sso-redirect', provision: 'closed', delegated: { mode: 'sso-redirect', sso: { loginUrl: `${host.origin}/entrada`, secret: host.secret } } }
    }
  })
})
after(async () => { await host?.close() })

/** A browser with no session that records every time the local sign-in form is drawn, across navigations. */
async function stranger (cookies = []) {
  const context = await h.browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-CL' })
  if (cookies.length) await context.addCookies(cookies)
  const page = await context.newPage()
  const forms = []
  page.on('console', (m) => { if (m.text() === 'E2-SAW-LOGIN-FORM') forms.push(page.url()) })
  await page.addInitScript(() => {
    const look = () => { if (document.querySelector('main[data-screen="login"], input[type="password"]')) console.log('E2-SAW-LOGIN-FORM') }
    new MutationObserver(look).observe(document, { childList: true, subtree: true })
    document.addEventListener('DOMContentLoaded', look)
  })
  return { context, page, forms }
}

const messageOf = async (title) => h.message(title, { as: 'bruno', recipients: ['ana'], origin: server.origin, server })

describe('E2: an expired or invalid session goes to the host entry and comes back', () => {
  test('E2: with no session, opening a message goes through the host and lands on that message, signed in, without the local form', async () => {
    const title = h.unique('E2 sin sesión')
    const id = await messageOf(title)
    const before = host.hits.length
    const { context, page, forms } = await stranger()
    try {
      await page.goto(`${server.origin}/messages/${id}`)
      await page.waitForURL((url) => url.origin === server.origin && !url.pathname.startsWith('/api/'), { timeout: 15000 }).catch(() => {})
      await page.locator('main#main, main[data-screen="login"]').first().waitFor({ timeout: 15000 })
      assert.equal(forms.length, 0, `E2: the sign-in form of the platform was drawn (${forms.join(', ')}); it recognizes nobody when the host governs the identity`)
      assert.ok(host.hits.length > before, 'E2: the person was never taken to the host entry')
      assert.equal(new URL(page.url()).pathname, `/messages/${id}`, `E2: after signing in the person is at ${new URL(page.url()).pathname}, not at the page she asked for`)
      await page.getByRole('heading', { level: 1, name: new RegExp(title) }).waitFor({ timeout: 10000 })
      assert.equal((await context.request.get(`${server.origin}/api/me`)).status(), 200, 'E2: the session of the person is not open')
    } finally { await context.close() }
  })

  test('E2: with an invalid session cookie the same happens, and the garbage cookie does not stop it', async () => {
    const title = h.unique('E2 cookie inválida')
    const id = await messageOf(title)
    const before = host.hits.length
    const { context, page, forms } = await stranger([{ name: '__Host-session', value: 'basura-que-no-es-una-sesion', domain: '127.0.0.1', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }])
    try {
      await page.goto(`${server.origin}/messages/${id}`)
      await page.waitForURL((url) => url.origin === server.origin && !url.pathname.startsWith('/api/'), { timeout: 15000 }).catch(() => {})
      await page.locator('main#main, main[data-screen="login"]').first().waitFor({ timeout: 15000 })
      assert.equal(forms.length, 0, `E2: the sign-in form of the platform was drawn (${forms.join(', ')})`)
      assert.ok(host.hits.length > before, 'E2: the person was never taken to the host entry')
      assert.equal(new URL(page.url()).pathname, `/messages/${id}`, `E2: the person landed at ${new URL(page.url()).pathname} instead of the page she asked for`)
      await page.getByRole('heading', { level: 1, name: new RegExp(title) }).waitFor({ timeout: 10000 })
    } finally { await context.close() }
  })

  test('E2: with a session that expired on the server the same happens', async () => {
    const title = h.unique('E2 vencida')
    const id = await messageOf(title)
    // Diego, so that the sessions of the other tests (Ana's) are not the ones that expire.
    const { context, page } = await h.open('diego', { origin: server.origin })
    try {
      await page.goto(`${server.origin}/messages/${id}`)
      await page.getByRole('heading', { level: 1, name: new RegExp(title) }).waitFor()
      server.db.prepare('UPDATE sessions SET expires_at = 1 WHERE member_id = ?').run(server.people.diego.id) // the session is over on the server; the cookie is still in the browser
      const before = host.hits.length
      const forms = []
      page.on('console', (m) => { if (m.text() === 'E2-SAW-LOGIN-FORM') forms.push(page.url()) })
      await page.addInitScript(() => { new MutationObserver(() => { if (document.querySelector('main[data-screen="login"], input[type="password"]')) console.log('E2-SAW-LOGIN-FORM') }).observe(document, { childList: true, subtree: true }) })
      await page.goto(`${server.origin}/messages/${id}`)
      await page.waitForURL((url) => url.origin === server.origin && !url.pathname.startsWith('/api/'), { timeout: 15000 }).catch(() => {})
      await page.locator('main#main, main[data-screen="login"]').first().waitFor({ timeout: 15000 })
      assert.equal(forms.length, 0, `E2: the sign-in form of the platform was drawn after the session expired (${forms.join(', ')})`)
      assert.ok(host.hits.length > before, 'E2: the person was never taken to the host entry')
      assert.equal(new URL(page.url()).pathname, `/messages/${id}`, `E2: the person landed at ${new URL(page.url()).pathname} instead of the page she asked for`)
    } finally { await context.close() }
  })

  test('E2: with a valid session the host is not asked: the page opens straight', async () => {
    const title = h.unique('E2 con sesión')
    const id = await messageOf(title)
    const { context, page } = await h.open('ana', { origin: server.origin })
    try {
      const before = host.hits.length
      await page.goto(`${server.origin}/messages/${id}`)
      await page.getByRole('heading', { level: 1, name: new RegExp(title) }).waitFor()
      assert.equal(host.hits.length, before, 'E2: a person with an open session was sent to the host anyway')
    } finally { await context.close() }
  })
})
