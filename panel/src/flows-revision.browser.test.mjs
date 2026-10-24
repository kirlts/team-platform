// UD-275: the review of a held delivery inside the sheet of the message. Against dev-server.mjs: `npm run test:flows`.
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

describe('Review of a held delivery (UD-275)', () => {
  test('the block shows the reason and three actions; «Entregar» asks first, then shows the progress until the answer', async () => {
    const { message_id: id } = await panel.control.review()
    const { page, context } = await session('ana', `/messages/${id}`)
    try {
      const block = page.getByTestId('review-pending')
      await block.waitFor()
      assert.equal(await page.getByTestId('review-reason').innerText(), 'Toca datos de personas')
      assert.deepEqual(await block.getByRole('button').allInnerTexts(), ['Entregar', 'Pedir cambios', 'Descartar'])
      await shot(page, 'revision-escritorio')
      await page.getByTestId('review-deliver').click()
      const dialog = page.getByRole('dialog')
      assert.match(await dialog.innerText(), /Se publica en producción/)
      await shot(page, 'revision-confirmacion-escritorio')
      await page.getByTestId('review-confirm').click()
      await page.getByTestId('review-progress').waitFor()
      await shot(page, 'revision-progreso-escritorio')
      await block.waitFor({ state: 'detached' })
      assert.match(await page.getByText('Ya está en producción.').first().innerText(), /Ya está en producción/)
    } finally {
      await context.close()
    }
  })

  test('«Pedir cambios» takes the focus to the reply field and says who to address', async () => {
    const { message_id: id } = await panel.control.review()
    const { page, context } = await session('ana', `/messages/${id}`)
    try {
      await page.getByTestId('review-changes').click()
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'reply-field')
      assert.equal(await page.getByTestId('review-hint').innerText(), 'Escribir los cambios abajo para Claude')
    } finally {
      await context.close()
    }
  })

  test('«Descartar» needs a reason; then the block goes and the thread says who discarded and why', async () => {
    const { message_id: id } = await panel.control.review()
    const { page, context } = await session('ana', `/messages/${id}`)
    try {
      await page.getByTestId('review-discard').click()
      const confirm = page.getByTestId('review-discard-confirm')
      assert.equal(await confirm.isDisabled(), true)
      await page.getByTestId('review-discard-reason').fill('Las fotos no van a la ficha.')
      await shot(page, 'revision-descartar-escritorio')
      await confirm.click()
      await page.getByTestId('review-pending').waitFor({ state: 'detached' })
      assert.match(await page.getByText(/^Descartado por Ana Prueba: Las fotos no van a la ficha\.$/).innerText(), /Descartado por/)
    } finally {
      await context.close()
    }
  })

  test('a member who is not an Editor sees the block without buttons and who approves', async () => {
    const { message_id: id } = await panel.control.review()
    const { page, context } = await session('bruno', `/messages/${id}`)
    try {
      await page.getByTestId('review-pending').waitFor()
      assert.equal(await page.getByTestId('review-pending').getByRole('button').count(), 0)
      assert.match(await page.getByTestId('review-approvers').innerText(), /^Lo aprueba: Ana Prueba/)
    } finally {
      await context.close()
    }
  })

  test('on a phone the block fits and its actions are reachable', async () => {
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
