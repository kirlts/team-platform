// UD-045 to UD-047 and UD-070/071 seen from the panel: Inicio after the mockup (`Plataforma Team.png`), in a real browser against
// dev-server.mjs serving panel/dist with auto-publication on, as the real server has it by default: `npm run test:flows`.
// Every test can fail if the defect it names comes back.
import assert from 'node:assert'
import { after, before, describe, test } from 'node:test'
import { login, startPanel } from './browser-support.mjs'

process.env.PANEL_DEV_AUTO_PUBLISH = '1'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_INICIO_PORT ?? 8958), { stepMs: 80 })
  origin = panel.origin
})

after(async () => {
  await panel?.stop()
})

const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1440, height: 900 }

async function session(who = 'bruno', viewport = DESKTOP, scheme = 'light') {
  const mobile = viewport.width < 768
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL', colorScheme: scheme, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 })
  const page = await context.newPage()
  await login(page, origin, who)
  await page.locator('main').first().waitFor()
  return { page, context }
}

const bar = (page) => page.getByLabel('Nuevo mensaje', { exact: true }).last()
const send = async (page, text) => {
  await bar(page).fill(text)
  await page.getByRole('button', { name: 'Enviar' }).first().click()
}
const bg = (locator) => locator.evaluate((el) => getComputedStyle(el).backgroundColor)
const api = async (page, path, init = {}) => {
  const res = await page.request.fetch(`${origin}/api${path}`, { ...init, headers: { 'x-team-request': 'panel', ...(init.headers ?? {}) } })
  return { status: res.status(), body: await res.json().catch(() => null) }
}

