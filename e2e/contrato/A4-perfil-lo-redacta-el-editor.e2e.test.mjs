// A4: the Editor writes the profile of any member, person or agent, from Equipo; a member does not write the profile of another one.
// The API rule (profile is a configured text, UD-288) is also in src/api/editor-solo-textos.test.js and src/api/members-lifecycle.test.js.
import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import { harness, settled } from './harness.mjs'

let h
before(async () => { h = await harness() })

async function openProfile (page, name) {
  await page.goto(`${h.origin}/team`)
  await page.getByRole('button', { name: `Perfil de ${name}` }).waitFor()
  await settled(page)
  await page.getByRole('button', { name: `Perfil de ${name}` }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  return dialog
}

describe('A4: the Editor writes the profile of any member', () => {
  for (const [whose, key] of [['a person (Carla)', 'carla'], ['an agent (Claude)', 'claude']]) {
    test(`A4: ana writes the profile of ${whose} in its window, and it is still there after reloading`, async () => {
      const person = h.people[key]
      const text = `Perfil escrito por la Editora para ${key}. ${Math.random().toString(36).slice(2, 8)}`
      const { page, context } = await h.open('ana')
      try {
        const dialog = await openProfile(page, person.name)
        await dialog.getByRole('button', { name: new RegExp(`^Perfil de ${person.name}`) }).click()
        const field = dialog.getByRole('textbox')
        await field.fill(text)
        await field.press('Enter')
        await dialog.getByText(text).waitFor()
        await page.reload()
        await page.getByRole('button', { name: `Perfil de ${person.name}` }).waitFor()
        assert.ok((await page.locator('main').innerText()).includes(text.slice(0, 40)), 'A4: the profile written by the Editor is not in Equipo after reloading')
        const saved = (await h.api('ana').get('/members')).data
        assert.equal((saved.items ?? saved).find((m) => String(m.id) === String(person.id)).profile, text, 'A4: the server did not keep the profile')
      } finally { await context.close() }
    })
  }

  test('A4: bruno (member) opens the profile of Carla and cannot edit it, and the API answers 403', async () => {
    const { page, context } = await h.open('bruno')
    try {
      const dialog = await openProfile(page, h.people.carla.name)
      assert.equal(await dialog.getByRole('button', { name: new RegExp(`^Perfil de ${h.people.carla.name}`) }).count(), 0, 'A4: a member gets a control to edit the profile of another member')
      assert.equal(await dialog.getByRole('textbox').count(), 0, 'A4: a member gets a field for the profile of another member')
      const refused = await h.api('bruno').patch(`/members/${h.people.carla.id}`, { profile: 'No debería poder' })
      assert.equal(refused.status, 403, `A4: the API let a member write another profile (${refused.status})`)
    } finally { await context.close() }
  })

  test('A4: a member still writes his own profile', async () => {
    const own = await h.api('bruno').patch('/members/me', { profile: 'Mi propio perfil, escrito por mí.' })
    assert.equal(own.status, 200)
  })
})
