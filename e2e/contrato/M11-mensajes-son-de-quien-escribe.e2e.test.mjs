// M11: messages belong to whoever writes them: no Editor role is needed to reply, edit a reply or forward. The Editor only changes configured
// texts (areas, templates, project, profiles of others) and the models of an area.
// The table of routes by role is also covered by src/api/editor-solo-textos.test.js; here a member does it from the browser.
import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import { harness, settled } from './harness.mjs'

let h
before(async () => { h = await harness() })

describe('M11: a member replies, edits and forwards without the Editor role', () => {
  test('M11: bruno (member) replies, edits his reply in place and forwards to Diego from the interface, and no notice asks for an Editor', async () => {
    const id = await h.message(h.unique('M11 miembro'), { as: 'carla', recipients: ['bruno'] })
    const statuses = []
    const { page, context } = await h.open('bruno')
    page.on('response', (r) => { if (r.url().includes('/api/messages/') && r.request().method() !== 'GET') statuses.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`) })
    try {
      await page.goto(`${h.origin}/messages/${id}`)
      await page.locator('main h1').waitFor()
      await settled(page)

      await page.locator('#reply-field').fill('Respuesta de un miembro común')
      await page.getByRole('button', { name: 'Responder', exact: true }).click()
      const thread = page.locator('section[aria-label="Respuestas"] ol.thread')
      await thread.getByText('Respuesta de un miembro común').waitFor()

      await thread.getByRole('button', { name: /^Texto de la respuesta: / }).click()
      const edit = thread.getByRole('textbox').first()
      await edit.fill('Respuesta editada por su autor')
      await edit.press('Enter')
      await thread.getByText('Respuesta editada por su autor').waitFor()

      await page.getByTestId('forward-open').click()
      const dialog = page.getByRole('dialog')
      await dialog.waitFor()
      await page.getByTestId('forward-member').selectOption({ label: 'Diego Miembro' })
      await page.getByTestId('forward-comment').fill('Diego, esto es tuyo por la parte de datos.')
      await page.getByTestId('forward-submit').click()
      await dialog.waitFor({ state: 'detached' })
      await page.getByTestId('forward-notice').waitFor()

      assert.equal(await page.getByText(/corresponde a un editor|solo un editor|sólo un editor/i).count(), 0, 'M11: the interface told a member that an Editor is needed')
      assert.ok(statuses.length >= 3, `M11: expected reply, edit and forward calls, saw ${statuses.join(' | ')}`)
      assert.ok(statuses.every((s) => /\s(200|201)$/.test(s)), `M11: a call was refused: ${statuses.join(' | ')}`)
      const detail = (await h.api('bruno').get(`/messages/${id}`)).data
      assert.ok(detail.replies.some((r) => r.kind === 'forward'), 'M11: the forward is not in the thread')
      assert.ok(detail.assignee_ids.map(String).includes(String(h.people.diego.id)), 'M11: Diego is not a recipient after the forward')
    } finally { await context.close() }
  })

  test('M11: only the Editor changes configured texts and the models of an area: the same call is 200 for ana and 403 for bruno', async () => {
    const area = (await h.api('ana').post('/areas', { title: h.unique('M11 área'), description: 'Área de prueba de permisos' })).data
    const calls = [
      ['area title', (who) => h.api(who).patch(`/areas/${area.id}`, { description: `Descripción de ${who}` })],
      ['area models', (who) => h.api(who).patch(`/areas/${area.id}`, { execute_model_light: 'claude-haiku-5-5' })],
      ['project name', (who) => h.api(who).patch('/settings/project', { name: 'Proyecto de prueba' })],
      ['profile of another member', (who) => h.api(who).patch(`/members/${h.people.carla.id}`, { profile: `Perfil escrito por ${who}` })]
    ]
    for (const [label, call] of calls) {
      assert.equal((await call('ana')).status, 200, `M11: the Editor was refused to change ${label}`)
      const refused = await call('bruno')
      assert.equal(refused.status, 403, `M11: a member changed ${label} (answer ${refused.status})`)
    }
    // And the member's own profile stays his: no Editor needed.
    assert.equal((await h.api('bruno').patch('/members/me', { language: 'es-419' })).status, 200)
  })
})
