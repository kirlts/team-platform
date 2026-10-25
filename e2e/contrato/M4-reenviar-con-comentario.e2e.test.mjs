// M4: forwarding a message to a member (Claude included) asks for a written reason (UD-272). The forward stays in the thread as a notice that is not a
// reply, and it creates no new message: the same message gains one more assignee.
// Complement (against the development double, so not counted as coverage): panel/src/flows-reenviar.browser.test.mjs.
import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import { harness, settled } from './harness.mjs'

let h
before(async () => { h = await harness() })

const countMessages = () => h.row('SELECT COUNT(*) AS n FROM messages').n

async function openForward (page, id) {
  await page.goto(`${h.origin}/messages/${id}`)
  await page.locator('main h1').waitFor()
  await settled(page)
  await page.getByTestId('forward-open').click()
  await page.getByTestId('forward-member').waitFor()
}

describe('M4: forwarding needs a written reason and leaves a notice in the thread, not a new message', () => {
  test('M4: without a reason the button stays off and says what is missing; with member and reason it goes and the thread shows a notice', async () => {
    const id = await h.message(h.unique('M4 reenvio'), { as: 'carla', recipients: ['bruno'] })
    const messagesBefore = countMessages()
    const { page, context } = await h.open('bruno')
    try {
      await openForward(page, id)
      const submit = page.getByTestId('forward-submit')
      assert.equal(await submit.isDisabled(), true, 'M4: nothing chosen, nothing written: the button is off')
      await page.getByTestId('forward-member').selectOption({ label: 'Ana Editora' })
      assert.equal(await submit.isDisabled(), true, 'M4: a member without a reason must not be forwardable')
      assert.match(await page.getByRole('dialog').innerText(), /Falta el motivo/, 'M4: the window says the reason is missing')
      await page.getByTestId('forward-comment').fill('   ')
      assert.equal(await submit.isDisabled(), true, 'M4: a blank reason is not a reason')
      await page.getByTestId('forward-comment').fill('Ana lleva este tema desde la semana pasada.')
      assert.equal(await submit.isDisabled(), false, 'M4: with member and reason the button is on')
      await submit.click()
      await page.getByRole('dialog').waitFor({ state: 'detached' })

      const notice = page.getByTestId('forward-notice')
      await notice.waitFor()
      assert.match(await notice.innerText(), /Reenviado a Ana Editora/, 'M4: the notice names who it went to')
      assert.match(await notice.innerText(), /Ana lleva este tema desde la semana pasada\./, 'M4: the notice carries the written reason')
      // A reply is another thing: the thread has no reply card for the forward.
      assert.equal(await page.locator('section[aria-label="Respuestas"] ol.thread > li article.reply-card').count(), 0, 'M4: the forward is not drawn as a reply')
      const detail = (await h.api('bruno').get(`/messages/${id}`)).data
      assert.equal(detail.replies.at(-1).kind, 'forward', 'M4: the thread entry is of kind forward, distinct from an answer')
      assert.ok(detail.assignee_ids.map(String).includes(String(h.people.ana.id)), 'M4: the same message gained the recipient')
      assert.equal(countMessages(), messagesBefore, 'M4: a forward creates no new message')
    } finally {
      await context.close()
    }
  })

  test('M4: forwarding to Claude asks for the reason too, and queues its work on the same message with no new message', async () => {
    const id = await h.message(h.unique('M4 claude'), { as: 'carla', recipients: ['bruno'] })
    const messagesBefore = countMessages()
    const { page, context } = await h.open('bruno')
    try {
      await openForward(page, id)
      const options = (await page.getByTestId('forward-member').locator('option').allInnerTexts()).map((x) => x.trim())
      assert.ok(options.includes('Claude'), `M4: Claude is one of the members a message can be forwarded to (offers: ${options.join(', ')})`)
      await page.getByTestId('forward-member').selectOption({ label: 'Claude' })
      assert.equal(await page.getByTestId('forward-submit').isDisabled(), true, 'M4: forwarding to Claude without a reason must not be possible either')
      await page.getByTestId('forward-comment').fill('Revisa esto y dime qué encuentras.')
      await page.getByTestId('forward-submit').click()
      await page.getByTestId('forward-notice').waitFor()
      const jobs = h.row("SELECT COUNT(*) AS n FROM jobs WHERE kind = 'execute' AND message_id = ? AND json_extract(payload_json, '$.member_id') = ?", id, h.people.claude.id)
      assert.equal(jobs.n, 1, 'M4: Claude received the forward as work on the same message')
      assert.equal(countMessages(), messagesBefore, 'M4: no new message was created')
    } finally {
      await context.close()
    }
  })

  test('M4: the API refuses a forward with no reason and writes nothing', async () => {
    const id = await h.message(h.unique('M4 api'), { as: 'carla', recipients: ['bruno'] })
    const repliesBefore = h.row('SELECT COUNT(*) AS n FROM replies WHERE message_id = ?', id).n
    for (const comment of [undefined, '', '  \n ']) {
      const r = await h.api('bruno').post(`/messages/${id}/forward`, { member_id: String(h.people.diego.id), ...(comment === undefined ? {} : { comment }) })
      assert.equal(r.status, 400, `M4: a forward with comment ${JSON.stringify(comment)} must be refused`)
    }
    assert.equal(h.row('SELECT COUNT(*) AS n FROM replies WHERE message_id = ?', id).n, repliesBefore, 'M4: nothing was written')
  })
})
