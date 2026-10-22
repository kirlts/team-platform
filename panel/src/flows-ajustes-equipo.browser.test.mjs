// UD-252, H-3710 to H-3712: the Editor's controls that lived only in the API or the command line, in a real browser against
// dev-server.mjs serving panel/dist (`npm run test:flows`): another member's password from Equipo, the sample set from
// Configuración and the templates of an area open on arrival. With SHOTS_DIR set the test also writes screenshots.
import assert from 'node:assert'
import { mkdirSync } from 'node:fs'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_AJUSTES_PORT ?? 8483), { stepMs: 80 })
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
const SHOTS = process.env.SHOTS_DIR

async function session(who, path, ready, { viewport = DESKTOP, colorScheme = 'light' } = {}) {
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL', colorScheme })
  const page = await context.newPage()
  await login(page, origin, who)
  await page.locator('main#main').waitFor()
  await page.goto(`${origin}${path}`)
  await ready(page).waitFor()
  await settled(page)
  return { page, context }
}

const teamReady = (page) => page.getByRole('button', { name: 'Agregar miembro' }).or(page.getByText('Perfil', { exact: true })).first()
const rowOf = (page, email) => page.locator('main div.border-b').filter({ hasText: email }).first()
async function findRow(page, email) {
  for (let guard = 0; guard < 8; guard++) {
    const row = rowOf(page, email)
    if ((await row.count()) > 0) return row
    const next = page.getByRole('button', { name: 'Página siguiente' })
    assert.ok((await next.count()) > 0 && (await next.isEnabled()), `${email}: not on any page`)
    await next.click()
    await settled(page)
  }
  throw new Error(`${email}: not found after paging`)
}
async function shot(page, name) {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: `${SHOTS}/${name}.png` })
}

