// E3: the local entry says why it is drawn and tells a bad password from an ended session (judge of Inicio, 2026-10-28, findings 1, 2, 3, 5 and 6), against a real server.
// A wrong pair answers 401 `invalid_credentials` («Correo o contraseña incorrectos»), never `unauthenticated` («La sesión terminó»); a wait says its real seconds and
// the card keeps its height; the reason is under the card; a session that ends with the page open is said by the entry, keeps the email and the text of the bar,
// and a screen drawn from memory (Equipo) also leads to the entry.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { harness, TEST_PASSWORD } from './harness.mjs'

let h
let server

before(async () => {
  h = await harness()
  server = await h.another({ config: { identity: { login: { ipMax: 100000, ipWindowMs: 1000 } } } })
})

const entry = async (viewport = { width: 1440, height: 900 }) => {
  const context = await h.browser.newContext({ viewport, locale: 'es-CL' })
  const page = await context.newPage()
  await page.goto(server.origin)
  await page.locator('form').waitFor()
  return { context, page }
}

describe('E3: the local entry says the cause', () => {
  test('E3: the API tells a wrong pair from an ended session', async () => {
    const wrong = await fetch(`${server.origin}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: server.origin }, body: JSON.stringify({ email: 'ana@e2e.invalid', password: 'una-clave-que-no-es-la-de-ana' }) })
    assert.equal(wrong.status, 401)
    assert.equal((await wrong.json()).code, 'invalid_credentials')
    const none = await fetch(`${server.origin}/api/me`)
    assert.equal(none.status, 401)
    assert.equal((await none.json()).code, 'unauthenticated')
  })

  test('E3: a wrong password reads «Correo o contraseña incorrectos», under the card, and a quick second try says its seconds without moving the card', async () => {
    const { context, page } = await entry()
    try {
      const card = page.locator('form')
      const before = await card.boundingBox()
      await page.getByLabel('Correo').fill('nadie-e3@e2e.invalid')
      await page.getByLabel('Contraseña').fill('una-clave-cualquiera-1')
      await page.getByRole('button', { name: 'Entrar' }).click()
      const alert = page.getByRole('alert').filter({ hasText: 'Correo o contraseña incorrectos' })
      await alert.waitFor()
      assert.equal(await page.getByText('La sesión terminó').count(), 0, 'E3: a wrong password says the session ended')
      const said = await alert.boundingBox()
      const after = await card.boundingBox()
      assert.ok(said.y >= after.y + after.height, 'E3: the reason is not under the card')
      assert.ok(Math.abs(after.height - before.height) < 0.5 && Math.abs(after.y - before.y) < 0.5, 'E3: the card moved with the reason')
      // Again at once: the server holds the account a second.
      await page.getByRole('button', { name: 'Entrar' }).click()
      const wait = page.getByRole('alert').filter({ hasText: /Demasiados intentos; se reintenta en \d+ s/ })
      await wait.waitFor()
      assert.equal(await page.getByText(/minutos/).count(), 0, 'E3: the wait promises minutes')
      const again = await card.boundingBox()
      assert.ok(Math.abs(again.height - before.height) < 0.5 && Math.abs(again.y - before.y) < 0.5, `E3: the card went from ${before.height} to ${again.height} px with the wait`)
    } finally { await context.close() }
  })

  test('E3: a session that ends with the page open: the entry says so with the email kept, and the text of the bar comes back after signing in', async () => {
    const { context, page } = await h.open('carla', { origin: server.origin })
    try {
      await page.goto(server.origin)
      const bar = page.getByTestId('compose-text')
      await bar.waitFor()
      const text = h.unique('E3 borrador')
      await bar.fill(text)
      server.db.prepare('UPDATE sessions SET expires_at = 1 WHERE member_id = ?').run(server.people.carla.id)
      await page.getByTestId('compose-send').click()
      await page.getByText('La sesión venció', { exact: true }).waitFor()
      assert.equal(await page.getByLabel('Correo').inputValue(), 'carla@e2e.invalid', 'E3: the entry lost the email')
      await page.getByLabel('Contraseña').fill(TEST_PASSWORD)
      await page.getByRole('button', { name: 'Entrar' }).click()
      await page.getByTestId('compose-text').waitFor()
      assert.equal(await page.getByTestId('compose-text').inputValue(), text, 'E3: the text of the bar was lost')
      assert.equal(await page.getByText('La sesión venció').count(), 0)
    } finally { await context.close() }
  })

  test('E3: with the session over, moving to a screen already loaded (Equipo) leads to the entry', async () => {
    const { context, page } = await h.open('ana', { origin: server.origin })
    try {
      await page.goto(`${server.origin}/team`)
      await page.getByRole('button', { name: 'Agregar miembro' }).waitFor()
      await page.getByRole('link', { name: 'Inicio' }).first().click()
      await page.getByTestId('compose-text').waitFor()
      server.db.prepare('UPDATE sessions SET expires_at = 1 WHERE member_id = ?').run(server.people.ana.id)
      await page.getByRole('link', { name: 'Equipo' }).first().click()
      await page.locator('main[data-screen="login"]').waitFor({ timeout: 10000 })
      assert.equal(await page.getByRole('button', { name: 'Agregar miembro' }).count(), 0, 'E3: Equipo stayed drawn without a session')
    } finally { await context.close() }
  })
})
