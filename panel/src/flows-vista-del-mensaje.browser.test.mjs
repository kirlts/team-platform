// UD-309: the sheet of a message puts the actions and the reply count on the title row, drops the «IA» mark, holds the analysis in one «Detalles» fold,
// makes the thread the narrow column and uses the width of the window. Each test runs in a real browser against dev-server.mjs:
// `PANEL_FLOWS_PORT=… node --test src/flows-vista-del-mensaje.browser.test.mjs`.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

let panel
let origin = ''
before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_PORT ?? 8843), { stepMs: 80 })
  origin = panel.origin
})
beforeEach(async () => {
  await panel.control.reset()
})
after(async () => {
  await panel?.stop()
})

const BODY = Array.from({ length: 8 }, (_, i) => `Línea ${i + 1}: una persona lo menciona como uno más de una serie de pedidos que llegan por voz y por foto.`).join('\n')

async function open(viewport, scheme, path) {
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL', colorScheme: scheme })
  const page = await context.newPage()
  await login(page, origin, 'carla')
  await page.route(/\/api\/messages\/\d+$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const res = await route.fetch()
    const json = await res.json()
    const base = json.attachments?.[0]
    if (base) json.attachments = Array.from({ length: 6 }, (_, k) => ({ ...base, id: k ? `${base.id}~${k}` : base.id }))
    json.body = BODY
    await route.fulfill({ response: res, json })
  })
  const target = path ?? `/messages/${(await (await page.request.get(`${origin}/api/messages?q=${encodeURIComponent('Corregir el contraste')}`)).json()).items[0].id}`
  await page.goto(`${origin}${target}`)
  await page.locator('main h1').waitFor()
  await settled(page)
  return { page, context }
}

const box = async (locator) => (await locator.first().boundingBox()) ?? assert.fail('the element has no box')

describe('the sheet of a message (UD-309)', () => {
  for (const [width, height] of [[1920, 1080], [1440, 900], [390, 844]]) {
    for (const scheme of ['light', 'dark']) {
      test(`${width}x${height}, ${scheme}: actions and count on the title row, no «IA», no folds apart`, async () => {
        const { page, context } = await open({ width, height }, scheme)
        try {
          const title = await box(page.locator('main h1'))
          const forward = await box(page.getByRole('button', { name: 'Reenviar', exact: true }))
          const del = await box(page.getByRole('button', { name: 'Borrar', exact: true }))
          const count = await box(page.getByTestId('reply-count'))
          const back = await box(page.locator('main a[href="/messages"]'))
          // UD-309 at every width: the way back is in the top row and the actions are under it, on the title line.
          assert.ok(forward.y > back.y + back.height - 1, 'the actions are under the top row, not in it')
          assert.ok(forward.y < title.y + title.height + 48 && del.y < title.y + title.height + 48, 'Reenviar and Borrar belong to the title row')
          assert.ok(del.x > forward.x, 'Borrar is the last, at the right')
          if (width < 768) {
            // On a phone the targets are 44 px, the count is on the line of the actions at the left of them, and the title wraps without being pushed.
            assert.ok(forward.height >= 44 && del.height >= 44, 'targets of 44 px')
            assert.ok(back.height >= 44, 'the way back is a target of 44 px')
            assert.ok(Math.abs(count.y + count.height / 2 - (forward.y + forward.height / 2)) < 12 && count.x < forward.x, 'the count shares the line of the actions, at their left')
            assert.ok(count.y >= title.y + title.height - 1, 'right under the title')
          }
          if (width >= 768) {
            assert.ok(Math.abs(forward.y + forward.height / 2 - (title.y + title.height / 2)) < 24, 'on the same line as the title')
            assert.ok(del.x > title.x + title.width, 'to the right of the title')
            assert.ok(count.x >= title.x + title.width - 1 && count.x - (title.x + title.width) < 40, 'the count is next to the title')
          }
          assert.equal(await page.getByRole('img', { name: 'Generado por IA' }).count(), 0, 'no «IA» mark')
          for (const name of ['Evaluación', 'Tiempos', 'Detalle técnico', 'Adecuación']) assert.equal(await page.getByRole('button', { name, exact: true }).count(), 0, `no fold «${name}» of its own`)
          assert.ok((await page.getByRole('button', { name: 'Detalles', exact: true }).count()) <= 1, 'at most one «Detalles»')
          assert.equal(await page.getByRole('heading', { name: 'Respuestas' }).count(), 0, 'the thread has no header of its own')
          // The recipients share a line with the badges, or sit right under it.
          const status = await box(page.getByText('Abierto', { exact: true }))
          const to = await box(page.getByRole('list', { name: 'Destinatarios' }))
          assert.ok(to.y - (status.y + status.height) < 40, 'the recipients are next to the badges')
          if (width >= 768) {
            const main = await box(page.locator('main'))
            const column = await box(page.locator('[data-lane="message-column"]'))
            const thread = await box(page.locator('section[aria-label="Respuestas"]'))
            assert.ok(thread.width < column.width, `the thread (${thread.width}) is narrower than the message (${column.width})`)
            assert.ok(thread.width <= 28 * 16 + 1, 'the thread is at most 28 rem')
            assert.ok(thread.x + thread.width >= main.x + main.width - 60, `the content reaches the right edge of the region (${thread.x + thread.width} of ${main.x + main.width})`)
            assert.ok(column.x - main.x <= 60, 'and starts at the left one')
          } else {
            const thread = await box(page.locator('section[aria-label="Respuestas"]'))
            const column = await box(page.locator('[data-lane="message-column"]'))
            assert.ok(thread.y > column.y, 'the two columns stack')
          }
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
          assert.ok(overflow <= 0, 'nothing is cut at the side')
        } finally {
          await context.close()
        }
      })
    }
  }

  test('«Detalles» is one fold that holds the times of a worked message, and a message with nothing to say has none', async () => {
    const { done_id: doneId } = await panel.control.execution()
    const { page, context } = await open({ width: 1440, height: 900 }, 'dark', `/messages/${doneId}`)
    try {
      const fold = page.getByRole('button', { name: 'Detalles', exact: true })
      await fold.waitFor()
      assert.equal(await fold.getAttribute('aria-expanded'), 'false')
      await fold.click()
      const details = page.getByTestId('details')
      await details.waitFor()
      for (const name of ['Tiempos', 'Detalle técnico', 'Adecuación']) assert.equal(await details.getByRole('button', { name }).count(), 0, `«${name}» is a name inside, not a fold`)
      assert.ok(await details.getByRole('heading', { name: 'Tiempos' }).count(), 'the times are named inside')
    } finally {
      await context.close()
    }
  })
})
