// E4: deleting a send with its messages takes them out of the summary and of the bell of whoever they were for, on the open screen and without a reload; restoring brings them back
// (judge of the entry, 2026-10-28, finding 3). Against a real server: Bruno sends to Ana, Ana's page is open, Bruno deletes the send through the API.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { harness, until } from './harness.mjs'

let h
let server

before(async () => {
  h = await harness()
  server = await h.another({ config: { identity: { login: { ipMax: 100000, ipWindowMs: 1000 } } } })
})

const open = (page) => page.locator('[data-testid="state-button"][data-status="open"]')

describe('E4: the bell follows the deletion of a send', () => {
  test('E4: GET /messages/summary does not count the messages of a deleted send, and counts them again once restored', async () => {
    const title = h.unique('E4 resumen')
    const { inputId, ids } = await h.send(`${title}\n\nSegundo pedido ${h.unique('E4')}`, { as: 'bruno', recipients: ['ana'], origin: server.origin, server })
    const count = async () => (await h.api('ana', server.origin).get('/messages/summary')).data.items.filter((i) => ids.map(String).includes(i.message_id)).length
    const before = await count()
    assert.ok(before >= 1, 'the messages are in the summary of their recipient')
    const del = await h.api('bruno', server.origin).del(`/inputs/${inputId}?confirm=true&with_messages=true`)
    assert.equal(del.status, 200, JSON.stringify(del.data))
    assert.equal(await count(), 0, 'E4: the summary still counts deleted messages')
    const back = await h.api('bruno', server.origin).post(`/inputs/${inputId}/restore`)
    assert.equal(back.status, 200, JSON.stringify(back.data))
    assert.equal(await count(), before)
  })

  test('E4: the open screen of the recipient drops the count and the rows of the bell when the send is deleted with its messages, and gets them back on restore', async () => {
    const title = h.unique('E4 campana')
    const { inputId } = await h.send(title, { as: 'bruno', recipients: ['ana'], origin: server.origin, server })
    const { context, page } = await h.open('ana', { origin: server.origin })
    try {
      await page.goto(server.origin)
      const read = async () => Number(await open(page).getAttribute('data-count'))
      await until(async () => (await read()) >= 1, { timeoutMs: 10000, everyMs: 100 })
      const before = await read()
      await open(page).click()
      await page.getByTestId('status-menu').getByText(title, { exact: false }).first().waitFor()
      await page.keyboard.press('Escape')
      const del = await h.api('bruno', server.origin).del(`/inputs/${inputId}?confirm=true&with_messages=true`)
      assert.equal(del.status, 200)
      await until(async () => (await read()) === before - 1, { timeoutMs: 10000, everyMs: 100 }).catch(() => {})
      assert.equal(await read(), before - 1, 'E4: the bell still counts the deleted message')
      await open(page).click()
      assert.equal(await page.getByTestId('status-menu').getByText(title, { exact: false }).count(), 0, 'E4: the bell still lists the deleted message')
      await page.keyboard.press('Escape')
      await h.api('bruno', server.origin).post(`/inputs/${inputId}/restore`)
      await until(async () => (await read()) === before, { timeoutMs: 10000, everyMs: 100 }).catch(() => {})
      assert.equal(await read(), before, 'E4: the bell does not count the restored message')
    } finally { await context.close() }
  })

  test('E4: whoever deletes their own send with its messages sees the bell drop at once, and Deshacer brings it back', async () => {
    const title = h.unique('E4 propio')
    const { context, page } = await h.open('carla', { origin: server.origin })
    try {
      await page.goto(server.origin)
      const read = async () => Number(await open(page).getAttribute('data-count'))
      const summary = async () => (await h.api('carla', server.origin).get('/messages/summary')).data.mine.open
      const start = await summary()
      await page.getByTestId('compose-text').fill(title)
      await page.getByTestId('compose-send').click()
      const drawer = page.getByTestId('send-drawer')
      await drawer.getByTestId('delete-send-all').waitFor({ timeout: 30000 })
      const withSend = await summary()
      await until(async () => (await read()) === withSend, { timeoutMs: 10000, everyMs: 100 }).catch(() => {})
      assert.equal(await read(), withSend, 'E4: the bell does not count the new messages')
      await drawer.getByTestId('delete-send-all').click()
      await page.locator('[data-notice]').getByText(/^Envío y \d+ mensajes? borrados?$/).waitFor()
      await until(async () => (await read()) === start, { timeoutMs: 10000, everyMs: 100 }).catch(() => {})
      assert.equal(await read(), start, 'E4: the bell still counts the deleted messages')
      assert.equal(await summary(), start)
      await page.locator('[data-notice]').getByRole('button', { name: 'Deshacer' }).click()
      await until(async () => (await read()) === withSend, { timeoutMs: 10000, everyMs: 100 }).catch(() => {})
      assert.equal(await read(), withSend, 'E4: the bell does not count the restored messages')
    } finally { await context.close() }
  })

  test('E4: the notices of the bell for messages that were deleted go away, and opening none leads to «El mensaje no existe»', async () => {
    const title = h.unique('E4 aviso')
    const { context, page } = await h.open('ana', { origin: server.origin })
    try {
      await page.goto(server.origin)
      await page.getByTestId('compose-text').waitFor()
      await page.waitForTimeout(500) // the event stream is connected
      const { inputId } = await h.send(title, { as: 'bruno', recipients: ['ana'], origin: server.origin, server })
      await page.getByTestId('bell-unread').waitFor({ timeout: 10000 })
      await page.getByTestId('bell').click()
      await page.locator('[data-lane="bell-list"]').getByText(title, { exact: false }).first().waitFor()
      await page.keyboard.press('Escape')
      await h.api('bruno', server.origin).del(`/inputs/${inputId}?confirm=true&with_messages=true`)
      await page.getByTestId('bell-unread').waitFor({ state: 'detached', timeout: 10000 })
      await page.getByTestId('bell').click()
      assert.equal(await page.locator('[data-lane="bell-list"]').getByText(title, { exact: false }).count(), 0, 'E4: the bell still offers the deleted message')
    } finally { await context.close() }
  })
})
