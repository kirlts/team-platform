// V1: every reply of the thread is in the view, in order, and the number on the card of the list is the number of the view.
// Martín saw 8 of 9 replies in message 117: one was hidden by a rule nobody told him about (UD-296).
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { harness, settled } from './harness.mjs'

let h
before(async () => { h = await harness() })

describe('V1: the thread shows every reply, in order, and the counts agree', () => {
  test('V1: 9 replies by two people: the card says 9, the view says 9, and nothing is hidden without a control that says how many', async () => {
    const id = await h.message(h.unique('V1 hilo'), { as: 'bruno', recipients: ['carla'] })
    for (let n = 1; n <= 9; n++) {
      const reply = await h.api(n % 2 ? 'carla' : 'ana').post(`/messages/${id}/replies`, { body: `Respuesta número ${n}`, kind: 'answer' })
      assert.equal(reply.status, 201, JSON.stringify(reply.data))
    }
    const { page, context } = await h.open('ana')
    try {
      await page.goto(`${h.origin}/messages`)
      const card = page.locator('li, article', { has: page.locator(`[data-testid=card-number]:text-is("#${id}")`) }).first()
      await card.waitFor()
      const cardCount = Number((await card.locator('[title$="respuestas"], [title$="respuesta"]').first().innerText()).trim())
      assert.equal(cardCount, 9, 'the card of the list shows the number of replies')

      await page.goto(`${h.origin}/messages/${id}`)
      const thread = page.locator('section[aria-label="Respuestas"]')
      await thread.waitFor()
      await settled(page)
      const headerCount = Number((await page.getByTestId('reply-count').innerText()).match(/(\d+)/)?.[1]) // the counter sits next to the title (V4), not inside the thread
      assert.equal(headerCount, cardCount, 'the number of the view is the number of the card')

      // What is drawn plus what the control says is folded is every reply: nothing is lost without a count.
      const items = thread.locator('ol.thread > li')
      const folded = page.getByRole('button', { name: /^\d+ respuestas más$/ })
      const hidden = (await folded.count()) ? Number((await folded.innerText()).match(/\d+/)[0]) : 0
      const drawn = (await items.count()) - (hidden ? 1 : 0)
      assert.equal(drawn + hidden, 9, `${drawn} drawn and ${hidden} behind the control must add up to the 9 replies`)
      if (hidden) await folded.click()
      const bodies = await thread.locator('ol.thread > li article').allInnerTexts()
      const numbers = bodies.map((b) => Number(b.match(/Respuesta número (\d+)/)?.[1]))
      assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6, 7, 8, 9], 'all the replies, oldest first')
    } finally {
      await context.close()
    }
  })

  test('V1: a reply added by someone else while the view is open appears in the thread and in the count without reloading', async () => {
    const id = await h.message(h.unique('V1 en vivo'), { as: 'bruno', recipients: ['carla'] })
    const { page, context } = await h.open('ana')
    try {
      await page.goto(`${h.origin}/messages/${id}`)
      const thread = page.locator('section[aria-label="Respuestas"]')
      await thread.waitFor()
      await thread.getByText('Sin respuestas').waitFor()
      await h.api('carla').post(`/messages/${id}/replies`, { body: 'Llegó mientras mirabas', kind: 'answer' })
      await thread.getByText('Llegó mientras mirabas').waitFor({ timeout: 10000 })
      assert.equal(await thread.locator('ol.thread > li').count(), 1)
    } finally {
      await context.close()
    }
  })
})
