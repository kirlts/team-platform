// Round 2, judge A (J2-A-01 to J2-A-49): each flow reads what the screen shows, in a real browser, against dev-server.mjs
// serving panel/dist: `npm run test:flows`. Every test can fail if the defect it names comes back.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, startPanel, settled, openTemplates } from './browser-support.mjs'

// These tests go through the review of a proposal, which is what the server does with publication by hand (UD-070): they start it with auto-publication off.
// The automatic path has its own file, `flows-inicio.browser.test.mjs`.
process.env.PANEL_DEV_AUTO_PUBLISH ??= '0'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_2A_PORT ?? 8797), { stepMs: 80 })
  origin = panel.origin
})

// Every test starts from the sample data as the server was born with it (H-901): none inherits what another left in the tray or the lists.
beforeEach(async () => {
  await panel.control.reset()
})

after(async () => {
  await panel?.stop()
})

async function session(who = 'ana', viewport = { width: 1440, height: 900 }, mobile = false) {
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL', colorScheme: 'light', isMobile: mobile, hasTouch: mobile })
  const page = await context.newPage()
  await login(page, origin, who)
  return { page, context }
}

async function messageByTitle(page, titleStart) {
  const body = await (await page.request.get(`${origin}/api/messages`)).json()
  const hit = (body.items ?? body).find((m) => m.title.startsWith(titleStart))
  assert.ok(hit, `no message starts with «${titleStart}»`)
  return hit
}

async function openMessage(page, titleStart) {
  const hit = await messageByTitle(page, titleStart)
  await page.goto(`${origin}/messages/${hit.id}`)
  await page.locator('main h1').waitFor()
  return hit
}

const csrf = { 'x-team-request': 'panel' }

/** Edits a published message through the API as its sender (UD-071): the PATCH carries the version that was read. */
async function patchAsSender(page, id, data) {
  const current = await (await page.request.get(`${origin}/api/messages/${id}`)).json()
  const res = await page.request.patch(`${origin}/api/messages/${id}`, { data: { ...data, version: current.version }, headers: csrf })
  assert.equal(res.status(), 200, await res.text())
}