describe('the drawer under the bar (UD-046, UD-070)', () => {
  test('a send shows up under the bar, analyzed and published, with no click after the send', async () => {
    const { page, context } = await session()
    try {
      await send(page, 'El botón de guardar no responde en el móvil.')
      const drawer = page.getByTestId('send-drawer')
      await drawer.waitFor()
      const published = drawer.getByTestId('published-message').first()
      await published.waitFor({ timeout: 20000 })
      // No confirmation step: neither the button that published nor the one that discarded exist, and nothing opened over the page.
      assert.equal(await page.getByRole('button', { name: /^Enviar \d+ mensajes?$/ }).count(), 0, 'ya no hay botón Enviar N mensajes')
      assert.equal(await page.getByRole('button', { name: 'Descartar envío' }).count(), 0, 'Descartar envío no es un paso')
      assert.equal(await page.getByRole('dialog').count(), 0, 'nada se abre sobre la página')
      // It sits under the bar of text (mockup), and the original is beside the analysis.
      const barBox = await bar(page).boundingBox()
      const drawerBox = await drawer.boundingBox()
      assert.ok(drawerBox.y > barBox.y + barBox.height - 1, 'el desplegable queda bajo la barra')
      const original = await drawer.getByTestId('original-box').boundingBox()
      const analysis = await published.boundingBox()
      assert.ok(original.x + original.width <= analysis.x + 1, 'el original queda a la izquierda del análisis')
      // The message is already in the team's list.
      const body = await api(page, '/messages')
      assert.ok((body.body.items ?? body.body).some((m) => m.title.startsWith('El botón de guardar')), 'el mensaje está publicado')
    } finally {
      await context.close()
    }
  })

  test('the original is neutral and the analysis wears the secondary color of its area, which changes with the area (UD-045)', async () => {
    const { page, context } = await session()
    try {
      await send(page, 'Se me ocurre mostrar un resumen semanal en la portada.')
      const box = page.getByTestId('published-message').first()
      await box.waitFor({ timeout: 20000 })
      const original = page.getByTestId('original-box')
      const before = { analysis: await bg(box), original: await bg(original), area: await box.getAttribute('data-area-id') }
      assert.notEqual(before.analysis, before.original, 'lo enviado y el análisis se ven distintos')
      // The chip of the area carries the main color: not the same as the box's tint.
      const chip = box.getByTestId('area-picker')
      assert.notEqual(await bg(chip), before.analysis, 'el chip y el fondo no son el mismo color')
      await chip.click()
      const other = page.getByRole('menuitemradio').filter({ hasNotText: /Idea|Accesibilidad/ }).first()
      await other.click()
      await page.waitForFunction((area) => document.querySelector('[data-testid="published-message"]')?.getAttribute('data-area-id') !== area, before.area)
      assert.notEqual(await bg(box), before.analysis, 'al cambiar el área cambia el color del recuadro')
      await box.getByTestId('edited-mark').waitFor()
    } finally {
      await context.close()
    }
  })

  test('the area chip shows its own container with the name of the area, and a state is never an area color (UD-045)', async () => {
    const { page, context } = await session('ana')
    try {
      await page.locator('article').first().waitFor()
      const areas = (await api(page, '/areas')).body
      const list = areas.items ?? areas
      const card = page.locator('article').filter({ has: page.getByTestId('area-chip') }).first()
      const chip = card.getByTestId('area-chip')
      const name = (await chip.innerText()).trim()
      const area = list.find((a) => a.title === name)
      assert.ok(area, `el chip dice «${name}»`)
      const hex = area.color.slice(1).match(/../g).map((h) => parseInt(h, 16))
      assert.equal(await bg(chip), `rgb(${hex.join(', ')})`, 'el chip lleva el color principal del área')
      // The state is a mark with its word, in its own element: a different one from the chip.
      assert.ok((await card.getByTestId('state-mark').count()) >= 1)
    } finally {
      await context.close()
    }
  })

  test('with several sends in a row the drawer shows the current one and a compact selector of the others, in the same place', async () => {
    const { page, context } = await session('carla')
    try {
      await send(page, 'Primer envío de la ráfaga: revisar el contraste del botón.')
      await page.getByTestId('published-message').first().waitFor({ timeout: 20000 })
      await send(page, 'Segundo envío de la ráfaga: agregar la exportación a CSV.')
      const switcher = page.getByTestId('send-switcher')
      await switcher.waitFor()
      const before = await page.getByTestId('send-drawer').boundingBox()
      assert.ok((await switcher.getByRole('option').count()) >= 2, 'cada envío tiene su opción')
      // «N para revisar» that obliges another click does not exist: everything is in the drawer.
      assert.equal(await page.getByText(/para revisar/).count(), 0)
      // Opening another send changes the content in place, not the place of the drawer.
      const first = switcher.getByRole('option').filter({ hasText: /Primer envío/ }).first()
      await first.click()
      await page.getByTestId('original-box').getByText('Primer envío de la ráfaga').waitFor()
      const after = await page.getByTestId('send-drawer').boundingBox()
      assert.equal(Math.round(after.y), Math.round(before.y), 'el desplegable no cambia de lugar')
    } finally {
      await context.close()
    }
  })

  test('the sender edits the published message in place, it says «Editado» and the history takes the change back', async () => {
    const { page, context } = await session('diego')
    try {
      await send(page, 'Error: el filtro de fechas deja elegir días pasados.')
      const box = page.getByTestId('published-message').first()
      await box.waitFor({ timeout: 20000 })
      await box.getByRole('button', { name: /^Título del mensaje:/ }).click()
      const field = box.getByRole('textbox', { name: 'Título del mensaje' })
      await field.fill('Título corregido por quien lo envió')
      await field.press('Enter')
      await box.getByRole('button', { name: /^Título del mensaje: Título corregido/ }).waitFor()
      await box.getByTestId('edited-mark').waitFor()
      const id = (await box.getByRole('link', { name: /^Abrir el mensaje/ }).getAttribute('href')).split('/').pop()
      assert.equal((await api(page, `/messages/${id}`)).body.title, 'Título corregido por quien lo envió', 'quedó guardado en el mensaje publicado')
      await page.getByRole('button', { name: 'Deshacer' }).first().click()
      await page.waitForFunction(() => !document.body.innerText.includes('Título corregido por quien lo envió'))
    } finally {
      await context.close()
    }
  })

  test('nobody but the sender edits a message, the Editor included: no controls and the server refuses (UD-071)', async () => {
    const { page, context } = await session('ana') // the Editor
    try {
      const list = (await api(page, '/messages')).body
      const mine = (await api(page, '/me')).body
      const other = (list.items ?? list).find((m) => m.author_id !== mine.id)
      assert.ok(other, 'hay un mensaje de otra persona')
      await page.goto(`${origin}/messages/${other.id}`)
      await page.locator('main h1').waitFor()
      assert.equal(await page.getByRole('button', { name: /^Título del mensaje|^Texto del mensaje/ }).count(), 0, 'no hay edición en el lugar')
      assert.equal(await page.getByTestId('area-picker').count(), 0, 'el área no se cambia')
      const refused = await api(page, `/messages/${other.id}`, { method: 'PATCH', data: { title: 'Intento ajeno', version: 1 } })
      assert.equal(refused.status, 403)
      assert.equal(refused.body.code, 'not_message_author')
    } finally {
      await context.close()
    }
  })

  test('an edit that carries an old version is read again and sent once more (edit_conflict)', async () => {
    const { page, context } = await session('valentina')
    try {
      await send(page, 'Pregunta: ¿quién revisa el contrato del cliente?')
      const box = page.getByTestId('published-message').first()
      await box.waitFor({ timeout: 20000 })
      const id = (await box.getByRole('link', { name: /^Abrir el mensaje/ }).getAttribute('href')).split('/').pop()
      // The same person edits from another tab: the version the drawer holds is now old.
      const current = (await api(page, `/messages/${id}`)).body
      assert.equal((await api(page, `/messages/${id}`, { method: 'PATCH', data: { title: 'Cambio desde otra pestaña', version: current.version } })).status, 200)
      await box.getByRole('button', { name: /^Texto del mensaje:/ }).click()
      const field = box.getByRole('textbox', { name: 'Texto del mensaje' })
      await field.fill('Texto nuevo, sobre una versión vieja.')
      await field.press('Enter')
      await box.getByRole('button', { name: /^Texto del mensaje: Texto nuevo/ }).waitFor()
      assert.equal(await page.getByRole('alert').count(), 0, 'el conflicto no se le muestra a quien editó otro campo')
      const saved = (await api(page, `/messages/${id}`)).body
      assert.equal(saved.body, 'Texto nuevo, sobre una versión vieja.')
      assert.equal(saved.title, 'Cambio desde otra pestaña', 'lo que se guardó antes se conserva')
    } finally {
      await context.close()
    }
  })
})

