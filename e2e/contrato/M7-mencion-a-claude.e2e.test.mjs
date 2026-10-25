// M7: mentioning @Claude in a reply reaches Claude, also while it is working the message.
// Mention pickers and payloads are also covered against the double server by panel/src/flows-menciones.browser.test.mjs;
// the live-session path by src/execute/live-mention.test.js (fake `claude`). This file drives the real server from the browser.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { harness, settled } from './harness.mjs'

let h
before(async () => { h = await harness() })

/** Writes a reply that mentions Claude through the picker, as a person would, and sends it. */
async function mentionClaude (page, id, text) {
  await page.goto(`${h.origin}/messages/${id}`)
  await page.locator('main h1').waitFor()
  await settled(page)
  const field = page.locator('#reply-field')
  await field.click()
  await field.pressSequentially('@cla')
  await page.getByRole('listbox').waitFor()
  await page.keyboard.press('Enter')
  await page.getByRole('listbox').waitFor({ state: 'detached' })
  await field.pressSequentially(text)
  await page.getByRole('button', { name: 'Responder', exact: true }).click()
  await page.locator('[data-mention]').last().waitFor()
}

const claudeJobs = (id) => h.rows("SELECT id, status FROM jobs WHERE kind = 'execute' AND message_id = ? AND json_extract(payload_json, '$.member_id') = ? ORDER BY id", id, h.people.claude.id)

describe('M7: a mention of @Claude reaches Claude', () => {
  test('M7: a reply that mentions @Claude stores the mention and queues a job for Claude', async () => {
    const id = await h.message(h.unique('M7 mención'), { as: 'bruno', recipients: ['carla'] })
    assert.equal(claudeJobs(id).length, 0, 'Claude has nothing queued before the mention')
    const { page, context } = await h.open('ana')
    try {
      await mentionClaude(page, id, 'revisa esto por favor')
      const reply = (await h.api('ana').get(`/messages/${id}`)).data.replies.at(-1)
      assert.deepEqual(reply.mentions.map(String), [String(h.people.claude.id)], 'M7: the reply keeps the mention of Claude')
      const jobs = claudeJobs(id)
      assert.ok(jobs.length >= 1, 'M7: the mention queued no job for Claude')
      // The harness worker runs the analysis only: an `execute` job it cannot run ends `failed` at once, so the job's existence is what proves the mention arrived.
    } finally { await context.close() }
  })

  test('M7: a mention while Claude is working the message is kept for its running session, not lost and not a second job', async () => {
    const id = await h.message(h.unique('M7 en vivo'), { as: 'bruno', recipients: ['claude'] })
    const [job] = claudeJobs(id)
    assert.ok(job, 'M7: assigning Claude queued no job')
    h.db.prepare("UPDATE jobs SET status = 'running' WHERE id = ?").run(job.id)
    const { page, context } = await h.open('ana')
    try {
      await mentionClaude(page, id, 'ahora cambia de idea')
      const replyId = (await h.api('ana').get(`/messages/${id}`)).data.replies.at(-1).id
      const mention = h.row('SELECT pending FROM reply_mentions WHERE reply_id = ? AND member_id = ?', replyId, h.people.claude.id)
      assert.ok(mention, 'M7: no mention row for Claude')
      assert.equal(mention.pending, 1, 'M7: the mention is not pending for the running session of Claude')
      assert.equal(claudeJobs(id).filter((j) => ['queued', 'running'].includes(j.status)).length, 1, 'M7: the mention opened a second job while the first one runs')
    } finally { await context.close() }
  })
})