describe('Equipo: contraseña de otro miembro', () => {
  test('a member sees no «Contraseña» button and the Editor sees it on the others and not on their own row', async () => {
    const other = await session('bruno', '/team', teamReady)
    try {
      assert.equal(await other.page.getByRole('button', { name: /^Contraseña de/ }).count(), 0)
    } finally {
      await other.context.close()
    }
    const { page, context } = await session('ana', '/team', teamReady)
    try {
      assert.equal(await rowOf(page, 'ana@dev.invalid').getByRole('button', { name: /^Contraseña de/ }).count(), 0)
      assert.equal(await (await findRow(page, 'carla@dev.invalid')).getByRole('button', { name: 'Contraseña de Carla Prueba' }).count(), 1)
    } finally {
      await context.close()
    }
  })

  test('the field opens in the row with Guardar and Cancelar; a short password shows the server text; a valid one is sent and the field closes', async () => {
    for (const [viewport, colorScheme] of [[DESKTOP, 'light'], [DESKTOP, 'dark'], [PHONE, 'light'], [PHONE, 'dark']]) {
      const { page, context } = await session('ana', '/team', teamReady, { viewport, colorScheme })
      try {
        const row = await findRow(page, 'bruno@dev.invalid')
        const sent = []
        page.on('request', (r) => { if (r.method() === 'PATCH' && /\/api\/members\//.test(r.url())) sent.push(r.postData()) })
        await row.getByRole('button', { name: 'Contraseña de Bruno Prueba' }).click()
        const field = row.getByLabel('Contraseña nueva')
        await field.waitFor()
        assert.equal(await page.locator('[role="dialog"]').count(), 0, 'no dialog')
        await row.getByRole('button', { name: 'Cancelar' }).click()
        assert.equal(await row.getByLabel('Contraseña nueva').count(), 0)
        await row.getByRole('button', { name: 'Contraseña de Bruno Prueba' }).click()
        await field.fill('corta')
        await row.getByRole('button', { name: 'Guardar' }).click()
        await row.getByRole('alert').waitFor()
        assert.match(await row.getByRole('alert').innerText(), /demasiado corta/i)
        await settled(page)
        await shot(page, `equipo-${viewport.width}-${colorScheme}`)
        await field.fill('una clave larga de prueba 77')
        await row.getByRole('button', { name: 'Guardar' }).click()
        await field.waitFor({ state: 'detached' })
        assert.deepEqual(sent.map((b) => JSON.parse(b)), [{ password: 'corta' }, { password: 'una clave larga de prueba 77' }])
        // The row keeps its right edge on a phone: the buttons are not pushed out of the frame.
        if (viewport.width < 768) {
          const edge = await row.getByRole('button', { name: 'Eliminar a Bruno Prueba' }).evaluate((b) => b.getBoundingClientRect().right)
          assert.ok(edge <= viewport.width - 8, `Eliminar leaves the frame: ${edge}`)
        }
      } finally {
        await context.close()
      }
    }
  })
})

describe('Configuración: sembrar ejemplos', () => {
  const settingsReady = (page) => page.locator('[data-data-reset]')

  test('a member does not see the button', async () => {
    const { page, context } = await session('bruno', '/settings', (p) => p.getByRole('heading', { name: 'Cuenta' }))
    try {
      assert.equal(await page.getByRole('button', { name: 'Sembrar ejemplos' }).count(), 0)
    } finally {
      await context.close()
    }
  })

  test('«Sembrar ejemplos» sends the set, shows «N envíos» and the sends enter the tray', async () => {
    for (const [viewport, colorScheme] of [[DESKTOP, 'light'], [DESKTOP, 'dark'], [PHONE, 'light'], [PHONE, 'dark']]) {
      const { page, context } = await session('ana', '/settings', settingsReady, { viewport, colorScheme })
      try {
        await panel.control.reset()
        await page.reload()
        const section = page.locator('[data-data-reset]')
        await section.waitFor()
        const before = await page.evaluate(async () => (await (await fetch('/api/inputs?mine=1&status=queued,extracting,analyzing,proposed,published')).json()).total ?? 0)
        await section.getByRole('button', { name: 'Sembrar ejemplos' }).click()
        const figure = section.locator('[data-seed-figure]')
        await figure.waitFor()
        assert.match(await figure.innerText(), /^7 envíos$/)
        await settled(page)
        const after = await page.evaluate(async () => (await (await fetch('/api/inputs?mine=1&status=queued,extracting,analyzing,proposed,published')).json()).total ?? 0)
        assert.equal(after - before, 7)
        await section.scrollIntoViewIfNeeded()
        await shot(page, `datos-${viewport.width}-${colorScheme}`)
      } finally {
        await context.close()
      }
    }
  })
})

describe('Plantillas a la vista', () => {
  test('the area view opens with the templates unfolded and deleting one takes a single click', async () => {
    for (const [viewport, colorScheme] of [[DESKTOP, 'light'], [DESKTOP, 'dark'], [PHONE, 'light'], [PHONE, 'dark']]) {
      await panel.control.reset()
      const { page, context } = await session('ana', '/areas/a-error', (p) => p.locator('main article').first(), { viewport, colorScheme })
      try {
        const fold = page.getByRole('button', { name: /^Plantillas/ })
        assert.equal(await fold.getAttribute('aria-expanded'), 'true')
        const section = page.locator('section[aria-label="Plantillas"]')
        await section.waitFor()
        await section.getByRole('button', { name: 'Eliminar Reporte de error' }).waitFor()
        await shot(page, `area-${viewport.width}-${colorScheme}`)
        await section.getByRole('button', { name: 'Eliminar Reporte de error' }).click()
        await section.getByRole('status').filter({ hasText: 'eliminada' }).waitFor()
      } finally {
        await context.close()
      }
    }
  })

  test('the list of areas shows «N plantillas» as a link to that section of the area', async () => {
    const { page, context } = await session('ana', '/areas', (p) => p.getByRole('link', { name: /^Plantillas de/ }).first())
    try {
      const link = page.getByRole('link', { name: /^Plantillas de/ }).first()
      assert.match(await link.innerText(), /^\d+ plantillas$/)
      await link.click()
      await page.waitForURL(/#plantillas$/)
      await page.locator('section[aria-label="Plantillas"]').waitFor()
      assert.equal(await page.getByRole('button', { name: /^Plantillas/ }).getAttribute('aria-expanded'), 'true')
    } finally {
      await context.close()
    }
  })
})
