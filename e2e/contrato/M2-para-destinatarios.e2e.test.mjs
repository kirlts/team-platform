// M2: the control «Para» of the bar of Inicio chooses who a send goes to (UD-291). Claude is one more name in the list; with Claude and someone
// else chosen both are the recipients of every message; with nobody chosen the automatic routing assigns, as it always did.
// Complement (against the development double, so not counted as coverage): panel/src/flows-destinatarios.browser.test.mjs.
import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import { harness, scriptedAnalyze, until } from './harness.mjs'

let h
before(async () => { h = await harness() })

/** The routing of the suite's script: the first member of the team, as the analyzer of the repository's own tests does. The platform removes the author (UD-300). */
const routingAnalyze = async (bundle, options) => {
  const result = await scriptedAnalyze(bundle, options)
  for (const m of result.proposal.messages) m.assignee_ids = bundle.members.slice(0, 1).map((x) => x.id)
  return result
}

const assignees = (db, tag) => db.prepare('SELECT DISTINCT a.member_id AS id FROM message_assignees a JOIN messages m ON m.id = a.message_id WHERE m.title LIKE ? ORDER BY a.member_id').all(`${tag}%`).map((r) => Number(r.id))

describe('M2: «Para» chooses the recipients; Claude is one of them; with nobody chosen the routing runs', () => {
  test('M2: the list of «Para» offers every other member with Claude among them, and Claude plus Bruno chosen are both recipients', async () => {
    const tag = h.unique('M2 para')
    const { page, context } = await h.open('carla')
    try {
      await page.goto(h.origin)
      const to = page.getByTestId('compose-to')
      await to.waitFor()
      await to.getByRole('button', { name: 'Para' }).click()
      const offered = (await page.getByRole('menuitemcheckbox').allInnerTexts()).map((x) => x.trim().split('\n').pop().trim())
      for (const name of ['Claude', 'Bruno Miembro', 'Ana Editora', 'Diego Miembro']) assert.ok(offered.includes(name), `M2: «Para» offers ${name} (offers: ${offered.join(', ')})`)
      await page.getByRole('menuitemcheckbox', { name: 'Claude' }).click()
      await page.getByRole('menuitemcheckbox', { name: 'Bruno Miembro' }).click()
      await page.keyboard.press('Escape')
      // The chosen recipients show as chips in the control.
      await to.getByText('Claude').first().waitFor()
      await to.getByText('Bruno Miembro').first().waitFor()
      await page.getByTestId('compose-text').fill(tag)
      await page.getByTestId('compose-send').click()
      await until(() => assignees(h.db, tag).length > 0, { timeoutMs: 20000, everyMs: 50 })
      assert.deepEqual(assignees(h.db, tag), [h.people.bruno.id, h.people.claude.id].sort((a, b) => a - b), 'M2: Claude and Bruno are the recipients of the message')
      // Claude receives its work: a send addressed to an agent opens its job.
      const message = h.row('SELECT id FROM messages WHERE title LIKE ?', `${tag}%`)
      const job = h.row("SELECT COUNT(*) AS n FROM jobs WHERE kind = 'execute' AND message_id = ? AND json_extract(payload_json, '$.member_id') = ?", message.id, h.people.claude.id)
      assert.equal(job.n, 1, 'M2: Claude, chosen in «Para», gets its job for the message')
      // The bar is ready for the next send with no recipients kept from the last one.
      assert.equal(await to.getByRole('listitem').filter({ hasText: 'Claude' }).count(), 0, 'M2: the bar forgets the recipients after sending')
    } finally {
      await context.close()
    }
  })

  test('M2: with nobody chosen in «Para» the automatic routing assigns the message', async () => {
    const routed = await h.another({ modules: { analyze: routingAnalyze } })
    const tag = h.unique('M2 ruteo')
    const { page, context } = await h.open('bruno', { origin: routed.origin })
    try {
      await page.goto(routed.origin)
      await page.getByTestId('compose-text').fill(tag)
      assert.equal(await page.getByTestId('compose-to').getByRole('listitem').filter({ hasText: /Claude|Ana|Carla|Diego/ }).count(), 0, 'M2: nobody is chosen')
      await page.getByTestId('compose-send').click()
      await until(() => assignees(routed.db, tag).length > 0, { timeoutMs: 20000, everyMs: 50 })
      assert.deepEqual(assignees(routed.db, tag), [routed.people.ana.id], 'M2: the routing assigned the message (the script routes to the first member)')
      const recipients = routed.db.prepare('SELECT recipient_ids_json AS r FROM inputs WHERE text LIKE ?').get(`${tag}%`).r
      assert.equal(recipients, '[]', 'M2: the send kept no recipients, so the routing decided')
    } finally {
      await context.close()
    }
  })
})
