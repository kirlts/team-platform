// E5: what the entry keeps across an ended session belongs to the person it was of, the panel says the action did not complete, and a wait counts down
// without marking the fields (judge of the entry, 2026-10-28, findings 1, 2, 4 and 5). Against a real server.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { harness, TEST_PASSWORD } from './harness.mjs'

let h
let server

before(async () => {
  h = await harness()
  server = await h.another({ config: { identity: { login: { ipMax: 100000, ipWindowMs: 1000 } } } })
})
after(async () => {})

const expire = (who) => server.db.prepare('UPDATE sessions SET expires_at = 1 WHERE member_id = ?').run(server.people[who].id)

describe('E5: the entry across an ended session', () => {
  test('E5: the draft of the bar comes back only to its author: another person who signs in finds the bar empty, and the author finds the text again', async () => {
    const { context, page } = await h.open('bruno', { origin: server.origin })
    try {
      await page.goto(server.origin)
      const text = h.unique('E5 texto privado de Bruno')
      await page.getByTestId('compose-text').fill(text)
      expire('bruno')
      await page.getByTestId('compose-send').click()
      await page.getByText('La sesión venció', { exact: true }).waitFor()
      // Another person signs in on the same tab.
      await page.getByLabel('Correo').fill('carla@e2e.invalid')
      await page.getByLabel('Contraseña').fill(TEST_PASSWORD)
      await page.getByRole('button', { name: 'Entrar' }).click()
      await page.getByTestId('compose-text').waitFor()
      assert.equal(await page.getByTestId('compose-text').inputValue(), '', 'E5: the text of another person is in the bar')
      assert.equal(await page.locator('[data-notice]').getByText(/no se completó/).count(), 0, 'E5: the notice of another person was shown')
      // And back to the first one.
      await page.getByTestId('sign-out').click()
      await page.getByLabel('Correo').fill('bruno@e2e.invalid')
      await page.getByLabel('Contraseña').fill(TEST_PASSWORD)
      await page.getByRole('button', { name: 'Entrar' }).click()
      await page.getByTestId('compose-text').waitFor()
      assert.equal(await page.getByTestId('compose-text').inputValue(), text, 'E5: the author did not find the text again')
    } finally { await context.close() }
  })

  test('E5: the author who signs in again finds the text and is told that the send did not complete, with the files that were lost', async () => {
    const { context, page } = await h.open('diego', { origin: server.origin })
    try {
      await page.goto(server.origin)
      const text = h.unique('E5 texto de Diego')
      await page.getByTestId('compose-text').fill(text)
      await page.setInputFiles('input[type="file"]', [{ name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64') }]).catch(() => {})
      expire('diego')
      await page.getByTestId('compose-send').click()
      await page.getByText('La sesión venció', { exact: true }).waitFor()
      await page.getByLabel('Contraseña').fill(TEST_PASSWORD)
      await page.getByRole('button', { name: 'Entrar' }).click()
      await page.getByTestId('compose-text').waitFor()
      assert.equal(await page.getByTestId('compose-text').inputValue(), text, 'E5: the author lost the text')
      await page.locator('[data-notice]').getByText(/no se completó: la sesión venció|Envío no completado/).waitFor({ timeout: 5000 })
      const said = await page.locator('[data-notice]').innerText()
      console.log('E5 notice:', said)
      assert.match(said, /^(La última acción no se completó: la sesión venció|Envío no completado: sesión vencida, 1 adjunto perdido)$/m, said)
    } finally { await context.close() }
  })
})

describe('E5: the wait of the entry', () => {
  test('E5: the seconds go down and the line leaves at 0, and the fields are not marked as wrong for a wait', async () => {
    const context = await h.browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-CL' })
    const page = await context.newPage()
    try {
      await page.goto(server.origin)
      await page.locator('form').waitFor()
      await page.getByLabel('Correo').fill('nadie-e5@e2e.invalid')
      await page.getByLabel('Contraseña').fill('una-clave-cualquiera-1')
      const enter = page.getByRole('button', { name: 'Entrar' })
      const wait = page.getByTestId('login-wait')
      for (const pause of [1100, 2100]) { // 1 s, then 2 s, then 4 s of wait: each try after the last wait
        await enter.click()
        await page.getByRole('alert').first().waitFor()
        await page.waitForTimeout(pause)
      }
      await enter.click()
      await page.getByRole('alert').first().waitFor()
      await enter.click() // at once: the wait answers
      await wait.waitFor()
      const first = Number((await wait.innerText()).match(/(\d+) s/)[1])
      assert.ok(first >= 2, `the wait is ${first} s`)
      assert.equal(await page.getByLabel('Correo').getAttribute('aria-invalid'), null, 'E5: a wait marks the email')
      assert.equal(await page.getByLabel('Contraseña').getAttribute('aria-invalid'), null, 'E5: a wait marks the password')
      await page.waitForTimeout(1300)
      const later = (await wait.count()) ? Number((await wait.innerText()).match(/(\d+) s/)[1]) : 0
      assert.ok(later < first, `the wait went from ${first} s to ${later} s after a second`)
      await wait.waitFor({ state: 'detached', timeout: (first + 1) * 1000 })
    } finally { await context.close() }
  })
})
