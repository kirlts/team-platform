// A3: removing a member keeps what they published, and «Super Admin» is not a member of Team Platform.
// The API rules (what stays, the retired e-mail) are covered by src/api/member-deletion.test.js and src/api/member-retirement.test.js;
// the host never creates a member for a console account that is not one: src/api/host-notices.test.js. This file does it from the interface.
import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import { signHeader } from '../../src/identity/delegated.js'
import { TEST_PASSWORD, harness, settled } from './harness.mjs'

let h
before(async () => { h = await harness() })

let counter = 0
/** A new member with a password, by the API as Ana does it from «Agregar miembro». */
async function newMember (name) {
  const key = `elena${++counter}${Math.random().toString(36).slice(2, 6)}`
  const res = await h.api('ana').post('/members', { email: `${key}@e2e.invalid`, name, password: TEST_PASSWORD })
  assert.equal(res.status, 201, JSON.stringify(res.data))
  return { key, id: res.data.id, name }
}

/** The row of a member in Equipo, paging when the list is long. */
async function rowOf (page, email) {
  for (let guard = 0; guard < 10; guard++) {
    const row = page.locator('main div.border-b').filter({ hasText: email }).first()
    if ((await row.count()) > 0) return row
    const next = page.getByRole('button', { name: 'Página siguiente' })
    assert.ok((await next.count()) > 0 && (await next.isEnabled()), `A3: ${email} is on no page of Equipo`)
    await next.click()
    await settled(page)
  }
  throw new Error(`A3: ${email} not found`)
}

describe('A3: removing members keeps what they published; Super Admin is not a member', () => {
  test('A3: ana removes a member who published a message and a reply from Equipo: both stay, readable, under «Miembro eliminado»', async () => {
    const who = await newMember('Elena Eliminable')
    const title = h.unique('A3 publicado')
    const messageId = await h.message(title, { as: who.key })
    const ours = await h.message(h.unique('A3 de Ana'), { as: 'ana', recipients: ['bruno'] })
    const reply = await h.api(who.key).post(`/messages/${ours}/replies`, { body: 'Respuesta de quien se va', kind: 'answer' })
    assert.equal(reply.status, 201, JSON.stringify(reply.data))

    const { page, context } = await h.open('ana')
    try {
      await page.goto(`${h.origin}/team`)
      await page.getByRole('button', { name: 'Agregar miembro' }).waitFor()
      await settled(page)
      const row = await rowOf(page, `${who.key}@e2e.invalid`)
      await row.getByRole('button', { name: `Acciones de ${who.name}` }).click()
      await page.getByRole('menuitem', { name: `Eliminar a ${who.name}` }).click()
      await page.getByText(/eliminado · Conserva 1 mensajes? y 1 respuestas?/).first().waitFor({ timeout: 10000 })
      assert.equal(await page.locator('main div.border-b').filter({ hasText: `${who.key}@e2e.invalid` }).count(), 0, 'A3: the removed member is still in Equipo')

      // The message stays, in the list and in its own view, with an author that says what happened.
      await page.goto(`${h.origin}/messages/${messageId}`)
      await page.locator('main h1').waitFor()
      assert.equal(await page.locator('main h1').innerText(), title.split('\n')[0], 'A3: the published message is gone or changed')
      assert.ok((await page.locator('main').innerText()).includes('Miembro eliminado'), 'A3: the message does not say its author was removed')
      // The reply stays in the thread of someone else's message.
      await page.goto(`${h.origin}/messages/${ours}`)
      await page.locator('section[aria-label="Respuestas"]').getByText('Respuesta de quien se va').waitFor()
      const detail = (await h.api('ana').get(`/messages/${ours}`)).data
      assert.equal(detail.replies.length, 1, 'A3: the reply of the removed member was lost')
    } finally { await context.close() }
  })

  test('A3: «Super Admin» is not a member: it is not in Equipo, not in «Para», and the API does not list it', async () => {
    const members = (await h.api('ana').get('/members')).data
    const names = (members.items ?? members).map((m) => m.name)
    assert.ok(!names.some((n) => /super\s*admin/i.test(n)), `A3: Super Admin is a member: ${names.join(', ')}`)
    const { page, context } = await h.open('ana')
    try {
      await page.goto(`${h.origin}/team`)
      await page.getByRole('button', { name: 'Agregar miembro' }).waitFor()
      assert.equal(await page.getByText(/super\s*admin/i).count(), 0, 'A3: Equipo shows Super Admin')
      await page.goto(h.origin)
      await page.getByRole('button', { name: 'Para' }).click()
      await page.getByRole('listbox, menu, dialog').first().waitFor().catch(() => {})
      assert.equal(await page.getByText(/super\s*admin/i).count(), 0, 'A3: the «Para» control offers Super Admin')
    } finally { await context.close() }
  })

  test('A3: the console\'s «Super Admin» account, signed by the host, does not become a member by asking: 404 and no member created', async () => {
    const secret = 'secreto-del-anfitrion-de-prueba'
    const host = await h.another({ config: { identity: { provider: 'local,signed-header', provision: 'closed', delegated: { mode: 'signed-header', secrets: [secret] } } } })
    const email = 'superadmin@consola.invalid'
    const signed = (method, url) => {
      const ts = Math.floor(Date.now() / 1000)
      return { 'x-team-user': email, 'x-team-ts': String(ts), 'x-team-sig': signHeader(secret, { ts, method, pathname: url, email, bind: true }) }
    }
    for (const url of ['/api/host/notices', '/api/me']) {
      const res = await fetch(`${host.origin}${url}`, { headers: signed('GET', url) })
      assert.ok([403, 404].includes(res.status), `A3: ${url} answered ${res.status} to a console account that is not a member`)
    }
    const names = host.db.prepare('SELECT name, email FROM members').all()
    assert.ok(!names.some((m) => m.email === email || /super\s*admin/i.test(m.name)), `A3: a member was created for the console account: ${JSON.stringify(names)}`)
  })
})
