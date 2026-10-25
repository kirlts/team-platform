// M5: when a message with attachments goes up, the interface says at once that it is going up and then that it is being processed (UD-025, UD-046).
// The answer of the server is held on purpose, so «at once» is not a race: what the person sees while the server has not answered is what is measured.
// Complement (against the development double, so not counted as coverage): panel/src/flows.browser.test.mjs.
import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import { FILES, harness, scriptedAnalyze } from './harness.mjs'

let h
before(async () => { h = await harness() })

/** The attachments of the bar: the hidden file input of «Adjuntar → Archivo» (the one of the camera has `capture`). */
const attach = (page, files) => page.locator('input[type=file]:not([capture])').first().setInputFiles(files.map((f) => ({ name: f.name, mimeType: f.type, buffer: f.buffer })))

describe('M5: attachments going up are announced at once, and so is the processing after', () => {
  test('M5: with the upload still waiting for the server the drawer already says «Subiendo» and names the files', async () => {
    const { page, context } = await h.open('bruno')
    try {
      let release = () => {}
      const held = new Promise((resolve) => (release = resolve))
      await page.route(/\/api\/inputs$/, async (route) => {
        if (route.request().method() !== 'POST') return route.continue()
        await held
        await route.continue()
      })
      await page.goto(h.origin)
      await page.getByTestId('compose-text').fill(h.unique('M5 subida'))
      await attach(page, [FILES.photo('captura-uno.png'), FILES.video()])
      await page.getByTestId('compose-send').click()
      const drawer = page.getByTestId('send-drawer')
      await drawer.waitFor({ timeout: 2000 })
      await drawer.getByText(/Subiendo|Enviando/).first().waitFor({ timeout: 2000 })
      const said = await drawer.innerText()
      assert.match(said, /Subiendo/, 'M5: the person is told the files are going up while the server has not answered')
      assert.ok(said.includes('captura-uno.png') && said.includes('video.webm'), `M5: the drawer names the files that go up (it says: ${said.replace(/\n+/g, ' | ')})`)
      assert.equal(await page.getByTestId('compose-text').inputValue(), '', 'M5: the bar is free again at once (UD-025)')
      release()
      await drawer.getByText(/Publicado|Para revisar|Leyendo|Analizando|En espera/).first().waitFor({ timeout: 15000 })
    } finally {
      await context.close()
    }
  })

  test('M5: once uploaded, while the analysis has not finished, the interface says it is being processed', async () => {
    let open = () => {}
    const gate = new Promise((resolve) => (open = resolve))
    const slow = await h.another({ modules: { analyze: async (bundle, options) => { await gate; return scriptedAnalyze(bundle, options) } } })
    const { page, context } = await h.open('bruno', { origin: slow.origin })
    try {
      await page.goto(slow.origin)
      await page.getByTestId('compose-text').fill(h.unique('M5 proceso'))
      await attach(page, [FILES.photo(), FILES.audio()])
      await page.getByTestId('compose-send').click()
      const drawer = page.getByTestId('send-drawer')
      await drawer.waitFor({ timeout: 2000 })
      await drawer.getByText(/En espera|Leyendo|Analizando/).first().waitFor({ timeout: 8000 })
      assert.match(await drawer.innerText(), /En espera|Leyendo|Analizando/, 'M5: while the analysis runs the drawer shows the state of the processing, not an empty box')
      assert.equal(await drawer.getByText(/Publicado/).count(), 0, 'M5: it does not claim to be published before it is')
      open()
      await drawer.getByText(/Publicado/).first().waitFor({ timeout: 15000 })
    } finally {
      open()
      await context.close()
    }
  })
})
