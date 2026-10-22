// H-3721: the panel mounted under a path of another site. Served under /team/, it signs in, navigates, loads its
// lists, opens the event stream and loads attachments, and never asks the host for anything outside its base.
import assert from 'node:assert'
import { after, before, test } from 'node:test'
import { login, startPanel } from './browser-support.mjs'

const PORT = Number(process.env.PANEL_MOUNT_PORT ?? 8613)
const BASE = '/team/'
let panel

before(async () => {
  panel = await startPanel(PORT, { base: BASE })
})
after(async () => {
  await panel?.stop()
})

test('the panel served under /team/ navigates, loads lists, opens the event stream and loads attachments under its base', async () => {
  const page = await panel.browser.newPage({ viewport: { width: 1440, height: 900 } })
  const paths = []
  const failures = []
  page.on('request', (r) => {
    const u = new URL(r.url())
    if (u.origin === panel.host) paths.push(`${r.resourceType()} ${u.pathname}`)
  })
  page.on('response', (r) => {
    const u = new URL(r.url())
    if (u.origin === panel.host && r.status() >= 400) failures.push(`${r.status()} ${u.pathname}`)
  })
  const stream = page.waitForRequest((r) => r.resourceType() === 'eventsource' || new URL(r.url()).pathname.endsWith('/events'))
  const attachment = page.waitForResponse((r) => new URL(r.url()).pathname.startsWith(`${BASE}api/attachments/`) && r.ok())
  try {
    await login(page, panel.origin)
    assert.ok([BASE, '/team'].includes(new URL(page.url()).pathname), page.url())
    assert.equal(new URL((await stream).url()).pathname, `${BASE}api/events`)

    // Navigation keeps the base: the router has it as basename.
    const list = page.waitForResponse((r) => new URL(r.url()).pathname === `${BASE}api/messages` && r.ok())
    await page.getByRole('link', { name: /^Mensajes/ }).first().click()
    await page.waitForURL((u) => u.pathname === `${BASE}messages`)
    await list
    await page.locator('main#main a[href^="/team/messages/"]').first().waitFor()

    // A deep link under the base is the SPA, with its assets under the base.
    const href = await page.locator('main#main a[href^="/team/messages/"]').first().getAttribute('href')
    await page.goto(`${panel.host}${href}`)
    await page.locator('main#main').waitFor()
    assert.equal(new URL(page.url()).pathname, href)

    // Attachments: the image of a message is fetched from the API under the base.
    await page.goto(`${panel.origin}/messages`)
    await page.locator('main#main').waitFor()
    await attachment

    const outside = paths.filter((p) => !`${p.split(' ')[1]}/`.startsWith(BASE))
    assert.deepEqual(outside, [], 'every request of the panel stays under its base')
    assert.ok(paths.some((p) => p.startsWith('script /team/assets/')), 'the bundle loads from /team/assets/')
    assert.ok(paths.some((p) => p.startsWith('stylesheet /team/assets/')), 'the stylesheet loads from /team/assets/')
    assert.deepEqual(failures.filter((f) => f !== `401 ${BASE}api/me`), []) // before signing in, /me answers 401 by design
  } finally {
    await page.close()
  }
})

test('outside its base the panel answers nothing: the host keeps the rest of the paths', async () => {
  const outside = await fetch(`${panel.host}/messages`)
  assert.equal(outside.status, 404)
  const api = await fetch(`${panel.host}/api/health`)
  assert.equal(api.status, 404)
  const inside = await fetch(`${panel.origin}/api/health`)
  assert.equal(inside.status, 200)
  const index = await (await fetch(`${panel.origin}/areas`)).text()
  assert.match(index, /<meta name="team-base-path" content="\/team\/" \/>/)
  assert.match(index, /<meta name="team-api-base" content="\/team\/api" \/>/)
  assert.match(index, /src="\/team\/assets\//)
})
