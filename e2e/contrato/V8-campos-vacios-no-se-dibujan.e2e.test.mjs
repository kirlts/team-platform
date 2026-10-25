// V8: a template field with no data is not drawn: no label over nothing, no «Completar», no «No indicado» (UD-306, message 123).
// The author may add an absent field from a row of names under the fields; nobody else sees any of that.
import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import { harness } from './harness.mjs'
import { openDetail } from './v-support.mjs'

let h
before(async () => { h = await harness() })

const EMPTY_LABELS = ['Quién lo necesita', 'Cómo se sabrá que está listo']

describe('V8: empty fields are not drawn', () => {
  test('V8: seen by someone who did not write it, the message shows no empty field, no «Completar» and no «No indicado»', async () => {
    const id = await h.message(`${h.unique('V8 vacíos')}\nUn pedido con su contexto.`, { as: 'ana', recipients: ['bruno'] })
    const { page, context } = await openDetail(h, 'bruno', id, { width: 1440, height: 900 }, { gallery: false })
    try {
      const text = await page.locator('[data-lane="message-column"]').innerText()
      for (const label of EMPTY_LABELS) assert.ok(!text.includes(label), `V8: the empty field «${label}» is drawn for a reader`)
      assert.doesNotMatch(text, /Completar|No indicado/i, 'V8: a placeholder is drawn instead of omitting the empty field')
    } finally { await context.close() }
  })

  test('V8: seen by its author, an empty field appears only as a control to add it, never as a field with a label over nothing', async () => {
    const id = await h.message(`${h.unique('V8 autor')}\nUn pedido con su contexto.`, { as: 'ana' })
    const { page, context } = await openDetail(h, 'ana', id, { width: 1440, height: 900 }, { gallery: false })
    try {
      const lane = page.locator('[data-lane="message-column"]')
      for (const label of EMPTY_LABELS) {
        const everywhere = await lane.getByText(label, { exact: false }).count()
        const inControls = await lane.getByRole('button', { name: new RegExp(label) }).count()
        assert.equal(everywhere, inControls, `V8: «${label}» is drawn outside a control to add it (${everywhere} times, ${inControls} of them in a control)`)
      }
      assert.doesNotMatch(await lane.innerText(), /Completar|No indicado/i, 'V8: a placeholder is drawn instead of omitting the empty field')
    } finally { await context.close() }
  })

  test('V8: a field the analysis filled with «No indicado» is not drawn either', async () => {
    const id = await h.message(`${h.unique('V8 marca')}\ncampo need=No indicado\ncampo request=Lo que sea`, { as: 'ana', recipients: ['bruno'] })
    const { page, context } = await openDetail(h, 'bruno', id, { width: 1440, height: 900 }, { gallery: false })
    try {
      const text = await page.locator('[data-lane="message-column"]').innerText()
      assert.doesNotMatch(text, /No indicado/i, `V8: the mark «No indicado» is drawn: «${text.replace(/\s+/g, ' ').slice(0, 200)}»`)
    } finally { await context.close() }
  })

  test('V8: a field that has data is drawn with its label and its data', async () => {
    const id = await h.message(`${h.unique('V8 con dato')}\ncampo users=Recepción de la clínica`, { as: 'ana', recipients: ['bruno'] })
    const { page, context } = await openDetail(h, 'bruno', id, { width: 1440, height: 900 }, { gallery: false })
    try {
      const text = await page.locator('[data-lane="message-column"]').innerText()
      assert.match(text, /Quién lo necesita/i, 'V8: the field with data lost its label')
      assert.match(text, /Recepción de la clínica/, 'V8: the field with data lost its value')
    } finally { await context.close() }
  })
})
