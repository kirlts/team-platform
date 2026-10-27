// UD-275 amended by UD-280: the review of a held change inside the sheet of the message: one line of state, no buttons; the review is a reply that mentions Claude. Against dev-server.mjs: `npm run test:flows`.
// With REVIEW_CAPTURES_DIR set, it also saves the screens of the review at 1440x900 and 390x844.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

process.env.PANEL_DEV_AUTO_PUBLISH = '0'

let panel
let origin = ''
const DIR = process.env.REVIEW_CAPTURES_DIR

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_REVISION_PORT ?? 8743), { stepMs: 40 })
  origin = panel.origin
})
beforeEach(async () => {
  await panel.control.reset()
})
after(async () => {
  await panel?.stop()
})

async function session(who, path, viewport = { width: 1440, height: 900 }) {
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL', colorScheme: 'light' })
  const page = await context.newPage()
  await login(page, origin, who)
  await page.goto(`${origin}${path}`)
  await settled(page)
  return { page, context }
}
const shot = async (page, name) => { if (DIR) await page.screenshot({ path: `${DIR}/${name}.png` }) }

describe('Review of a held change by reply (UD-280)', () => {
  test('the sheet shows the line of state and one control: reply to Claude', async () => {
    const { message_id: id } = await panel.control.review()
    const { page, context } = await session('ana', `/messages/${id}`)
    try {
      const block = page.getByTestId('review-pending')
      await block.waitFor()
      assert.equal(await page.getByTestId('review-reason').innerText(), 'Cambio listo para revisar')
      assert.equal(await block.getByRole('button').count(), 1)
      assert.equal(await block.getByRole('button').innerText(), 'Responder a Claude')
      // The review is written, not chosen from buttons (UD-280).
      for (const name of ['Entregar', 'Pedir cambios', 'Descartar']) assert.equal(await page.getByRole('button', { name, exact: true }).count(), 0, name)
      await shot(page, 'revision-escritorio')
    } finally {
      await context.close()
    }
  })

  test('the review is a reply that mentions Claude, written in the reply field', async () => {
    const { message_id: id } = await panel.control.review()
    const { page, context } = await session('ana', `/messages/${id}`)
    try {
      const field = page.locator('#reply-field')
      await field.click()
      await field.pressSequentially('@cla')
      await page.getByRole('listbox').waitFor()
      await page.keyboard.press('Enter')
      await page.getByRole('listbox').waitFor({ state: 'detached' })
      await field.press('End')
      await field.pressSequentially('entrégalo, se ve bien')
      await page.getByRole('button', { name: 'Responder', exact: true }).click()
      await page.locator('[data-mention]').first().waitFor()
      const detail = await (await page.request.get(`${origin}/api/messages/${id}`)).json()
      assert.deepEqual(detail.replies.at(-1).mentions, ['u-claude'])
      assert.match(detail.replies.at(-1).body, /entrégalo, se ve bien/)
      await shot(page, 'revision-respuesta-escritorio')
    } finally {
      await context.close()
    }
  })

  test('«Responder a Claude» leaves Claude mentioned and the cursor in the reply field', async () => {
    const { message_id: id } = await panel.control.review()
    const { page, context } = await session('ana', `/messages/${id}`)
    try {
      await page.getByTestId('review-reply').click()
      const field = page.locator('#reply-field')
      assert.equal(await field.evaluate((el) => el === document.activeElement), true, 'the field has the focus')
      assert.match(await field.inputValue(), /^@Claude /)
      await field.press('End')
      await field.pressSequentially('descártalo, no es lo que pedí')
      await page.getByRole('button', { name: 'Responder', exact: true }).click()
      await page.locator('[data-mention]').first().waitFor()
      const detail = await (await page.request.get(`${origin}/api/messages/${id}`)).json()
      assert.deepEqual(detail.replies.at(-1).mentions, ['u-claude'])
      assert.match(detail.replies.at(-1).body, /descártalo, no es lo que pedí/)
    } finally {
      await context.close()
    }
  })

  test('a member who is not an Editor sees the same line', async () => {
    const { message_id: id } = await panel.control.review()
    const { page, context } = await session('bruno', `/messages/${id}`)
    try {
      await page.getByTestId('review-pending').waitFor()
      assert.equal(await page.getByTestId('review-pending').getByRole('button').count(), 1)
      assert.equal(await page.getByTestId('review-reason').innerText(), 'Cambio listo para revisar')
    } finally {
      await context.close()
    }
  })

  test('on a phone the line fits', async () => {
    const { message_id: id } = await panel.control.review()
    const { page, context } = await session('ana', `/messages/${id}`, { width: 390, height: 844 })
    try {
      const block = page.getByTestId('review-pending')
      await block.waitFor()
      const box = await block.boundingBox()
      assert.ok(box && box.x >= 0 && box.x + box.width <= 390, `the block fits the width: ${JSON.stringify(box)}`)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no horizontal scroll')
      await shot(page, 'revision-telefono')
    } finally {
      await context.close()
    }
  })
})
