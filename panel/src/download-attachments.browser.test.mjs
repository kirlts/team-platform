// A PDF of a reply (and of a message) can be downloaded from the thread with its original name, on a desktop and on a phone.
// Real browser against dev-server.mjs serving panel/dist (PANEL_DEV_MEDIA=1): `npm run test:gallery`.
// With DOWNLOAD_CAPTURES=<directory> it leaves screenshots at 1440x900 and 390x844.
import assert from 'node:assert'
import { mkdirSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

process.env.PANEL_DEV_MEDIA = '1'
const CAPTURES = process.env.DOWNLOAD_CAPTURES
const NAME = 'Subir fotos clínicas desde el teléfono.pdf'
let panel
let origin = ''

before(async () => {
  if (CAPTURES) mkdirSync(CAPTURES, { recursive: true })
  panel = await startPanel(Number(process.env.PANEL_DOWNLOAD_PORT ?? 8937))
  origin = panel.origin
})
after(async () => {
  await panel?.stop()
})

async function open(viewport, mobile) {
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL', colorScheme: 'light', isMobile: mobile, hasTouch: mobile, acceptDownloads: true })
  const page = await context.newPage()
  await login(page, origin, 'ana')
  const body = await (await page.request.get(`${origin}/api/messages?limit=200`)).json()
  const found = (body.items ?? body).find((m) => m.title === 'Manual en PDF en la respuesta final')
  assert.ok(found, 'the sample message exists')
  await page.goto(`${origin}/messages/${found.id}`)
  await page.locator('main h1').waitFor()
  await settled(page)
  return { page, context }
}

for (const [label, viewport, mobile] of [['desktop', { width: 1440, height: 900 }, false], ['phone', { width: 390, height: 844 }, true]]) {
  describe(label, () => {
    test('the reply shows the PDF with name and size, and its «Descargar» icon produces the file with the original name', async () => {
      const { page, context } = await open(viewport, mobile)
      try {
        const reply = page.locator('[aria-label="Adjuntos"]', { has: page.locator('[data-testid="download-attachment"]') }).last()
        await reply.waitFor()
        const row = reply.locator('li', { hasText: NAME })
        assert.ok(await row.getByText(/KB|B$/).count() >= 1, 'the size is next to the name')
        const link = row.getByRole('link', { name: `Descargar ${NAME}` })
        await link.first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
        assert.equal(await link.count(), 1)
        const [download] = await Promise.all([page.waitForEvent('download'), link.click()])
        assert.equal(download.suggestedFilename(), NAME)
        // The PDF itself opens in a tab of its own.
        const open = row.getByRole('link', { name: `Abrir ${NAME}` })
        assert.equal(await open.getAttribute('target'), '_blank')
        // The picture of the reply keeps its open view and gets the same icon.
        const picture = page.locator('ul[aria-label="Adjuntos"] img').first()
        await picture.waitFor()
        assert.equal(await page.getByRole('link', { name: /Descargar foto-1\.svg/ }).count() >= 1, true)
        if (CAPTURES) {
          await reply.scrollIntoViewIfNeeded()
          await page.screenshot({ path: `${CAPTURES}/hilo-${label}.png`, fullPage: false })
        }
      } finally {
        await context.close()
      }
    })

    test('the gallery of the message has the icon for its current medium', async () => {
      const { page, context } = await open(viewport, mobile)
      try {
        const g = page.locator('[data-gallery]').first()
        const [download] = await Promise.all([page.waitForEvent('download'), g.getByRole('link', { name: `Descargar ${NAME}` }).click()])
        assert.equal(download.suggestedFilename(), NAME)
        if (CAPTURES) await page.screenshot({ path: `${CAPTURES}/ficha-${label}.png` })
      } finally {
        await context.close()
      }
    })
  })
}
