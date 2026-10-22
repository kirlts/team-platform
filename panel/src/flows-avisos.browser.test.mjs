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

async function session(viewport = DESKTOP) {
  const phone = viewport.width < 768
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL', isMobile: phone, hasTouch: phone })
  const page = await context.newPage()
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
const deactivate = (page, name) => page.getByRole('button', { name: `Desactivar a ${name}` }).click()
/** A notice with nothing to click: a new password for a member. */
async function plainNotice(page, name) {
  await page.getByRole('button', { name: `Contraseña de ${name}` }).click()
  await page.getByLabel('Contraseña nueva').fill('una-clave-larga-de-prueba')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await notice(page).getByText(`Contraseña de ${name} cambiada`, { exact: true }).waitFor()
}
/** How long the notice stays from now, in ms, measured in the page. */
const lifetime = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const start = performance.now()
        const watch = new MutationObserver(() => {
          if (!document.querySelector('[data-notice]')) {
            watch.disconnect()
            resolve(performance.now() - start)
          }
        })
        watch.observe(document.body, { childList: true, subtree: true })
      }),
  )

describe('the notice of the screen (UD-253)', () => {
  test('a notice with nothing to click leaves by itself after 5 s, and has no close button', async () => {
    const { page, context } = await session()
    try {
      await plainNotice(page, 'Carla Prueba')
      assert.equal(await notice(page).getAttribute('data-notice-ms'), '5000')
      assert.equal(await notice(page).getByRole('button').count(), 0, 'the notice carries a button')
      const ms = await lifetime(page)
      assert.ok(ms > 4000 && ms < 5800, `it stayed ${Math.round(ms)} ms`)
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
    const { page, context } = await session()
    try {
      await plainNotice(page, 'Carla Prueba')
      await notice(page).hover()
      assert.equal(await notice(page).getAttribute('data-paused'), 'true')
      await page.waitForTimeout(6500)
      assert.equal(await notice(page).count(), 1, 'the notice left with the pointer on it')
      await page.mouse.move(5, 890)
      const ms = await lifetime(page)
      assert.ok(ms > 3000 && ms < 5800, `after the pointer left it stayed ${Math.round(ms)} ms`)
    } finally {
      await context.close()
    }
  })

  test('the count stops while the focus is on Deshacer, and Escape closes it', async () => {
    const { page, context } = await session()
    try {
      await deactivate(page, 'Carla Prueba')
      await notice(page).getByRole('button', { name: 'Deshacer' }).focus()
      await page.mouse.move(5, 890)
      assert.equal(await notice(page).getAttribute('data-paused'), 'true')
      await page.waitForTimeout(8800)
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