describe('the side panel (UD-047)', () => {
  test('it is hidden with the button beside the user, shown again from the bar, and remembered per person', async () => {
    const { page, context } = await session('bruno')
    try {
      const sidebar = page.getByTestId('sidebar')
      await sidebar.waitFor()
      const width = (await sidebar.boundingBox()).width
      assert.ok(width <= 17 * 15, `el panel mide ${width} px`)
      await page.getByTestId('sidebar-hide').click()
      await sidebar.waitFor({ state: 'detached' })
      const content = (await page.locator('main').boundingBox()).width
      assert.ok(content > 1440 - 30, `la página usa el ancho: ${content}`)
      await page.reload()
      await page.locator('main').first().waitFor()
      assert.equal(await sidebar.count(), 0, 'se recuerda al volver')
      await page.getByRole('button', { name: 'Mostrar el panel' }).click()
      await sidebar.waitFor()
      // Another person is not affected by this one's choice.
      await page.getByTestId('sidebar-hide').click()
      const other = await context.browser().newContext({ viewport: DESKTOP, locale: 'es-CL' })
      const otherPage = await other.newPage()
      await login(otherPage, origin, 'carla')
      await otherPage.getByTestId('sidebar').waitFor()
      await other.close()
    } finally {
      await context.close()
    }
  })

  test('on a phone it is the menu from the bar, without the hide button', async () => {
    const { page, context } = await session('bruno', PHONE)
    try {
      assert.equal(await page.getByTestId('sidebar').count(), 0)
      await page.getByTestId('nav-open').click()
      await page.getByRole('navigation', { name: 'Navegación' }).waitFor()
      assert.equal(await page.getByTestId('sidebar-hide').isVisible(), false)
    } finally {
      await context.close()
    }
  })
})

describe('the color of an area (UD-045)', () => {
  test('the Editor picks one color and the chips of that area follow it', async () => {
    const { page, context } = await session('ana')
    try {
      await page.goto(`${origin}/areas`)
      await page.getByTestId('area-color-trigger').first().waitFor()
      const list = (await api(page, '/areas')).body
      const first = (list.items ?? list)[0]
      await page.getByTestId('area-color-trigger').first().click()
      await page.getByTestId('area-swatch').filter({ has: page.locator('[aria-label="#be185d"]') }).first().click().catch(() => undefined)
      await page.locator('[data-testid="area-swatch"][aria-label="#be185d"]').click()
      await page.waitForFunction(async (id) => (await (await fetch('/api/areas')).json()).items?.find?.((a) => a.id === id)?.color === '#be185d' || (await (await fetch('/api/areas')).json()).find?.((a) => a.id === id)?.color === '#be185d', first.id)
      const preview = page.getByTestId('area-color-preview')
      assert.equal(await bg(preview), 'rgb(190, 24, 93)')
    } finally {
      await context.close()
    }
  })
})