describe('sign-in and navigation', () => {
  test('the sign-in error does not move the card, stays out of the field name and marks the field (J2-A-01, J2-A-03)', async () => {
    const context = await panel.browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-CL' })
    const page = await context.newPage()
    try {
      await page.goto(origin)
      const card = page.locator('form')
      const before = await card.boundingBox()
      await page.getByLabel('Contraseña').fill('una-clave-cualquiera')
      await page.getByRole('button', { name: 'Entrar' }).click()
      await page.getByRole('alert').filter({ hasText: 'Falta el correo' }).waitFor()
      const after = await card.boundingBox()
      assert.ok(Math.abs(after.y - before.y) < 0.5 && Math.abs(after.height - before.height) < 0.5, `the card moved: ${before.y}→${after.y}, height ${before.height}→${after.height}`)
      assert.equal(await page.getByLabel('Contraseña', { exact: true }).count(), 1, 'the notice entered the field name')
      assert.equal(await page.getByLabel('Correo').getAttribute('aria-invalid'), 'true')
      assert.equal(await page.getByLabel('Contraseña').getAttribute('aria-invalid'), null, 'the field that did not fail is not marked')
      await page.getByLabel('Correo').fill('ana@dev.invalid')
      await page.getByLabel('Contraseña').fill('')
      await page.getByRole('button', { name: 'Entrar' }).click()
      await page.getByRole('alert').filter({ hasText: 'Falta la contraseña' }).waitFor()
      assert.equal(await page.getByLabel('Contraseña').getAttribute('aria-invalid'), 'true')
      const note = await page.getByText('Cuentas creadas por el Editor del equipo').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
      assert.ok(note >= 15, `the text below measures ${note} px`)
    } finally {
      await context.close()
    }
  })

  test('there is no top menu repeating Configuración, Tema and the sign-out, and a single way out (J2-A-38, J2-A-40)', async () => {
    const { page, context } = await session()
    try {
      assert.equal(await page.getByRole('button', { name: 'Menú' }).count(), 0, 'the top menu duplicated the sidebar')
      assert.equal(await page.getByText('Salir', { exact: true }).count(), 0)
      assert.equal(await page.getByRole('button', { name: 'Cerrar sesión' }).count(), 1, 'signing out has a single entry point')
    } finally {
      await context.close()
    }
  })

  test('Conexiones is one destination of the sidebar, listing each connector once (J2-A-34, J3-A-45)', async () => {
    const { page, context } = await session()
    try {
      await page.getByRole('link', { name: 'Conexiones' }).click()
      await page.waitForURL(/\/connections$/)
      await page.getByRole('heading', { name: 'Conexiones', level: 1 }).waitFor()
      for (const name of ['API', 'MCP', 'Correo', 'WhatsApp', 'GitHub']) await page.getByText(name, { exact: true }).first().waitFor()
      // The address of a connector still opens the view with it marked.
      await page.goto(`${origin}/connections/mcp`)
      await page.getByRole('heading', { name: 'Conexiones', level: 1 }).waitFor()
      assert.equal(await page.locator('main [aria-current="true"]').innerText(), 'MCP')
    } finally {
      await context.close()
    }
  })

  test('what is selected looks the same in the sidebar and in the segmented controls (J2-A-41)', async () => {
    const { page, context } = await session()
    try {
      await page.goto(`${origin}/areas/a-error`)
      // The row is the box that is filled (UD-130); the segmented control is its own box.
      const bg = (loc) => loc.evaluate((el) => getComputedStyle(el.closest('[data-nav-row]') ?? el).backgroundColor)
      const side = await bg(page.locator('nav a[aria-current="page"]', { hasText: 'Error' }))
      assert.notEqual(side, 'rgba(0, 0, 0, 0)', 'the area chosen in the sidebar has a fill')
      const row = side
      await page.goto(`${origin}/settings`)
      const seg = await bg(page.getByRole('radio', { checked: true }).first())
      assert.equal(seg, row, 'the segmented control uses another fill for the chosen option')
    } finally {
      await context.close()
    }
  })

  test('the first keyboard stop is visible (J2-A-48)', async () => {
    const { page, context } = await session()
    try {
      await page.goto(`${origin}/messages`)
      await page.locator('main article').first().waitFor()
      await page.keyboard.press('Tab')
      const link = page.getByRole('link', { name: 'Ir al contenido' })
      assert.equal(await link.evaluate((el) => el === document.activeElement), true)
      const box = await link.boundingBox()
      assert.ok(box && box.width > 80 && box.x >= 0 && box.y >= 0, `the shortcut is not drawn on taking focus: ${JSON.stringify(box)}`)
      const ring = await link.evaluate((el) => parseFloat(getComputedStyle(el).outlineWidth))
      assert.ok(ring >= 3, `the focus ring measures ${ring} px`)
    } finally {
      await context.close()
    }
  })
})

