// V6: one single fold «Detalles» holds what used to be Evaluación, Tiempos, Detalle técnico and Adecuación, and shows only what has data.
import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import { harness } from './harness.mjs'
import { openDetail, richMessage, VIEWPORTS } from './v-support.mjs'

let h
before(async () => { h = await harness() })

describe('V6: one fold «Detalles»', () => {
  for (const viewport of VIEWPORTS) {
    test(`V6: the view has a single fold «Detalles» and none of the four old ones, at ${viewport.width} px`, async () => {
      const id = await richMessage(h, h.unique('V6 detalles'))
      const { page, context } = await openDetail(h, 'ana', id, viewport)
      try {
        const lane = page.locator('[data-lane="message-column"]')
        const folds = await lane.getByRole('button', { expanded: false }).evaluateAll((els) => els.map((e) => e.innerText.trim()))
        const detalles = folds.filter((t) => /^Detalles/.test(t))
        assert.equal(detalles.length, 1, `V6: expected one fold «Detalles»; the folds of the view are ${JSON.stringify(folds)}`)
        for (const old of ['Evaluación', 'Tiempos', 'Detalle técnico', 'Adecuación']) {
          assert.equal(folds.filter((t) => t.startsWith(old)).length, 0, `V6: «${old}» is still a fold of its own outside «Detalles»`)
        }
      } finally { await context.close() }
    })
  }

  test('V6: opened, «Detalles» shows only sections that have data: none is empty', async () => {
    const id = await richMessage(h, h.unique('V6 con datos'))
    const { page, context } = await openDetail(h, 'ana', id, { width: 1440, height: 900 })
    try {
      const fold = page.locator('[data-lane="message-column"]').getByRole('button', { name: /^Detalles/ })
      assert.equal(await fold.count(), 1, 'V6: there is no fold «Detalles» to open')
      await fold.click()
      const region = page.locator(`#${await fold.getAttribute('aria-controls')}`)
      await region.waitFor()
      const sections = await region.evaluate((el) => [...el.querySelectorAll('section, [role=group], dl > div, details')].map((s) => ({ title: (s.querySelector('h3, h4, summary, dt') ?? s).innerText.split('\n')[0].trim(), text: s.innerText.trim() })))
      const text = (await region.innerText()).trim()
      assert.ok(text.length > 0, 'V6: «Detalles» opens to nothing')
      for (const s of sections) {
        assert.ok(s.text.replace(s.title, '').trim().length > 0, `V6: the section «${s.title}» of «Detalles» has no data and is drawn anyway`)
      }
      assert.doesNotMatch(text, /No indicado|Sin datos|Completar|—\s*$/m, `V6: «Detalles» shows placeholders instead of omitting what has no data: «${text.slice(0, 160)}»`)
    } finally { await context.close() }
  })

  test('V6: a message with no timing, no assessment and no technical data has no empty «Detalles»', async () => {
    const id = await h.message(h.unique('V6 sin nada'), { as: 'bruno' })
    const { page, context } = await openDetail(h, 'bruno', id, { width: 1440, height: 900 }, { gallery: false })
    try {
      const fold = page.locator('[data-lane="message-column"]').getByRole('button', { name: /^Detalles/ })
      if (await fold.count()) {
        await fold.click()
        const text = (await page.locator(`#${await fold.getAttribute('aria-controls')}`).innerText()).trim()
        assert.ok(text.length > 0, 'V6: «Detalles» is drawn and opens to nothing')
      }
    } finally { await context.close() }
  })
})
