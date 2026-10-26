// UD-253 (H-3717): the notice of the screen leaves by itself, is centered on the window, pauses while the pointer or the focus is
// on it, closes with Escape, has no close button, a new one replaces the previous one, and its Deshacer undoes. In a real browser
// against dev-server.mjs serving panel/dist: `npm run test:flows`. Every test can fail if the defect it names comes back.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_AVISOS_PORT ?? 8986), { stepMs: 80 })
  origin = panel.origin
})

beforeEach(async () => {
  await panel.control.reset()
})

after(async () => {
  await panel?.stop()
})

const DESKTOP = { width: 1440, height: 900 }
const PHONE = { width: 390, height: 844 }

// `clock: true` gives the page a clock the test advances (`page.clock.runFor`): the life of a notice (5 s, 8 s) is checked by moving that clock, not by waiting it.
async function session(viewport = DESKTOP, { clock = false } = {}) {
  const phone = viewport.width < 768
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL', isMobile: phone, hasTouch: phone })
  const page = await context.newPage()
  if (clock) await page.clock.install()
  await login(page, origin, 'ana')
  await page.locator('main#main').waitFor()
  await page.goto(`${origin}/team`)
  await page.getByRole('button', { name: 'Agregar miembro' }).waitFor()
  await settled(page)
  return { page, context }
}

const notice = (page) => page.locator('[data-notice]')
const member = (page, email) => page.evaluate(async (e) => (await (await fetch('/api/members')).json()).items.find((m) => m.email === e), email)
/** A notice with Deshacer: deactivating a member (UD-240 keeps it reversible). */
async function deactivate(page, name) {
  await page.getByRole('button', { name: `Acciones de ${name}` }).click()
  await page.getByRole('menuitem', { name: `Desactivar a ${name}` }).click()
}
/** A notice with nothing to click: a new password for a member. */
async function plainNotice(page, name) {
  await page.getByRole('button', { name: `Acciones de ${name}` }).click()
  await page.getByRole('menuitem', { name: `Cambiar contraseña de ${name}` }).click()
  await page.getByLabel('Contraseña nueva').fill('una-clave-larga-de-prueba')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await notice(page).getByText(`Contraseña de ${name} cambiada`, { exact: true }).waitFor()
}
describe('the notice of the screen (UD-253)', () => {
  test('a notice with nothing to click leaves by itself after 5 s, and has no close button', async () => {
    const { page, context } = await session(DESKTOP, { clock: true })
    try {
      await plainNotice(page, 'Carla Prueba')
      assert.equal(await notice(page).getAttribute('data-notice-ms'), '5000')
      assert.equal(await notice(page).getByRole('button').count(), 0, 'the notice carries a button')
      await page.clock.runFor(4000)
      await notice(page).first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
      assert.equal(await notice(page).count(), 1, 'it left before 4 s')
      await page.clock.runFor(1800)
      assert.equal(await notice(page).count(), 0, 'it stayed more than 5.8 s')
    } finally {
      await context.close()
    }
  })

  test('a notice with Deshacer stays 8 s, and Deshacer undoes', async () => {
    const { page, context } = await session()
    try {
      await deactivate(page, 'Carla Prueba')
      await notice(page).getByText('Carla Prueba desactivado').waitFor()
      assert.equal(await notice(page).getAttribute('data-notice-ms'), '8000')
      assert.equal((await member(page, 'carla@dev.invalid')).active, false)
      await notice(page).getByRole('button', { name: 'Deshacer' }).click()
      await notice(page).waitFor({ state: 'detached' })
      await page.waitForFunction(async () => (await (await fetch('/api/members')).json()).items.find((m) => m.email === 'carla@dev.invalid').active === true)
    } finally {
      await context.close()
    }
  })

  test('the count stops while the pointer is on the notice and resumes when it leaves', async () => {
    const { page, context } = await session(DESKTOP, { clock: true })
    try {
      await plainNotice(page, 'Carla Prueba')
      await notice(page).hover()
      assert.equal(await notice(page).getAttribute('data-paused'), 'true')
      await page.clock.runFor(6500)
      await notice(page).first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
      assert.equal(await notice(page).count(), 1, 'the notice left with the pointer on it')
      await page.mouse.move(5, 890)
      await page.clock.runFor(3000)
      await notice(page).first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
      assert.equal(await notice(page).count(), 1, 'after the pointer left it stayed less than 3 s')
      await page.clock.runFor(2800)
      assert.equal(await notice(page).count(), 0, 'after the pointer left it stayed more than 5.8 s')
    } finally {
      await context.close()
    }
  })

  test('the count stops while the focus is on Deshacer, and Escape closes it', async () => {
    const { page, context } = await session(DESKTOP, { clock: true })
    try {
      await deactivate(page, 'Carla Prueba')
      await notice(page).getByRole('button', { name: 'Deshacer' }).focus()
      await page.mouse.move(5, 890)
      assert.equal(await notice(page).getAttribute('data-paused'), 'true')
      await page.clock.runFor(8800)
      await notice(page).first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
      assert.equal(await notice(page).count(), 1, 'the notice left with the focus on it')
      await page.keyboard.press('Escape')
      await notice(page).waitFor({ state: 'detached', timeout: 1000 })
      assert.equal((await member(page, 'carla@dev.invalid')).active, false, 'Escape undid')
    } finally {
      await context.close()
    }
  })

  test('a new notice replaces the previous one', async () => {
    const { page, context } = await session()
    try {
      await deactivate(page, 'Carla Prueba')
      await notice(page).getByText('Carla Prueba desactivado').waitFor()
      await deactivate(page, 'Diego Prueba')
      await notice(page).getByText('Diego Prueba desactivado').waitFor()
      await notice(page).first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
      assert.equal(await notice(page).count(), 1)
    } finally {
      await context.close()
    }
  })

  for (const [name, viewport] of [['1440x900', DESKTOP], ['390x844', PHONE]]) {
    test(`centered on the window within 2 px at ${name}, as wide as its text`, async () => {
      const { page, context } = await session(viewport)
      try {
        await deactivate(page, 'Carla Prueba')
        await notice(page).getByText('Carla Prueba desactivado').waitFor()
        await settled(page)
        const box = await notice(page).boundingBox()
        const center = box.x + box.width / 2
        assert.ok(Math.abs(center - viewport.width / 2) <= 2, `center at ${center}, window center ${viewport.width / 2}`)
        assert.ok(box.width < viewport.width - 64, `it spans ${box.width} px of ${viewport.width}`)
        if (viewport === DESKTOP) assert.ok(box.y + box.height <= 56, `in the top bar: ${box.y + box.height}`)
        else assert.ok(box.y + box.height >= viewport.height - 24 && box.y + box.height <= viewport.height, `at the bottom: ${box.y + box.height}`)
      } finally {
        await context.close()
      }
    })
  }
})
