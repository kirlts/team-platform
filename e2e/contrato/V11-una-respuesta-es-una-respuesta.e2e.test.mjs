// V11: a reply is a reply: no «Pregunta» label on it, whoever wrote it and whatever type the API stored (Martín, 2026-10-25 01:08: «una respuesta es una respuesta y punto»).
import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import { harness, settled } from './harness.mjs'
import { openDetail } from './v-support.mjs'

let h
before(async () => { h = await harness() })

describe('V11: replies carry no type label', () => {
  test('V11: replies of every stored type, from a person and from Claude, show no «Pregunta» label and the form offers no type', async () => {
    const id = await h.message(h.unique('V11 respuestas'), { as: 'bruno', recipients: ['carla'] })
    for (const [who, kind, body] of [['carla', 'answer', 'Una respuesta común'], ['ana', 'clarification', 'Una aclaración de una persona'], ['carla', 'fix', 'Un arreglo hecho']]) {
      const r = await h.api(who).post(`/messages/${id}/replies`, { body, kind })
      assert.equal(r.status, 201, JSON.stringify(r.data))
    }
    // The final reply of Claude: written by the agent member, as the platform writes it.
    h.db.prepare("INSERT INTO replies (message_id, author_id, kind, body, created_at) VALUES (?, ?, 'answer', 'Respuesta final de Claude', ?)").run(id, h.people.claude.id, Date.now())
    const { page, context } = await openDetail(h, 'bruno', id, { width: 1440, height: 900 }, { gallery: false })
    try {
      const thread = page.locator('section[aria-label="Respuestas"]')
      await thread.waitFor()
      await settled(page)
      const cards = await thread.locator('ol.thread > li article').evaluateAll((els) => els.map((el) => {
        const body = el.querySelector('[data-user-text]')
        const chrome = [...el.querySelectorAll('*')].filter((n) => !body?.contains(n) && n.children.length === 0).map((n) => n.textContent.trim()).filter(Boolean)
        return { body: body?.innerText.trim() ?? '', chrome }
      }))
      assert.ok(cards.length >= 4, `V11: expected 4 replies, found ${cards.length}`)
      for (const c of cards) assert.ok(!c.chrome.some((t) => /^Pregunta$/i.test(t)), `V11: the reply «${c.body}» carries the label «Pregunta»: ${JSON.stringify(c.chrome)}`)
      assert.equal(await page.getByRole('radiogroup').count(), 0, 'V11: the reply form offers a type of reply')
      assert.equal(await thread.getByText(/^(Pregunta|Aclaración|Arreglo)$/).count(), 0, 'V11: a reply is labeled with its type')
    } finally { await context.close() }
  })

  test('V11: the list of latest replies in Inicio shows replies with no type label either', async () => {
    const id = await h.message(h.unique('V11 inicio'), { as: 'bruno', recipients: ['carla'] })
    await h.api('carla').post(`/messages/${id}/replies`, { body: 'Una respuesta para Inicio', kind: 'clarification' })
    const { page, context } = await h.open('ana')
    try {
      await page.goto(h.origin)
      await page.getByText('Una respuesta para Inicio').first().waitFor()
      const row = page.locator('li, article').filter({ hasText: 'Una respuesta para Inicio' }).last()
      const parts = await row.locator('*').evaluateAll((els) => els.filter((n) => n.children.length === 0).map((n) => n.textContent.trim()))
      assert.ok(!parts.some((t) => /^(Pregunta|Aclaración)$/i.test(t)), `V11: the reply row in Inicio carries a type label: ${JSON.stringify(parts)}`)
    } finally { await context.close() }
  })
})
