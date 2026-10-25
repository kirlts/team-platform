// M1: one send becomes one message per request, each with its own area and template (UD-294). A person writes three requests in the bar of
// Inicio, presses «Enviar», and finds three messages, not one: in the list, in the detail of each, and in the API the panel reads.
// Complement (against the development double, so not counted as coverage): panel/src/flows-ronda5-resto.browser.test.mjs.
import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import { harness, settled, until } from './harness.mjs'

let h
before(async () => { h = await harness() })

describe('M1: a send with three requests becomes three messages, each in its area and template', () => {
  test('M1: three requests typed in the bar of Inicio are three messages with three areas and their own templates', async () => {
    const tag = h.unique('M1')
    const { page, context } = await h.open('bruno')
    try {
      await page.goto(h.origin)
      const bar = page.getByTestId('compose-text')
      await bar.waitFor()
      await bar.fill(`### ${tag} primero\ncuerpo del primero\n### ${tag} segundo\ncuerpo del segundo\n### ${tag} tercero\ncuerpo del tercero`)
      await page.getByTestId('compose-send').click()

      // The send is analyzed and published by the suite's script; the API says when the three exist.
      const found = await until(async () => {
        const list = (await h.api('bruno').get(`/messages?q=${encodeURIComponent(tag)}`)).data
        return list.items.length === 3 ? list.items : null
      }, { timeoutMs: 20000, everyMs: 50 })
      assert.equal(found.length, 3, 'M1: one send with three requests must publish three messages')

      // In the list: three rows, each with an area chip, and the chips are three different areas.
      await page.goto(`${h.origin}/messages?q=${encodeURIComponent(tag)}`)
      const cards = page.getByTestId('card-number')
      await cards.first().waitFor()
      await settled(page)
      assert.equal(await cards.count(), 3, 'M1: the list shows the three messages')
      const chips = await page.getByTestId('area-chip').allInnerTexts()
      assert.equal(new Set(chips.map((c) => c.trim())).size, 3, `M1: each message sits in its own area (chips: ${chips.join(' | ')})`)

      // In the API: each message has an area and a template that belongs to that area, and the titles keep the order of the requests.
      const details = []
      for (const m of found.sort((a, b) => Number(a.id) - Number(b.id))) details.push((await h.api('bruno').get(`/messages/${m.id}`)).data)
      assert.deepEqual(details.map((d) => d.title), [`${tag} primero`, `${tag} segundo`, `${tag} tercero`])
      for (const d of details) {
        const row = h.row('SELECT t.area_id AS area_of_template FROM templates t WHERE t.id = ?', d.template_id)
        assert.ok(d.template_id && d.area_id, `M1: message ${d.id} has an area and a template`)
        assert.equal(String(row.area_of_template), String(d.area_id), `M1: the template of message ${d.id} belongs to its area`)
      }
      assert.equal(new Set(details.map((d) => d.template_id)).size, 3, 'M1: three templates, one per message')

      // In the detail of each: the person sees the area and the template of that message.
      for (const d of details) {
        await page.goto(`${h.origin}/messages/${d.id}`)
        await page.locator('main h1').waitFor()
        await settled(page)
        const head = await page.locator('main').innerText()
        const area = h.row('SELECT title FROM areas WHERE id = ?', d.area_id).title
        const template = h.row('SELECT name FROM templates WHERE id = ?', d.template_id).name
        assert.ok(head.includes(area), `M1: the detail of message ${d.id} names its area «${area}»`)
        // The template is the name of the area chip for whoever can read it (its accessible name and tooltip).
        const named = await page.getByTestId('area-picker').getAttribute('aria-label')
        assert.ok(named.includes(template), `M1: the area control of message ${d.id} names its template «${template}» (it says «${named}»)`)
      }
    } finally {
      await context.close()
    }
  })
})