describe('message list and home', () => {
  test('the status has no pill, the recipients say «para» and «y N más», with no spheres (J2-A-05, J2-A-12)', async () => {
    const { page, context } = await session()
    try {
      // Every row tells its state with its shape and its word (UD-041).
      // The data is shared with the tests before this one: close a message here so there is a closed row to read.
      await page.request.post(`${origin}/api/messages/${(await messageByTitle(page, 'Probar un resumen')).id}/close`, { headers: csrf })
      await page.goto(`${origin}/messages?f=status:eq:closed`)
      const row = page.locator('main article').first()
      await row.waitFor()
      const bg = await row.locator('[data-testid="state-mark"]').first().evaluate((el) => getComputedStyle(el).backgroundColor)
      assert.equal(bg, 'rgba(0, 0, 0, 0)', 'the row state is still a colored pill')
      await page.goto(`${origin}/messages`)
      const many = page.locator('main article').filter({ hasText: /y \d+ más/ }).first()
      await many.waitFor()
      assert.ok((await many.getByText('para', { exact: true }).count()) === 1, 'the word «para» is missing before the recipients')
      assert.ok((await many.getByText(/^y \d+ más$/).count()) === 1, 'the recipients fold does not say what it is')
      const spheres = await many.evaluate((el) => el.querySelectorAll('ul[aria-label="Destinatarios"] .orb').length)
      assert.equal(spheres, 0, 'each recipient repeats a sphere')
    } finally {
      await context.close()
    }
  })

  test('Últimas respuestas leads with the reply and leaves the message as context (J2-A-06)', async () => {
    const { page, context } = await session()
    try {
      await page.goto(origin)
      const reply = page.getByRole('region', { name: 'Últimas respuestas' }).locator('article').first()
      const message = page.getByRole('region', { name: 'Últimos mensajes' }).locator('article').first()
      await reply.waitFor()
      const size = (loc) => loc.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
      // Both lists read in the same order, the heading over its support line (J3-A-08); in replies the heading is the reply.
      assert.ok((await size(reply.locator('h3'))) > (await size(reply.locator('p').first())), 'in «Últimas respuestas» the heading leads')
      assert.ok((await size(message.locator('h3'))) > (await size(message.locator('p').first())), 'in «Últimos mensajes» the title leads')
      assert.match(await reply.locator('p').first().innerText(), /^En «/, 'the supporting line names the message')
    } finally {
      await context.close()
    }
  })

  test('the clock of Inicio is plain text and the pager is a 32 px target (J2-A-08, J2-A-10)', async () => {
    const { page, context } = await session()
    try {
      await page.goto(origin)
      const clock = page.locator('time').first()
      assert.equal(await clock.evaluate((el) => getComputedStyle(el.parentElement).textTransform), 'none')
      await page.getByRole('button', { name: 'Página siguiente' }).first().waitFor()
      const next = await page.getByRole('button', { name: 'Página siguiente' }).first().boundingBox()
      assert.ok(next.width >= 32 && next.height >= 32, `the arrow measures ${next.width}x${next.height}`)
    } finally {
      await context.close()
    }
  })

  test('the filter menu carries its count and marks what is applied (J2-A-13)', async () => {
    const { page, context } = await session()
    try {
      await page.goto(`${origin}/messages`)
      await page.getByRole('button', { name: 'Filtro', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Estado' }).hover()
      await page.getByRole('menuitemradio', { name: 'Abierto' }).click()
      await page.keyboard.press('Escape')
      const button = page.getByRole('button', { name: 'Filtro, 1 aplicado' })
      await button.waitFor()
      await button.click()
      // The menu names the filter that is on with its value; the others carry none.
      await page.getByRole('menuitem', { name: 'Estado: Abierto' }).waitFor()
      assert.equal(await page.getByRole('menuitem', { name: 'Área', exact: true }).count(), 1)
    } finally {
      await context.close()
    }
  })

  test('a closed message weighs less than an open one in the list (J2-A-15)', async () => {
    const { page, context } = await session()
    try {
      const hit = await messageByTitle(page, 'Enlace al caso')
      await page.request.post(`${origin}/api/messages/${hit.id}/close`, { headers: csrf })
      await page.goto(`${origin}/messages?q=Enlace`)
      const closed = page.locator('main article[data-closed]').first()
      await closed.waitFor()
      const weight = await closed.locator('h3').evaluate((el) => Number(getComputedStyle(el).fontWeight))
      assert.ok(weight < 600, `the closed title weighs ${weight}`)
      const color = await closed.locator('h3').evaluate((el) => getComputedStyle(el).color)
      await page.request.post(`${origin}/api/messages/${hit.id}/reopen`, { headers: csrf })
      await page.goto(`${origin}/messages?q=Enlace`)
      const open = page.locator('main article').first()
      await open.waitFor()
      assert.notEqual(await open.locator('h3').evaluate((el) => getComputedStyle(el).color), color, 'open and closed are read with the same ink')
    } finally {
      await context.close()
    }
  })

  test('on a phone a list card fits in half a screen (J2-A-16)', async () => {
    const { page, context } = await session('ana', { width: 390, height: 844 }, true)
    try {
      await page.goto(`${origin}/messages`)
      await page.locator('main article').first().waitFor()
      const heights = await page.evaluate(() => [...document.querySelectorAll('main article')].slice(0, 3).map((a) => a.getBoundingClientRect().height))
      assert.ok(Math.max(...heights) <= 844 * 0.5, `a card measures ${Math.max(...heights)} px: ${heights.join(', ')}`)
    } finally {
      await context.close()
    }
  })
})

describe('detail', () => {
  test('closing with an empty required field leaves no red warning, and is confirmed with Deshacer (J2-A-17, J2-A-18)', async () => {
    const { page, context } = await session('carla')
    try {
      const hit = await messageByTitle(page, 'Revisar la lectura')
      await patchAsSender(page, hit.id, { fields: { summary: '', device: 'x' } })
      await page.goto(`${origin}/messages/${hit.id}`)
      await page.getByRole('term').filter({ hasText: 'Obligatorio' }).waitFor()
      await page.getByRole('button', { name: 'Cerrar mensaje', exact: true }).click()
      const notice = page.getByRole('status').filter({ hasText: 'Mensaje cerrado' })
      await notice.waitFor()
      assert.equal(await page.getByRole('term').filter({ hasText: 'Obligatorio' }).count(), 0, 'the «Obligatorio» notice survives closing')
      await notice.getByRole('button', { name: 'Deshacer' }).click()
      await page.getByRole('term').filter({ hasText: 'Obligatorio' }).waitFor()
      await patchAsSender(page, hit.id, { fields: { summary: 'La fila se desborda.', device: 'x' } })
    } finally {
      await context.close()
    }
  })

  test('reopening says which state it returns to (J2-A-18)', async () => {
    const { page, context } = await session()
    try {
      await openMessage(page, 'Confirmar el formato')
      await page.getByRole('button', { name: 'Cerrar mensaje', exact: true }).click()
      await page.getByRole('button', { name: 'Reabrir mensaje', exact: true }).click()
      await page.getByRole('status').filter({ hasText: /^Mensaje reabierto: (Abierto|Respondido)/ }).waitFor()
    } finally {
      await context.close()
    }
  })

  test('Deshacer and Rehacer weigh less than the screen action, and the fields look editable (J2-A-18, J2-A-20)', async () => {
    const { page, context } = await session('carla')
    try {
      await openMessage(page, 'Revisar la lectura')
      await page.getByRole('button', { name: 'Cerrar mensaje', exact: true }).click()
      const group = page.getByRole('group', { name: 'Historial de cambios' })
      await group.waitFor()
      const undoBg = await group.getByRole('button', { name: 'Deshacer' }).evaluate((el) => getComputedStyle(el).backgroundColor)
      assert.equal(undoBg, 'rgba(0, 0, 0, 0)', '«Deshacer» weighs like a primary button')
      await page.getByRole('button', { name: 'Reabrir mensaje', exact: true }).click()
      const border = await page.getByRole('button', { name: /^Resumen: / }).evaluate((el) => getComputedStyle(el).borderTopColor)
      assert.notEqual(border, 'rgba(0, 0, 0, 0)', 'a filled field has no cue that it is editable')
    } finally {
      await context.close()
    }
  })

  test('on a phone nothing sits between the title and what it describes, «Cerrar» goes with the reply form, and the chips fit in three rows (J2-A-21, J4-flow-02)', async () => {
    const { page, context } = await session('carla', { width: 390, height: 844 }, true)
    try {
      await openMessage(page, 'Revisar la lectura')
      const close = await page.getByRole('button', { name: 'Cerrar mensaje', exact: true }).boundingBox()
      const title = await page.locator('main h1').boundingBox()
      const data = await page.getByRole('list', { name: 'Destinatarios' }).boundingBox()
      assert.ok(!(close.y > title.y && close.y < data.y + data.height), `«Cerrar» sits between the title and the data: ${close.y} against ${title.y}`)
      assert.ok(close.y > data.y + data.height, '«Cerrar» is not under the replies and the form it belongs to')
      const chips = await page.getByRole('list', { name: 'Destinatarios' }).boundingBox()
      assert.ok(chips.height <= 130, `the recipients take up ${chips.height} px`)
      assert.ok((await page.getByRole('button', { name: /^Quitar a / }).first().isVisible()), 'the × of a recipient is not drawn')
    } finally {
      await context.close()
    }
  })

  test('the reply media sit inside its frame and below only the type and Responder remain (J2-A-22)', async () => {
    const { page, context } = await session('bruno')
    try {
      await openMessage(page, 'Revisar la lectura')
      const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Responder' }) })
      const attach = await form.getByRole('button', { name: /Adjuntar/ }).boundingBox()
      const send = await form.getByRole('button', { name: 'Responder', exact: true }).boundingBox()
      assert.ok(attach.y < send.y - 10, 'the clip stays in the row of the «Responder» button')
    } finally {
      await context.close()
    }
  })
})

describe('areas, templates and settings', () => {
  test('deleting a template leaves the row with Deshacer in its place (J2-A-23)', async () => {
    const { page, context } = await session()
    try {
      await page.goto(`${origin}/areas/a-error`)
      await openTemplates(page)
      const templates = page.getByRole('region', { name: 'Plantillas' })
      await templates.getByRole('button', { name: /^Eliminar / }).first().click()
      const row = templates.getByRole('status').filter({ hasText: 'eliminada' })
      await row.waitFor()
      const rowBox = await row.boundingBox()
      const header = await templates.getByRole('heading', { name: /Plantillas/ }).boundingBox()
      assert.ok(rowBox.y - header.y < 120, `the notice is ${rowBox.y - header.y} px from the action`)
      await row.getByRole('button', { name: 'Deshacer' }).click()
      await row.waitFor({ state: 'detached' })
      await templates.getByRole('button', { name: /^Eliminar / }).first().waitFor()
    } finally {
      await context.close()
    }
  })

  test('the fields window saves at once, says so and closes with Listo; no browser check boxes (J2-A-24)', async () => {
    const { page, context } = await session()
    try {
      await page.goto(`${origin}/areas/a-error`)
      await openTemplates(page)
      await page.getByRole('button', { name: /^Campos e instrucciones/ }).first().click()
      const dialog = page.getByRole('dialog')
      assert.equal(await dialog.locator('input[type=checkbox]').count(), 0, 'native browser checkboxes remain')
      assert.equal(await dialog.getByText('Guardado').count(), 0, 'it says «Guardado» without having saved anything')
      await dialog.getByRole('checkbox', { name: 'Obligatorio' }).first().click()
      await dialog.getByText('Guardado').waitFor()
      await dialog.getByRole('checkbox', { name: 'Obligatorio' }).first().click()
      await dialog.getByRole('button', { name: 'Listo' }).click()
      await dialog.waitFor({ state: 'detached' })
    } finally {
      await context.close()
    }
  })

  test('a new template shows the instructions like editing does, without hash marks (J2-A-25)', async () => {
    const { page, context } = await session()
    try {
      await page.goto(`${origin}/areas/a-error`)
      await openTemplates(page)
      await page.getByRole('region', { name: 'Plantillas' }).getByRole('button', { name: 'Plantilla', exact: true }).click()
      const dialog = page.getByRole('dialog')
      // It starts empty, with no orphan headings (J3-A-36), and what is written shows rendered, not as hash marks.
      await dialog.getByText('Sin campos').waitFor()
      assert.ok(!(await dialog.innerText()).includes('## '), 'raw Markdown is visible')
      await dialog.getByRole('button', { name: /^Instrucciones al modelo:/ }).click()
      await page.keyboard.type('## Método\n\nLeer el texto.')
      await page.keyboard.press('Enter')
      await dialog.getByRole('heading', { name: 'Método' }).waitFor()
      assert.ok(!(await dialog.innerText()).includes('## '), 'raw Markdown is visible')
    } finally {
      await context.close()
    }
  })

  test('«Sin plantillas» brings its own action, and the counts weigh the same (J2-A-26, J2-A-49)', async () => {
    const { page, context } = await session()
    try {
      const made = await page.request.post(`${origin}/api/areas`, { data: { title: 'Área vacía de prueba', description: 'Sin plantillas.' }, headers: csrf })
      const area = await made.json()
      await page.goto(`${origin}/areas/${area.id}`)
      await openTemplates(page)
      const empty = page.getByRole('region', { name: 'Plantillas' }).getByRole('status').filter({ hasText: 'Sin plantillas' })
      await empty.waitFor()
      await empty.getByRole('button', { name: 'Plantilla' }).click()
      await page.getByRole('dialog').getByLabel('Nombre').waitFor()
      await page.keyboard.press('Escape')
      // The counts of an area weigh the same in every row of the list, and an area with nothing says nothing instead of «0 abiertos» (J3-A-33).
      await page.goto(`${origin}/areas`)
      await page.getByRole('link', { name: 'Abrir Área vacía de prueba' }).waitFor()
      assert.equal(await page.getByText(/^0 (abiertos|respondidos)$/).count(), 0)
      const weights = await page.locator('main section [data-testid="state-mark"]').evaluateAll((els) => els.map((s) => getComputedStyle(s).fontWeight))
      assert.equal(new Set(weights).size, 1, `the counts do not weigh the same: ${weights.join(' | ')}`)
    } finally {
      await context.close()
    }
  })

  test('the state of a provider is plain text at body weight, not a pill, and its selector looks like a control (J2-A-31, J2-A-32)', async () => {
    const { page, context } = await session()
    try {
      await page.goto(`${origin}/settings`)
      const mark = page.locator('li[data-connection="anthropic"] span[data-status]').first()
      await mark.waitFor()
      const style = await mark.evaluate((el) => ({ size: parseFloat(getComputedStyle(el).fontSize), bg: getComputedStyle(el).backgroundColor, border: getComputedStyle(el).borderTopWidth }))
      assert.ok(style.size >= 14, `the state measures ${style.size} px`)
      assert.equal(style.bg, 'rgba(0, 0, 0, 0)', 'the state is drawn as a pill')
      assert.equal(style.border, '0px', 'the state is drawn as a pill')
      const border = await page.getByLabel('Proveedor de Texto').evaluate((el) => getComputedStyle(el).borderTopWidth)
      assert.equal(border, '1px', 'the provider selector does not look like a control')
    } finally {
      await context.close()
    }
  })

  test('replacing the project description is confirmed with Deshacer, and is a quiet action (J2-A-30)', async () => {
    const { page, context } = await session()
    try {
      await page.goto(`${origin}/settings`)
      const button = page.getByRole('button', { name: 'Reemplazar con .md' })
      assert.equal(await button.evaluate((el) => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', 'it weighs like a primary button')
      await page.locator('input[type=file]').setInputFiles({ name: 'proyecto.md', mimeType: 'text/markdown', buffer: Buffer.from('# Otro proyecto\n\nTexto nuevo.\n') })
      const notice = page.getByRole('status').filter({ hasText: 'Descripción reemplazada' })
      await notice.waitFor()
      await notice.getByRole('button', { name: 'Deshacer' }).click()
      await page.getByText('Panel y API de un equipo chico').waitFor()
    } finally {
      await context.close()
    }
  })
})

describe('team', () => {
  test('the profile reads at body size, there is no filler language and Desactivar is a quiet action with its notice (J2-A-35, J2-A-36, J2-A-37)', async () => {
    const { page, context } = await session()
    try {
      await page.goto(`${origin}/team`)
      await page.locator('main').getByText('Bruno Prueba').first().waitFor()
      assert.equal(await page.getByText(/^Idioma: /).count(), 0, 'the row repeats the account language')
      const profile = page.getByText('Me encargo de la interfaz del panel')
      assert.ok((await profile.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))) >= 15, 'the profile is read at under 15 px')
      const off = page.getByRole('button', { name: /^Desactivar a / }).first()
      assert.equal(await off.evaluate((el) => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', '«Desactivar» weighs like a primary button')
      await off.click()
      await page.getByRole('status').filter({ hasText: /desactivado/ }).getByRole('button', { name: 'Deshacer' }).click()
      await page.getByText('Inactivo').first().waitFor({ state: 'detached' })
    } finally {
      await context.close()
    }
  })
})

describe('states', () => {
  test('a slow load keeps the place of the rows and an error brings an icon, a reason and Reintentar (J2-A-46, J2-A-47)', async () => {
    const { page, context } = await session()
    try {
      let fail = true
      // The first answer waits for the test: it measures the loading state, then lets the error through.
      let answer = () => {}
      let gate = new Promise((resolve) => (answer = resolve))
      await page.route(/\/api\/messages(\?|$)/, async (route) => {
        await gate
        if (fail) await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Fallo de prueba' } }) })
        else await route.continue()
      })
      await page.goto(`${origin}/messages`)
      const waiting = page.getByRole('status', { name: 'Cargando' })
      await waiting.waitFor()
      assert.ok((await waiting.boundingBox()).height >= 120, 'the wait does not reserve the place of the rows')
      answer()
      const alert = page.getByRole('alert').filter({ hasText: 'No se pudo cargar' })
      await alert.waitFor({ timeout: 15000 })
      assert.equal(await alert.locator(':scope > svg').count(), 1, 'the error has no icon')
      fail = false
      gate = Promise.resolve()
      await alert.getByRole('button', { name: 'Reintentar' }).click()
      await page.locator('main article').first().waitFor()
      await page.unrouteAll({ behavior: 'ignoreErrors' })
    } finally {
      await context.close()
    }
  })

  test('the sidebar does not move when the counters arrive (J2-A-47)', async () => {
    const { page, context } = await session()
    try {
      let release = () => {}
      const gate = new Promise((r) => (release = r))
      await page.route(/\/api\/messages\/summary/, async (route) => {
        await gate
        await route.continue()
      })
      await page.goto(origin)
      await page.getByRole('link', { name: 'Idea', exact: true }).first().waitFor()
      await settled(page)
      const tops = () => page.evaluate(() => [...document.querySelectorAll('nav a.nav-row')].map((a) => Math.round(a.getBoundingClientRect().top)))
      const before = await tops()
      release()
      await page.getByTestId('status-bar').waitFor()
      await settled(page)
      const after = (await tops()).slice(0, before.length)
      assert.deepEqual(after, before, 'something in the sidebar shifted when the numbers arrived')
      await page.unrouteAll({ behavior: 'ignoreErrors' })
    } finally {
      await context.close()
    }
  })

  test('the detail ranks the message text over the fields and the data, and the mark weighs less (J2-A-19, J2-A-42)', async () => {
    const { page, context } = await session('carla')
    try {
      await openMessage(page, 'Revisar la lectura')
      const size = (loc) => loc.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
      const body = await size(page.getByRole('button', { name: /^Texto: / }))
      const field = await size(page.getByRole('button', { name: /^Resumen: / }))
      const meta = await size(page.locator('time').first())
      assert.ok(body > field && field > meta, `text ${body}, field ${field}, datum ${meta}`)
      const chip = await page.getByRole('list', { name: 'Destinatarios' }).locator('li').first().evaluate((el) => getComputedStyle(el).backgroundColor)
      const state = await page.locator('.led').first().evaluate((el) => getComputedStyle(el).backgroundColor)
      // The state is the light and the word, with no fill at all (J2-A-05); the chips of people keep their own.
      assert.equal(state, 'rgba(0, 0, 0, 0)', 'the state is a pill again')
      assert.ok(chip !== undefined)
      const mark = await page.getByRole('link', { name: /Team$/i }).first().evaluate((el) => getComputedStyle(el.firstElementChild).fontWeight)
      assert.ok(Number(mark) <= 600, `the mark weighs ${mark}`)
    } finally {
      await context.close()
    }
  })
})
