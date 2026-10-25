// V7: the thread column is narrow, the message is the protagonist, and the view uses the width of the browser at 1440 and 1920 px.
// Martín, 2026-10-25 17:31: «es la columna derecha. Esto le dará más protagonismo al mensaje que al hilo. Además, hay que ocupar bien el ancho del navegador,
// hoy el espacio lateral sin utilizar es excesivo». The side margin allowed is the margin of the page of the kit: 40 px, so 48 px with the rounding of the scrollbar.
import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import { harness } from './harness.mjs'
import { box, openDetail, richMessage, VIEWPORTS } from './v-support.mjs'

let h
before(async () => { h = await harness() })

describe('V7: the message leads and the view uses the width', () => {
  for (const viewport of VIEWPORTS) {
    describe(`at ${viewport.width} px`, () => {
      let id
      before(async () => { id = await richMessage(h, h.unique('V7 columnas')) })

      test('V7: the thread column is narrower than the message column', async () => {
        const { page, context } = await openDetail(h, 'ana', id, viewport)
        try {
          const message = await box(page.locator('[data-lane="message-column"]'))
          const thread = await box(page.locator('section[aria-label="Respuestas"]'))
          assert.ok(thread.x > message.x, 'V7: the thread must be the right column')
          assert.ok(thread.width < message.width, `V7: the thread (${Math.round(thread.width)} px) is not narrower than the message (${Math.round(message.width)} px)`)
          assert.ok(message.width >= (message.width + thread.width) * 0.55, `V7: the message takes ${Math.round((100 * message.width) / (message.width + thread.width))} % of the two columns, under 55 %`)
        } finally { await context.close() }
      })

      test('V7: the two columns use the width of the content area, with no wide empty side margins', async () => {
        const { page, context } = await openDetail(h, 'ana', id, viewport)
        try {
          const main = await box(page.locator('main#main'))
          const message = await box(page.locator('[data-lane="message-column"]'))
          const thread = await box(page.locator('section[aria-label="Respuestas"]'))
          const left = message.x - main.x
          const right = main.x + main.width - (thread.x + thread.width)
          assert.ok(left <= 48, `V7: ${Math.round(left)} px of empty space on the left of the content`)
          assert.ok(right <= 48, `V7: ${Math.round(right)} px of empty space on the right of the content (the content ends at ${Math.round(thread.x + thread.width)} of ${Math.round(main.x + main.width)})`)
        } finally { await context.close() }
      })
    })
  }
})
