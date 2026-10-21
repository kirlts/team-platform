// UD-120, UD-121: the Editor sees, replaces, retires and diagnoses the API keys of the providers from Configuración, and no key value
// stays on the page. Read in a real browser against dev-server.mjs serving panel/dist: `npm run test:flows`.
// SHOTS_DIR=<dir> also writes the screenshots of the section (1440x900 and 390x844, light and dark).
import assert from 'node:assert'
import { mkdirSync } from 'node:fs'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

let panel
let origin = ''
const SHOTS = process.env.SHOTS_DIR ?? ''
const SENTINEL = 'sk-CENTINELA-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_PROVIDERS_PORT ?? 8801), { stepMs: 80 })
  origin = panel.origin
  if (SHOTS) mkdirSync(SHOTS, { recursive: true })
})
beforeEach(async () => {
  await panel.control.reset()
})
after(async () => {
  await panel?.stop()
})

const DESKTOP = { width: 1440, height: 900 }
const PHONE = { width: 390, height: 844 }

async function session(who = 'ana', viewport = DESKTOP, scheme = 'light') {
  const mobile = viewport.width < 768
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL', colorScheme: scheme, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 })
  const page = await context.newPage()
  await login(page, origin, who)
  await page.goto(`${origin}/settings`)
  await page.locator('main h1').first().waitFor()
  await settled(page)
  return { page, context }
}

const row = (page, name) => page.locator(`li[data-connection="${name}"]`)

describe('Providers section of Configuración (UD-120)', () => {
  test('the Editor sees the functions and the providers with status and last four characters; a Member does not see the section', async () => {
    const { page, context } = await session()
    try {
      const section = page.locator('[data-providers]')
      await section.waitFor()
      for (const slot of ['text', 'vision', 'speech']) await section.locator(`li[data-slot="${slot}"]`).waitFor()
      assert.equal(await row(page, 'groq-speech').getAttribute('data-status'), 'configured')
      assert.equal(await row(page, 'mi-gateway').getAttribute('data-status'), 'failing')
      assert.match(await row(page, 'groq-speech').innerText(), /5678/)
    } finally {
      await context.close()
    }
    const member = await session('bruno')
    try {
      assert.equal(await member.page.locator('[data-providers]').count(), 0)
    } finally {
      await member.context.close()
    }
  })

  test('a replacement key that fails says why and the previous key stays; one that works replaces it', async () => {
    const { page, context } = await session()
    try {
      const r = row(page, 'mi-gateway')
      await r.getByRole('button', { name: 'Reemplazar clave' }).click()
      const form = page.locator('form[data-key-form="mi-gateway"]')
      await form.getByLabel('Clave de API').fill(`${SENTINEL}-fail-invalid_key`)
      await form.getByRole('button', { name: 'Probar y guardar' }).click()
      await r.getByRole('status').filter({ hasText: /rechaz|inválida/i }).first().waitFor()
      assert.match(await r.innerText(), /9f2a/, 'the previous key is still the one in use')
      // The value typed is not left anywhere on the page.
      assert.ok(!(await page.content()).includes(SENTINEL))
      await form.getByLabel('Clave de API').fill(`${SENTINEL}-0000-wxyz`)
      await form.getByRole('button', { name: 'Probar y guardar' }).click()
      await page.waitForFunction(() => document.querySelector('li[data-connection="mi-gateway"]')?.textContent?.includes('wxyz'))
      assert.equal(await r.getAttribute('data-status'), 'configured')
      assert.ok(!(await page.content()).includes(SENTINEL))
      assert.ok(!(await page.evaluate(() => JSON.stringify([...Object.entries(localStorage), ...Object.entries(sessionStorage)]))).includes(SENTINEL))
    } finally {
      await context.close()
    }
  })

  test('retiring the key of a provider a function uses is blocked and names the function', async () => {
    const { page, context } = await session()
    try {
      await row(page, 'groq-speech').getByRole('button', { name: 'Retirar clave' }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('button', { name: /^Retirar$/ }).click()
      await dialog.getByRole('group', { name: 'Funciones que usan este proveedor' }).waitFor()
      assert.match(await dialog.innerText(), /Transcripción/)
      assert.equal(await row(page, 'groq-speech').getAttribute('data-status'), 'configured', 'nothing was retired')
    } finally {
      await context.close()
    }
  })

  test('adding a provider from a preset tests the key first and lists it; a failing key adds nothing', async () => {
    const { page, context } = await session()
    try {
      await page.getByRole('button', { name: 'Agregar proveedor' }).click()
      const form = page.locator('form[data-add-form]')
      await form.locator('select').first().selectOption({ label: 'DeepSeek' })
      await form.getByLabel('Clave de API').fill(`${SENTINEL}-fail-no_quota`)
      await form.getByRole('button', { name: 'Probar y guardar' }).click()
      await form.getByRole('status').filter({ hasText: /cuota/i }).first().waitFor()
      assert.equal(await row(page, 'deepseek').count(), 0)
      await form.getByLabel('Clave de API').fill(`${SENTINEL}-ok-4321`)
      await form.getByRole('button', { name: 'Probar y guardar' }).click()
      await row(page, 'deepseek').waitFor()
      assert.match(await row(page, 'deepseek').innerText(), /4321/)
      assert.ok(!(await page.content()).includes(SENTINEL))
    } finally {
      await context.close()
    }
  })

  test('a diagnosis shows the duration and the models the provider lists', async () => {
    const { page, context } = await session()
    try {
      await row(page, 'groq-speech').getByRole('button', { name: 'Diagnosticar' }).click()
      const result = row(page, 'groq-speech').locator('[data-check-result="ok"]')
      await result.waitFor()
      assert.match(await result.innerText(), /\d+ ms/)
      await result.getByRole('button', { name: /modelos/i }).click()
      await result.getByText('modelo-a').waitFor()
    } finally {
      await context.close()
    }
  })

  test('the section fits the width at 390 px and has no lane of its own', async () => {
    const { page, context } = await session('ana', PHONE)
    try {
      await page.locator('[data-providers]').waitFor()
      const m = await page.evaluate(() => ({ wide: document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth, lanes: [...document.querySelectorAll('[data-providers] *')].filter((el) => ['auto', 'scroll'].includes(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1).length }))
      assert.equal(m.wide, 0)
      assert.equal(m.lanes, 0)
    } finally {
      await context.close()
    }
  })

  test('screenshots of Configuración', { skip: !SHOTS }, async () => {
    for (const [size, name] of [[DESKTOP, '1440x900'], [PHONE, '390x844']]) {
      for (const scheme of ['light', 'dark']) {
        const { page, context } = await session('ana', size, scheme)
        try {
          await row(page, 'groq-speech').getByRole('button', { name: 'Diagnosticar' }).click()
          await row(page, 'groq-speech').locator('[data-check-result]').waitFor()
          await page.evaluate(() => document.querySelector('main').scrollTo(0, 0))
          await page.screenshot({ path: `${SHOTS}/configuracion-${name}-${scheme}.png` })
          await page.locator('[data-providers]').screenshot({ path: `${SHOTS}/proveedores-${name}-${scheme}.png` })
        } finally {
          await context.close()
        }
      }
    }
  })
})
