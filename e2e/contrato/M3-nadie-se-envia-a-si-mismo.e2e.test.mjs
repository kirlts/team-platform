// M3: nobody sends a message to themselves (UD-300), through any door: not the control «Para» of the bar, not the assignees of a published message,
// not the automatic routing, not the API, and not the forward window. Martín found the option of sending to himself inside the send.
// Complement (against the development double, so not counted as coverage): panel/src/components/RecipientsEditor.test.tsx (render only).
import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import { harness, scriptedAnalyze, settled, until } from './harness.mjs'

let h
before(async () => { h = await harness() })

/** A routing that picks the first member of the team, who is Ana: when Ana is the author the platform must not leave her assigned. */
const routingAnalyze = async (bundle, options) => {
  const result = await scriptedAnalyze(bundle, options)
  for (const m of result.proposal.messages) m.assignee_ids = bundle.members.slice(0, 2).map((x) => x.id)
  return result
}

const namesOf = async (page) => (await page.getByRole('listbox').getByRole('option').allInnerTexts()).map((x) => x.trim().split('\n').pop().trim())

describe('M3: a message is never addressed to whoever writes it', () => {
  test('M3: «Para» of the bar does not offer the person who is writing, and changing «Enviar como» takes the new author out of the chosen', async () => {
    const { page, context } = await h.open('ana')
    try {
      await page.goto(h.origin)
      const to = page.getByTestId('compose-to')
      await to.waitFor()
      await to.getByRole('button', { name: 'Para' }).click()
      const offered = await namesOf(page)
      assert.ok(!offered.includes('Ana Editora'), `M3: «Para» must not offer Ana to Ana (offers: ${offered.join(', ')})`)
      assert.ok(offered.includes('Bruno Miembro') && offered.includes('Claude'), 'M3: the others are offered')
      await page.getByRole('listbox').getByRole('option', { name: 'Bruno Miembro' }).click()
      await page.keyboard.press('Escape')
      await to.getByRole('listitem').filter({ hasText: 'Bruno' }).first().waitFor()
      // Sending in the name of Bruno makes Bruno the author: he leaves «Para», and Ana, no longer the author, can be offered.
      await page.getByTestId('compose-send-as').selectOption({ label: 'Bruno Miembro' })
      await settled(page)
      assert.equal(await to.getByRole('listitem').filter({ hasText: 'Bruno' }).count(), 0, 'M3: the new author is taken out of «Para»')
      await to.getByRole('button', { name: 'Para' }).click()
      const afterSwitch = await namesOf(page)
      assert.ok(!afterSwitch.includes('Bruno Miembro'), `M3: «Para» does not offer the new author (offers: ${afterSwitch.join(', ')})`)
      assert.ok(afterSwitch.includes('Ana Editora'), 'M3: the person who sends in his name can be a recipient')
    } finally {
      await context.close()
    }
  })

  test('M3: the assignees of a published message do not offer its author', async () => {
    const id = await h.message(h.unique('M3 asignados'), { as: 'ana', recipients: ['bruno'] })
    const { page, context } = await h.open('ana')
    try {
      await page.goto(`${h.origin}/messages/${id}`)
      await page.locator('main h1').waitFor()
      await page.getByRole('list', { name: /destinatarios/i }).first().getByRole('button', { name: /Destinatario|Agregar/ }).click()
      const offered = await namesOf(page)
      assert.ok(offered.length > 0, 'M3: the picker lists someone')
      assert.ok(!offered.includes('Ana Editora'), `M3: the author must not be offered as an assignee of her own message (offers: ${offered.join(', ')})`)
    } finally {
      await context.close()
    }
  })

  test('M3: the forward window does not offer the person who forwards', async () => {
    const id = await h.message(h.unique('M3 reenvio'), { as: 'carla', recipients: ['bruno'] })
    const { page, context } = await h.open('bruno')
    try {
      await page.goto(`${h.origin}/messages/${id}`)
      await page.getByTestId('forward-open').click()
      const options = (await page.getByTestId('forward-member').locator('option').allInnerTexts()).map((x) => x.trim())
      assert.ok(options.includes('Claude') && options.includes('Ana Editora'), 'M3: others are offered')
      assert.ok(!options.includes('Bruno Miembro'), `M3: Bruno cannot forward to Bruno (offers: ${options.join(', ')})`)
    } finally {
      await context.close()
    }
  })

  test('M3: the API refuses a send to the author, an assignee that is the author, and a forward to oneself', async () => {
    const form = new FormData()
    form.append('text', h.unique('M3 api'))
    form.append('recipient_ids', String(h.people.ana.id))
    const send = await h.api('ana').postForm('/inputs', form)
    assert.equal(send.status, 400, 'M3: POST /inputs with the author in recipient_ids must be refused')
    assert.equal(send.data.code, 'recipient_self')

    const id = await h.message(h.unique('M3 api asignado'), { as: 'ana', recipients: ['bruno'] })
    const view = (await h.api('ana').get(`/messages/${id}`)).data
    const patch = await h.api('ana').patch(`/messages/${id}`, { assignee_ids: [String(h.people.ana.id), String(h.people.bruno.id)], ...(view.version === undefined ? {} : { version: view.version }) })
    assert.equal(patch.status, 400, `M3: PATCH of assignees with the author must be refused (got ${patch.status} ${JSON.stringify(patch.data)})`)
    assert.equal(patch.data.code, 'assignee_self')

    const forward = await h.api('bruno').post(`/messages/${id}/forward`, { member_id: String(h.people.bruno.id), comment: 'a mí mismo' })
    assert.equal(forward.status, 400, 'M3: forwarding to oneself must be refused')
    assert.equal(forward.data.code, 'forward_to_self')
  })

  test('M3: the automatic routing never leaves the author assigned to their own message', async () => {
    const routed = await h.another({ modules: { analyze: routingAnalyze } })
    const tag = h.unique('M3 ruteo')
    const { page, context } = await h.open('ana', { origin: routed.origin })
    try {
      await page.goto(routed.origin)
      await page.getByTestId('compose-text').fill(tag)
      await page.getByTestId('compose-send').click()
      const assigned = await until(() => {
        const rows = routed.db.prepare('SELECT a.member_id AS id FROM message_assignees a JOIN messages m ON m.id = a.message_id WHERE m.title LIKE ?').all(`${tag}%`)
        return rows.length > 0 ? rows.map((r) => Number(r.id)) : null
      }, { timeoutMs: 20000, everyMs: 50 })
      assert.ok(!assigned.includes(routed.people.ana.id), `M3: the routing assigned the author to her own message (assignees: ${assigned.join(', ')})`)
      assert.ok(assigned.includes(routed.people.bruno.id), 'M3: the others the routing picked stay')
    } finally {
      await context.close()
    }
  })
})
