// The flows that UD-016, UD-017 and UD-018 promise, run in a real browser (Playwright, headless) against
// dev-server.mjs serving panel/dist: `npm run test:flows`. Each flow does what a person does and reads
// what the screen shows, not the DOM of a component.
//
//   - editing in place: a click opens the text, Enter or a click outside saves, Escape cancels; Undo and
//     Redo (the buttons and Ctrl+Z) take the change back and forward;
//   - a proposed message whose area changes keeps the fields that match, shows the new ones empty and
//     publishes once they are filled in; a removed message moves its units to «Sin acción»;
//   - a failed analysis offers «Reintentar» and keeps the text;
//   - a reply carries media and shows one icon per kind;
//   - the Editor adds, deactivates and reactivates a member;
//   - the password changes from Configuración;
//   - the language switches the whole interface at once;
//   - the compose bar shows an upload rejection inline.

import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, startPanel, settled, openTemplates } from './browser-support.mjs'

// These tests go through the review of a proposal, which is what the server does with publication by hand (UD-070): they start it with auto-publication off.
// The automatic path has its own file, `flows-inicio.browser.test.mjs`.
process.env.PANEL_DEV_AUTO_PUBLISH ??= '0'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_PORT ?? 8796), { stepMs: 80 })
  origin = panel.origin
})

// Every test starts from the sample data as the server was born with it (H-901): none inherits what another left in the tray or the lists.
beforeEach(async () => {
  await panel.control.reset()
})

after(async () => {
  await panel?.stop()
})

async function session(who = 'ana', viewport = { width: 1440, height: 900 }) {
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL', colorScheme: 'light' })
  const page = await context.newPage()
  await login(page, origin, who)
  return { page, context }
}

/** Opens a message of the dev data by the start of its title. */
async function openMessage(page, titleStart) {
  const body = await (await page.request.get(`${origin}/api/messages`)).json()
  const hit = (body.items ?? body).find((m) => m.title.startsWith(titleStart))
  assert.ok(hit, `no message starts with «${titleStart}»`)
  await page.goto(`${origin}/messages/${hit.id}`)
  await page.locator('main h1').waitFor()
  return hit
}

const TEXT = 'Corregir el desalineado del sidebar en la vista dashboard.\n\nAgregar la sincronización con WhatsApp en el sidebar.\n\nPregunta: ¿el audio máximo sigue en 25 MB?\n\nSaludos al equipo.'

/** Sends a text from the bar and checks that the bar is empty and ready right away (UD-025). */
async function sendInput(page, text = TEXT) {
  await page.goto(origin)
  const bar = page.getByLabel('Nuevo mensaje', { exact: true }).last()
  await bar.fill(text)
  await page.getByRole('button', { name: 'Enviar' }).first().click()
  assert.equal(await bar.inputValue(), '', 'the bar empties on send, without waiting for the analysis')
  // The drawer under the bar opens by itself with what was sent (UD-046): no click is needed to see it.
}

/** Pages forward until the text shows (lists paginate inside their frame). */
async function showRow(page, text) {
  await settled(page)
  for (let i = 0; i < 20; i++) {
    if (await page.getByText(text).first().isVisible().catch(() => false)) return
    const next = page.getByRole('button', { name: 'Página siguiente' }).first()
    // A list that fits the window has no pager at all.
    if ((await next.count()) === 0 || !(await next.isEnabled())) break
    await next.click()
    await settled(page)
  }
  await page.getByText(text).first().waitFor({ timeout: 2000 })
}

/** The proposed messages start folded (UD-257): the first one is opened, as a person does before reading or editing it. */
async function openFirst(page, timeout = 20000) {
  await page.getByRole('button', { name: /^Abrir el mensaje 1:/ }).click({ timeout })
  await page.getByRole('button', { name: /^Área:/ }).first().waitFor()
}

describe('in-place editing', () => {
  test('click opens, Enter saves, Escape cancels, and «Deshacer» and «Rehacer» step through it', async () => {
    const { page, context } = await session('diego')
    try {
      await openMessage(page, 'Agregar exportación')
      const title = page.getByRole('button', { name: /^Título: Agregar exportación/ })
      const before = await title.boundingBox()
      await title.click()
      const field = page.getByRole('textbox', { name: 'Título' })
      const editing = await field.boundingBox()
      // The same box and the same height: nothing jumps when editing starts.
      assert.ok(Math.abs(editing.y - before.y) <= 1 && Math.abs(editing.height - before.height) <= 2, `jump when editing: ${JSON.stringify({ before, editing })}`)
      await field.fill('Agregar la exportación de mensajes cerrados a CSV')
      await field.press('Enter')
      await page.getByRole('button', { name: /^Título: Agregar la exportación de mensajes cerrados a CSV/ }).waitFor()

      // Escape discards.
      await page.getByRole('button', { name: /^Título: Agregar la exportación/ }).click()
      await page.getByRole('textbox', { name: 'Título' }).fill('Otro título que no se guarda')
      await page.getByRole('textbox', { name: 'Título' }).press('Escape')
      await page.getByRole('button', { name: /^Título: Agregar la exportación de mensajes cerrados a CSV/ }).waitFor()

      // «Deshacer» and «Rehacer» with the buttons.
      const undo = page.getByRole('button', { name: 'Deshacer' })
      const redo = page.getByRole('button', { name: 'Rehacer' })
      assert.equal(await redo.isDisabled(), true, '«Rehacer» must be disabled with nothing to redo')
      await undo.click()
      await page.getByRole('button', { name: /^Título: Agregar exportación de mensajes cerrados$/ }).waitFor()
      assert.equal(await undo.isDisabled(), true, '«Deshacer» must be disabled with nothing left to undo')
      await redo.click()
      await page.getByRole('button', { name: /^Título: Agregar la exportación de mensajes cerrados a CSV/ }).waitFor()

      // Ctrl+Z and Ctrl+Shift+Z with the focus outside a field.
      await page.getByRole('link', { name: 'Mensajes' }).first().focus()
      await page.keyboard.press('Control+z')
      await page.getByRole('button', { name: /^Título: Agregar exportación de mensajes cerrados$/ }).waitFor()
      await page.keyboard.press('Control+Shift+z')
      await page.getByRole('button', { name: /^Título: Agregar la exportación de mensajes cerrados a CSV/ }).waitFor()

      // What was saved survives a reload; the stack does not.
      await page.reload()
      await page.getByRole('button', { name: /^Título: Agregar la exportación de mensajes cerrados a CSV/ }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Deshacer' }).count(), 0, 'the stack lives in memory: it is lost on reload and Deshacer is not drawn with nothing to undo')
    } finally {
      await context.close()
    }
  })
})

describe('analysis proposal', () => {
  test('changing the area keeps the fields that match and the proposal is published', async () => {
    const { page, context } = await session()
    try {
      await sendInput(page, 'Podríamos probar un resumen semanal por área.\n\nAgregar la sincronización con WhatsApp en el sidebar.')
      await openFirst(page, 20000)
      const first = page.getByRole('button', { name: /^Área:/ }).first()
      // One of the areas whose template has the most required fields.
      await first.click()
      await page.getByRole('menuitemradio', { name: 'Error', exact: true }).click()
      await page.getByRole('button', { name: /^Pasos para reproducir: Obligatorio/ }).first().waitFor()
      const send = page.getByRole('button', { name: /^Enviar \d+ mensajes?$/ })
      assert.equal(await send.isDisabled(), true, 'it cannot be sent with required fields empty')
      // They are filled in place.
      for (const label of ['Pasos para reproducir', 'Qué se esperaba', 'Qué pasó']) {
        await page.getByRole('button', { name: new RegExp(`^${label}: Obligatorio`) }).first().click()
        await page.getByRole('textbox', { name: label }).first().fill('Abrir Inicio y mirar la barra')
        await page.getByRole('textbox', { name: label }).first().press('Enter')
      }
      await page.getByRole('button', { name: 'Deshacer' }).waitFor()
      await send.click()
      // Publishing says what happened: what went out, how many and where to see it (J1-B-25).
      const notice = page.locator('[data-notice]')
      await notice.getByText(/^2 mensajes publicados/).waitFor({ timeout: 10000 })
      await notice.getByRole('link', { name: 'Ver mensajes' }).waitFor()
      // The send stays in the drawer, now as published (UD-070): the proposal's review is gone and its messages are the published ones.
      await page.getByTestId('published-pane').waitFor({ timeout: 10000 })
      assert.equal(await page.getByRole('button', { name: /^Enviar \d+ mensajes?$/ }).count(), 0)
    } finally {
      await context.close()
    }
  })

  test('removing a message sends its units to «Sin mensaje» and Deshacer brings them back', async () => {
    const { page, context } = await session('bruno')
    try {
      await sendInput(page, 'Primera idea para el equipo.\n\nSegunda idea para el equipo.')
      await openFirst(page, 20000)
      assert.equal(await page.getByRole('button', { name: /^Partes sin mensaje/ }).count(), 0)
      await page.getByRole('button', { name: /^Quitar el mensaje/ }).first().click()
      await page.getByRole('button', { name: /^Partes sin mensaje/ }).waitFor()
      await page.locator('[data-notice]').getByText(/^Mensaje quitado/).waitFor()
      await page.getByRole('group', { name: 'Historial de cambios' }).getByRole('button', { name: 'Deshacer' }).click()
      await page.getByRole('button', { name: /^Partes sin mensaje/ }).waitFor({ state: 'detached' })
      // What was edited survives a reload: the draft is on the server. The message came back folded, like every other (UD-257).
      await openFirst(page)
      await page.getByRole('button', { name: /^Título del mensaje: Primera idea/ }).click()
      await page.getByRole('textbox', { name: 'Título del mensaje' }).fill('Primera idea, ya corregida')
      await page.getByRole('textbox', { name: 'Título del mensaje' }).press('Enter')
      await page.getByRole('button', { name: /^Título del mensaje: Primera idea, ya corregida/ }).waitFor()
      await page.reload()
      await page.getByTestId('tray-control').click() // after a reload the drawer is folded
      await page.getByRole('button', { name: 'Abrir el mensaje 1: Primera idea, ya corregida' }).click()
      await page.getByRole('button', { name: /^Título del mensaje: Primera idea, ya corregida/ }).waitFor()
    } finally {
      await context.close()
    }
  })

  test('a failed analysis offers «Reintentar» and keeps the text', async () => {
    const { page, context } = await session()
    try {
      await sendInput(page, 'Texto que no se debe perder [simular falla]')
      await page.getByRole('alert').filter({ hasText: 'servicio de análisis' }).waitFor({ timeout: 20000 })
      await page.getByText('Texto que no se debe perder', { exact: false }).first().waitFor()
      // The text stays in the send; the failure does not add a line that reassures.
      assert.equal(await page.getByText('Texto y adjuntos del envío conservados').count(), 0)
      await page.getByRole('button', { name: 'Reintentar' }).first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
      assert.equal(await page.getByRole('button', { name: 'Reintentar' }).count(), 1)
      await page.getByRole('button', { name: 'Reintentar' }).first().click()
      await openFirst(page, 20000)
    } finally {
      await context.close()
    }
  })

  test('a file rejected before queueing is explained under the bar', async () => {
    const { page, context } = await session('diego')
    try {
      await page.goto(origin)
      await page.locator('input[type=file]:not([capture])').setInputFiles([{ name: 'foto-demasiado-grande.png', mimeType: 'image/png', buffer: Buffer.alloc(32) }])
      await page.getByRole('button', { name: 'Enviar' }).first().click()
      await page.getByRole('alert').filter({ hasText: 'La foto supera el tamaño máximo' }).first().waitFor()
      // The drawer already shows the send; it keeps the submission so it can be retried and the bar is left free.
      await page.getByRole('button', { name: 'Reintentar' }).first().waitFor()
      assert.equal(await page.getByLabel('Nuevo mensaje', { exact: true }).last().inputValue(), '')
    } finally {
      await context.close()
    }
  })
})

describe('replies with media', () => {
  test('a reply with a file shows its media icon', async () => {
    const { page, context } = await session('bruno')
    try {
      await openMessage(page, 'Probar un resumen semanal')
      await page.getByLabel('Respuesta', { exact: true }).fill('Adjunto el borrador')
      await page.locator('input[type=file]:not([capture])').setInputFiles([{ name: 'borrador.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF') }])
      await page.getByRole('button', { name: 'Responder', exact: true }).click()
      const row = page.getByRole('article').filter({ hasText: 'Adjunto el borrador' })
      // The tile of the file is the reply's media: one row of attachments, with the kind drawn in it (J3-A-25); a PDF is a link that opens in its own tab (0f7a4b7).
      await row.getByRole('list', { name: 'Adjuntos' }).getByRole('link', { name: 'Abrir borrador.pdf' }).waitFor()
    } finally {
      await context.close()
    }
  })
})

describe('team and account', () => {
  test('the Editor adds, deactivates and reactivates with «Deshacer»', async () => {
    const { page, context } = await session()
    try {
      await page.goto(`${origin}/team`)
      await page.getByRole('button', { name: 'Agregar miembro' }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByLabel('Nombre').fill('Marta Nueva')
      await dialog.getByLabel('Correo').fill('marta@dev.invalid')
      await dialog.getByRole('button', { name: 'Crear' }).click()
      await showRow(page, 'Marta Nueva')
      await page.getByRole('button', { name: 'Acciones de Marta Nueva' }).click()
      await page.getByRole('menuitem', { name: 'Desactivar a Marta Nueva' }).click()
      await page.getByText('Inactivo').first().waitFor()
      // J2-A-18: the change is said under the bar and brings its Deshacer.
      const notice = page.getByRole('status').filter({ hasText: 'Marta Nueva desactivado' })
      await notice.waitFor()
      await notice.getByRole('button', { name: 'Deshacer' }).click()
      await page.getByText('Inactivo').first().waitFor({ state: 'detached' })
    } finally {
      await context.close()
    }
  })

  test('the password is changed with the current one', async () => {
    const { page, context } = await session('carla')
    try {
      await page.goto(`${origin}/settings`)
      await page.getByRole('button', { name: 'Cambiar contraseña' }).click()
      await page.getByLabel('Contraseña actual').fill('0123456789abcdef0')
      await page.getByLabel('Contraseña nueva').fill('abcdef01234567890')
      await page.getByRole('button', { name: 'Guardar' }).click()
      await page.getByRole('dialog').waitFor({ state: 'detached' })
    } finally {
      await context.close()
    }
  })

  test('the language changes the whole interface at once', async () => {
    const { page, context } = await session()
    try {
      await page.goto(`${origin}/settings`)
      await page.getByRole('button', { name: /^Idioma:/ }).click()
      await page.getByRole('menuitemradio', { name: 'English' }).click()
      await page.getByRole('heading', { name: 'Settings', level: 1 }).waitFor()
      await page.getByRole('link', { name: 'Home' }).waitFor()
      await page.getByRole('button', { name: /^Language:/ }).waitFor()
      assert.equal(await page.evaluate(() => document.documentElement.lang), 'en')
      await page.getByRole('button', { name: /^Language:/ }).click()
      await page.getByRole('menuitemradio', { name: 'Español (Latinoamérica)' }).click()
      await page.getByRole('heading', { name: 'Configuración', level: 1 }).waitFor()
    } finally {
      await context.close()
    }
  })
})

describe('consecutive inputs (UD-025)', () => {
  test('ten consecutive inputs do not change the height, arrive one at a time and are reviewed with the keyboard', async () => {
    const { page, context } = await session('tomas')
    try {
      await page.goto(origin)
      const bar = page.getByLabel('Nuevo mensaje', { exact: true }).last()
      const send = async (i) => {
        await bar.fill(`Envío ${i}: revisar el punto ${i} del panel y avisar al equipo.`)
        await page.getByRole('button', { name: 'Enviar' }).first().click()
        assert.equal(await bar.inputValue(), '', `the bar must be empty after sending input ${i}`)
      }
      const heights = () => page.evaluate(() => ({ doc: document.scrollingElement.scrollHeight, main: document.querySelector('main').scrollHeight, win: innerHeight }))
      const tray = page.getByTestId('tray-control')
      await send(1)
      await tray.waitFor()
      await settled(page)
      const base = await heights()
      const baseFrame = (await tray.boundingBox()).height
      const barY = (await bar.boundingBox()).y
      for (let i = 2; i <= 10; i++) await send(i)
      // They finish staggered: the folded header counts all ten once they are ready for review.
      await tray.getByText('10 para revisar').waitFor({ timeout: 40000 })
      await settled(page)
      // UD-110: with a send open the region scrolls and the drawer is as tall as what it shows, so the region's height may grow; the document does not, and the bar does not move.
      assert.equal((await heights()).doc, base.doc, 'ten submissions must not change the document height')
      assert.equal((await bar.boundingBox()).y, barY, 'ten submissions do not move the text bar')
      assert.ok(Math.abs((await tray.boundingBox()).height - baseFrame) <= 1, 'the submissions control keeps its height')

      // Keyboard inside the drawer: J moves to the next send of the list (an older one: the list is newest first) and K to the previous one. Enter publishes from nowhere (J2-B-13): a click on Enviar or Enter with the focus on that button does, and the send stays in view, published.
      await page.getByTestId('send-drawer').waitFor()
      // The focus is in the bar after a send, ready for the next one: the keys of the list work once it is out of a field.
      await page.getByTestId('send-drawer').click({ position: { x: 2, y: 2 } })
      const selected = () => page.locator('[role="option"][aria-selected="true"]').first().getAttribute('aria-label')
      const first = await selected()
      // The drawer opens on the most recent send: J goes to an older one and K comes back.
      await page.keyboard.press('j')
      await page.waitForFunction((prev) => document.querySelector('[role="option"][aria-selected="true"]')?.getAttribute('aria-label') !== prev, first)
      await page.keyboard.press('k')
      await page.waitForFunction((prev) => document.querySelector('[role="option"][aria-selected="true"]')?.getAttribute('aria-label') === prev, first)
      await page.keyboard.press('Enter')
      await settled(page)
      await tray.getByText('10 para revisar').waitFor()
      await page.getByRole('button', { name: /^Enviar \d+ mensajes?$/ }).focus()
      await page.keyboard.press('Enter')
      await tray.getByText('9 para revisar').waitFor()
      await page.getByTestId('published-pane').waitFor()
      assert.equal(await selected(), first, 'on publishing, the submission stays in view, published')
    } finally {
      await context.close()
    }
  })
})

// ---------------------------------------------------------------- UD-028, UD-029, UD-030, UD-041: Home, the badge and the states
const STATE_WORD = { open: 'abierto', answered: 'respondido', closed: 'cerrado' }

/** The fill each state has, read from a probe element in the page: the reference every badge is compared with. */
const probeFills = (page, weight) =>
  page.evaluate((w) => {
    const out = {}
    for (const status of ['open', 'answered', 'closed']) {
      const probe = document.createElement('span')
      probe.setAttribute('data-status', status)
      if (w) probe.setAttribute('data-weight', w)
      document.body.append(probe)
      out[status] = getComputedStyle(probe).backgroundColor
      probe.remove()
    }
    return out
  }, weight)

/** Replaces GET /api/messages/summary with the given counts, to draw every combination without touching the data. */
async function withSummary(page, mine, areas = []) {
  const items = ['open', 'answered'].flatMap((status) => Array.from({ length: mine[status] }, (_, i) => ({ message_id: `${status}-${i}`, title: `Mensaje ${status} ${i}`, status, at: '2026-10-21T10:00:00.000Z' })))
  await page.route(/\/api\/messages\/summary$/, (route) => route.fulfill({ json: { mine: { ...mine, total: mine.open + mine.answered }, items, areas } }))
}

describe('the top bar: states and areas (UD-028, UD-029, UD-041, UD-100)', () => {
  const STATE_WORDS = /abiertos?|respondidos?|cerrados?/i

  test('each state is its shape and its number with no visible word, its color is the shape and not a fill, in all four combinations and both themes (UD-036, UD-041, UD-100)', async () => {
    for (const scheme of ['light', 'dark']) {
      for (let bits = 0; bits < 4; bits++) {
        const mine = { open: bits & 1 ? 2 : 0, answered: bits & 2 ? 3 : 0 }
        const context = await panel.browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-CL', colorScheme: scheme })
        const page = await context.newPage()
        try {
          await withSummary(page, mine)
          await login(page, origin, 'ana')
          await page.getByTestId('status-bar').waitFor()
          const fills = await probeFills(page)
          assert.equal(new Set(Object.values(fills)).size, 3, 'the three states have different fills')
          const bar = page.getByTestId('status-bar')
          // The three states are always there (UD-100); closed ones are counted from the data, the other two from the mocked summary.
          await bar.locator('[data-testid="state-button"]').first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
          assert.equal(await bar.locator('[data-testid="state-button"]').count(), 3, 'three marks, one per state')
          for (const status of ['open', 'answered', 'closed']) {
            const mark = bar.locator(`[data-testid="state-button"][data-status="${status}"]`)
            await mark.waitFor()
            // Quiet (UD-036): no tinted fill; the state is the color of the shape.
            assert.equal(await mark.evaluate((el) => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', `una marca callada no se rellena (${scheme})`)
            const shape = await mark.locator('svg').first().evaluate((el) => getComputedStyle(el).color)
            assert.equal(shape, await page.evaluate((t) => { const p = document.createElement('i'); p.setAttribute('data-status', t); p.setAttribute('data-weight', 'quiet'); const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); p.append(s); document.body.append(p); const c = getComputedStyle(s).color; p.remove(); return c }, status), `la forma lleva el color de ${status} (${scheme})`)
            // The word is not drawn: the mark is a shape and a number, and says its state by name and by tooltip.
            assert.match((await mark.textContent()).trim(), /^\d+$/)
            const shown = (await mark.textContent()).trim()
            if (status !== 'closed') assert.equal(shown, String(mine[status]))
            const name = await mark.getAttribute('aria-label')
            assert.match(name, new RegExp(`^${shown} ${STATE_WORD[status]}s? para mí$`))
            assert.equal(await mark.getAttribute('title'), name, 'the tooltip says the same as the accessible name')
          }
          assert.doesNotMatch(await bar.innerText(), STATE_WORDS, `la barra no escribe el nombre de un estado (${scheme}, ${JSON.stringify(mine)})`)
          // The bell does not repeat the count and carries no state (UD-100): there is no saturated state fill anywhere.
          const bell = page.getByTestId('bell')
          assert.equal(await bell.getAttribute('data-status'), null, 'la campana no lleva estado')
          assert.equal((await bell.textContent()).trim(), '', 'the bell does not repeat the count')
          const weights = await page.evaluate(() => [...document.querySelectorAll('[data-status]')].map((el) => el.getAttribute('data-weight') ?? 'solid'))
          assert.equal(weights.filter((w) => w === 'solid').length, 0, `ningún relleno saturado de estado (${scheme}, ${JSON.stringify(mine)})`)
        } finally {
          await context.close()
        }
      }
    }
  })

  test('real data: the marks count what the server says, the sidebar and the Home do not repeat it', async () => {
    const { page, context } = await session('ana')
    try {
      const summary = await (await page.request.get(`${origin}/api/messages/summary`)).json()
      assert.ok(summary.mine.open > 0 && summary.mine.answered > 0, 'the development data has open and answered messages for Ana')
      const bar = page.getByTestId('status-bar')
      // The marks are drawn when the summary reaches the page: waited for as an element, not counted at the first instant after the shell opened.
      await bar.locator('[data-testid="state-button"][data-status="closed"]').waitFor()
      await bar.locator('[data-testid="state-button"][data-status="closed"]').first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
      assert.equal(await bar.locator('[data-testid="state-button"][data-status="closed"]').count(), 1, 'the closed state has its mark too')
      for (const [status, n] of [['open', summary.mine.open], ['answered', summary.mine.answered]]) {
        const mark = bar.locator(`[data-testid="state-button"][data-status="${status}"]`)
        await mark.waitFor()
        assert.equal((await mark.textContent()).trim(), String(n))
      }
      // One source (UD-100): the Mensajes link has no figure of its own and Inicio has no strip of them; the counts of each area stay in the sidebar.
      assert.equal(await page.getByTestId('messages-badge').count(), 0)
      assert.equal(await page.getByTestId('attention').count(), 0)
      // The bar is in every page.
      for (const path of ['/messages', '/areas', '/team', '/settings']) {
        await page.goto(`${origin}${path}`)
        await page.getByTestId('status-bar').waitFor()
      }
    } finally {
      await context.close()
    }
  })

  test('a closed message loses its notice and leaves the counts and the menus, and keeps its color as a state (J2-A-09, UD-041)', async () => {
    const { page, context } = await session('bruno')
    try {
      await page.getByRole('heading', { name: 'Últimos mensajes' }).waitFor()
      const before = (await (await page.request.get(`${origin}/api/messages/summary`)).json()).mine.total
      const first = page.locator('article[data-affects-me]').first()
      await first.waitFor()
      const title = await first.getByRole('heading').innerText()
      await first.hover()
      await first.getByRole('button', { name: 'Cerrar' }).click()
      await page.locator('article', { hasText: title }).first().getByText('Cerrado', { exact: true }).waitFor()
      for (const row of await page.locator('article', { hasText: 'Cerrado' }).all()) {
        assert.equal(await row.getAttribute('data-affects-me'), null, 'un cerrado no afecta a nadie')
        assert.equal(await row.locator('[data-testid="state-mark"]').getAttribute('data-status'), 'closed')
        assert.notEqual(await row.evaluate((el) => getComputedStyle(el).boxShadow), 'none', 'the border carries the color of the closed state')
      }
      await settled(page)
      const after = (await (await page.request.get(`${origin}/api/messages/summary`)).json()).mine.total
      assert.ok(after < before, `el conteo baja (${before} → ${after})`)
      let listed = 0
      for (const mark of await page.locator('[data-testid="state-button"][data-status="open"], [data-testid="state-button"][data-status="answered"]').all()) {
        await mark.click()
        await page.getByTestId('status-menu').waitFor()
        // The list is read when the pointer reaches the mark (or when the menu opens): the rows are counted once it has arrived.
        await page.waitForFunction(() => !document.querySelector('[data-testid="status-menu"]')?.textContent?.includes('Cargando'))
        const texts = await page.locator('[data-testid="status-row"]').allInnerTexts()
        listed += texts.length
        assert.ok(!texts.some((t) => t.includes(title)), 'the dropdown no longer lists the closed message')
        await page.keyboard.press('Escape')
      }
      assert.equal(listed, after, 'the dropdowns list exactly what the bar counts')
      await page.locator('[data-testid="state-button"][data-status="closed"]').click()
      await page.locator('[data-testid="status-row"]').first().waitFor()
      assert.ok((await page.locator('[data-testid="status-row"]').allInnerTexts()).some((t) => t.includes(title)), 'the closed message appears in the closed dropdown')
      await page.keyboard.press('Escape')
      assert.equal(await page.getByTestId('state-button').first().evaluate((el) => !!el.closest('[data-testid="status-bar"]')), true)
    } finally {
      await context.close()
    }
  })

  test('the top bar has no count per area, in any page and size; the counts of each area stay in the sidebar (UD-100)', async () => {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const { page, context } = await session('ana', viewport)
      try {
        for (const path of ['/', '/messages', '/areas', '/areas/a-error', '/team']) {
          await page.goto(`${origin}${path}`)
          await page.getByTestId('status-bar').waitFor()
          await settled(page)
          const bar = page.getByTestId('status-bar')
          assert.equal(await bar.locator('[data-testid="area-pending"], [data-testid="area-chip"], [data-area-id], [data-testid="area-more"]').count(), 0, `${path} (${viewport.width}): contador por área en la barra`)
          await bar.locator('button:visible').first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
          assert.equal(await bar.locator('button:visible').count(), 3, `${path} (${viewport.width}): la barra son tres marcas, también en el teléfono, y nada más`)
          assert.doesNotMatch(await bar.innerText(), /abiertos?|respondidos?|cerrados?/i, `${path}: texto de estado visible`)
          assert.equal(await page.locator('header [data-testid="area-pending"], header [data-area-id]').count(), 0)
        }
      } finally {
        await context.close()
      }
    }
    const { page, context } = await session('ana')
    try {
      const side = page.getByRole('navigation', { name: 'Navegación' })
      await side.getByRole('link', { name: 'Error', exact: true }).waitFor()
      await side.locator('[aria-label^="Error:"]').first().waitFor()
    } finally {
      await context.close()
    }
  })

  test('every mark opens its menu by click and by keyboard without leaving the page, the menu lists what the number counts, the arrows walk the rows and Escape gives the focus back (UD-100)', async () => {
    const { page, context } = await session('ana')
    try {
      await page.getByTestId('status-bar').waitFor()
      await settled(page)
      const here = page.url()
      const marks = await page.locator('[data-testid="status-bar"] [data-testid="state-button"]').count()
      assert.equal(marks, 3, 'the three marks')
      for (let i = 0; i < marks; i++) {
        const mark = page.locator('[data-testid="status-bar"] [data-testid="state-button"]').nth(i)
        const expected = Number((await mark.textContent()).trim())
        for (const how of ['click', 'keyboard']) {
          if (how === 'click') await mark.click()
          else {
            await mark.focus()
            await page.keyboard.press(how === 'keyboard' && i % 2 ? 'Space' : 'Enter')
          }
          await page.getByTestId('status-menu').waitFor()
          await page.locator('[data-lane="status-list"]').or(page.getByText('Sin mensajes')).first().waitFor()
          assert.equal(await page.locator('[data-testid="status-row"]').count(), expected, `la marca ${i} (${await mark.getAttribute('aria-label')}) lista lo que cuenta (${how})`)
          assert.equal(page.url(), here, 'abrir no navega')
          if (how === 'keyboard' && expected > 0) {
            await page.keyboard.press('ArrowDown')
            const walked = await page.evaluate(() => document.activeElement?.closest('[data-lane="status-list"]') !== null && document.activeElement?.tagName === 'A')
            assert.equal(walked, true, 'the arrows walk the rows')
          }
          await page.keyboard.press('Escape')
          await page.getByTestId('status-menu').waitFor({ state: 'detached' })
          await page.waitForFunction((el) => el === document.activeElement, await mark.elementHandle(), { timeout: 3000 }).catch(() => {})
          assert.equal(await mark.evaluate((el) => el === document.activeElement), true, `Escape devuelve el foco a la marca (${how})`)
        }
      }
      // A row opens its message.
      await page.getByTestId('state-button').first().click()
      const row = page.locator('[data-testid="status-row"] a').first()
      await row.waitFor()
      const href = await row.getAttribute('href')
      await row.click()
      await page.waitForURL(new RegExp(`${href}$`))
    } finally {
      await context.close()
    }
  })

  test('the bar never writes the name of a state, in any page, and the guard covers the accessible names (UD-100)', async () => {
    const { page, context } = await session('ana')
    try {
      for (const path of ['/', '/messages', '/areas', '/team']) {
        await page.goto(`${origin}${path}`)
        await page.getByTestId('status-bar').waitFor()
        await settled(page)
        assert.doesNotMatch(await page.getByTestId('status-bar').innerText(), STATE_WORDS, `${path}: texto visible de la barra`)
        // Every mark has a name, and the name is the word of the state (or the area with its words): color is never alone.
        for (const mark of await page.locator('[data-testid="status-bar"] button').all()) {
          assert.ok((await mark.getAttribute('aria-label'))?.trim(), `${path}: una marca sin nombre accesible`)
        }
      }
    } finally {
      await context.close()
    }
  })
})

describe('Inicio (UD-030)', () => {
  test('with a send in progress the drawer opens by itself under the bar, the control carries its status, and folding it gives the lists their room back (UD-046)', async () => {
    const { page, context } = await session('ana')
    try {
      await page.getByRole('heading', { name: 'Últimos mensajes' }).waitFor()
      await page.getByLabel('Nuevo mensaje', { exact: true }).last().fill('Revisar el contraste del botón Enviar en el tema oscuro.')
      await page.getByRole('button', { name: 'Enviar' }).first().click()
      const control = page.getByTestId('tray-control')
      await control.waitFor()
      await control.getByText('para revisar').waitFor({ timeout: 20000 })
      assert.equal(await page.getByRole('dialog').count(), 0, 'nothing opens over the page')
      const drawer = page.getByTestId('send-drawer')
      await drawer.waitFor()
      assert.equal(await control.getAttribute('aria-expanded'), 'true')
      // Folded, the two lists are the main part of the page again: each one is at least a third of its height.
      await control.click()
      await drawer.waitFor({ state: 'detached' })
      await settled(page)
      assert.equal(await page.getByRole('heading', { name: 'Últimos mensajes' }).isVisible(), true)
      assert.equal(await page.getByRole('heading', { name: 'Últimas respuestas' }).isVisible(), true)
      const box = await page.getByRole('region', { name: 'Últimos mensajes' }).boundingBox()
      assert.ok(box.height >= 900 / 3, `the latest messages measure ${box.height} px`)
      // The analysis text stands out the most: larger than the rest of the analysis, in its justified reading typeface.
      await control.click()
      // The messages of the send start folded (UD-257): the first one is opened to read its text.
      await drawer.getByRole('button', { name: /^Abrir el mensaje 1:/ }).click()
      const body = page.getByRole('button', { name: /^Texto del mensaje/ }).first()
      await body.waitFor()
      const fontOf = (locator) => locator.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
      const sizes = { text: await fontOf(body), other: await fontOf(drawer.getByRole('button', { name: /^Resumen/ }).first()) }
      assert.ok(sizes.text >= 16, `the analysis text measures ${sizes.text} px`)
      assert.ok(sizes.text > sizes.other, 'the analysis text is larger than the analysis controls')
      // The original is always open, beside the analysis: it is half of the answer to «what did I send».
      assert.equal(await drawer.getByTestId('original-box').isVisible(), true)
      assert.equal(await page.getByRole('button', { name: /^Original/, expanded: false }).count(), 0, 'the original is no longer a fold')
    } finally {
      await context.close()
    }
  })
})

// Round 1, judge A (J1-A-03, 10, 11, 15, 16, 21, 28, 32, 45, 57): what the judge found, as flows.
describe('states, keyboard and rows', () => {
  test('an unknown address says so and a missing record offers to go back (J1-A-10)', async () => {
    const { page, context } = await session()
    try {
      await page.goto(`${origin}/xyz`)
      await page.getByRole('heading', { name: 'Página no encontrada', level: 1 }).waitFor()
      await page.getByText('La dirección no existe').waitFor()
      await page.getByRole('link', { name: 'Ir a Inicio' }).waitFor()
      await page.goto(`${origin}/messages/zzz`)
      await page.getByText('El mensaje no existe').waitFor()
      assert.equal(await page.getByRole('alert').getByText('El mensaje no existe').isVisible(), true)
      await page.getByRole('link', { name: 'Mensajes', exact: true }).first().click()
      await page.getByRole('heading', { name: 'Mensajes', level: 1 }).waitFor()
    } finally {
      await context.close()
    }
  })

  test('the first keyboard stop is «Ir al contenido» and it leads to the content (J1-A-11)', async () => {
    const { page, context } = await session()
    try {
      await page.goto(`${origin}/messages`)
      await page.locator('main h1').waitFor()
      await page.keyboard.press('Tab')
      const first = await page.evaluate(() => document.activeElement?.textContent?.trim())
      assert.equal(first, 'Ir al contenido')
      await page.keyboard.press('Enter')
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'main')
    } finally {
      await context.close()
    }
  })

  test('the status of each row falls in the same column and the actions are always in view (J1-A-15, J1-A-16, J2-A-11)', async () => {
    const { page, context } = await session()
    try {
      await page.goto(`${origin}/messages`)
      await page.locator('main article').first().waitFor()
      const xs = await page.evaluate(() => [...document.querySelectorAll('main article')].map((a) => Math.round((a.querySelector('.led') ?? a.querySelector('[data-testid="state-mark"]')).getBoundingClientRect().left)))
      assert.ok(xs.length >= 3, 'several rows are needed')
      // J1-A-56: the background orbit fades under the top bar and does not cross titles or buttons.
      assert.match(await page.evaluate(() => getComputedStyle(document.querySelector('svg[aria-hidden]')).maskImage), /gradient/)
      assert.equal(new Set(xs).size, 1, `the state jumps column: ${xs.join(', ')}`)
      const row = page.locator('main article').first()
      const reply = row.getByRole('link', { name: 'Responder' })
      const opacity = () => reply.evaluate((el) => getComputedStyle(el.parentElement).opacity)
      // J2-A-11: one rule for every row and screen: the actions are always drawn, with no pointer or focus, and at rest they are light.
      await page.mouse.move(0, 0)
      assert.equal(await opacity(), '1', 'the row actions only existed on hover')
      assert.ok(await reply.isVisible())
      assert.ok(await row.getByRole('button', { name: 'Cerrar', exact: true }).isVisible())
      assert.equal(await page.locator('main article').first().evaluate((el) => getComputedStyle(el.querySelector('.btn-ghost')).backgroundColor), 'rgba(0, 0, 0, 0)', 'at rest the action is not a heavy button')
    } finally {
      await context.close()
    }
  })

  test('a search without results says what was searched and offers to show everything (J1-A-21)', async () => {
    const { page, context } = await session()
    try {
      await page.goto(`${origin}/messages`)
      await page.getByRole('searchbox', { name: 'Buscar' }).fill('zzqx')
      await page.getByText('Sin resultados para «zzqx»').waitFor()
      await page.getByRole('button', { name: 'Mostrar todos' }).click()
      await page.locator('main article').first().waitFor()
    } finally {
      await context.close()
    }
  })

  test('closing a message enters Deshacer and the button does not change shape (J1-A-28)', async () => {
    const { page, context } = await session('carla')
    try {
      await openMessage(page, 'Revisar la lectura')
      const button = page.getByRole('button', { name: 'Cerrar mensaje', exact: true })
      const before = await button.boundingBox()
      assert.equal(await page.getByRole('button', { name: 'Deshacer' }).count(), 0, 'with no changes there is no «Deshacer»')
      await button.click()
      await page.getByRole('button', { name: 'Reabrir mensaje', exact: true }).waitFor()
      await page.getByText('Cerrado').first().waitFor()
      // J2-A-18: closing is confirmed under the bar with its Deshacer, next to the action.
      const notice = page.getByRole('status').filter({ hasText: 'Mensaje cerrado' })
      await notice.waitFor()
      await notice.getByRole('button', { name: 'Deshacer' }).click()
      await page.getByRole('button', { name: 'Cerrar mensaje', exact: true }).waitFor()
      assert.ok(Math.abs((await page.getByRole('button', { name: 'Cerrar mensaje', exact: true }).boundingBox()).x - before.x) <= 1)
    } finally {
      await context.close()
    }
  })

  test('an API error and a slow load show as states, not as an empty screen (J1-A-57)', async () => {
    const { page, context } = await session()
    try {
      // The answer is held until the test has seen the loading state, so the state is observed and not caught on its way.
      let answer = () => {}
      const gate = new Promise((resolve) => (answer = resolve))
      await page.route(/\/api\/messages(\?|$)/, async (route) => {
        await gate
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Fallo de prueba' } }) })
      })
      await page.goto(`${origin}/messages`)
      await page.getByText('Cargando').first().waitFor()
      answer()
      await page.getByRole('alert').first().waitFor()
      await page.unrouteAll({ behavior: 'ignoreErrors' })
    } finally {
      await context.close()
    }
  })

  test('a rejected login shows the reason under the field (J1-A-03)', async () => {
    const context = await panel.browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-CL' })
    const page = await context.newPage()
    try {
      await page.goto(origin)
      await page.getByLabel('Correo').fill('ana@dev.invalid')
      await page.getByLabel('Contraseña').fill('corta')
      await page.getByRole('button', { name: 'Entrar' }).click()
      await page.getByRole('alert').first().waitFor()
      await page.getByText('Cuentas creadas por el equipo').waitFor()
    } finally {
      await context.close()
    }
  })
})

describe('templates as a form (J1-A-32)', () => {
  test('the fields are edited without seeing the file and a new template is built with fields', async () => {
    const { page, context } = await session()
    try {
      await page.goto(`${origin}/areas/a-error`)
      await openTemplates(page)
      await page.getByTestId('template-open').first().click()
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('heading', { name: 'Campos' }).waitFor()
      const text = await dialog.innerText()
      for (const raw of ['---', 'fields:', 'required:', 'name:', '{ name']) assert.ok(!text.includes(raw), `the form shows raw syntax: «${raw}»`)
      await dialog.getByRole('button', { name: 'Agregar campo', exact: true }).click()
      await dialog.getByRole('button', { name: /^Rótulo del campo: Campo nuevo/ }).waitFor()
      const required = dialog.getByLabel('Obligatorio').last()
      await required.click()
      await settled(page)
      assert.equal(await required.isChecked(), true, 'the «Obligatorio» checkbox saves the change')
      await dialog.getByRole('button', { name: 'Quitar el campo Campo nuevo' }).click()
      await dialog.getByRole('button', { name: /^Rótulo del campo: Campo nuevo/ }).waitFor({ state: 'detached' })
      await page.keyboard.press('Escape')

      await page.getByRole('button', { name: 'Crear plantilla', exact: true }).click()
      const form = page.getByRole('dialog')
      await form.getByLabel('Nombre').fill('Observación de prueba')
      await form.getByLabel('Descripción').fill('Una plantilla creada desde el formulario.')
      await form.getByRole('button', { name: 'Agregar campo', exact: true }).click()
      await form.getByLabel('Rótulo del campo').fill('Qué se observó')
      await form.getByRole('button', { name: /^Instrucciones al modelo:/ }).click()
      await page.keyboard.type('Leer el texto y anotar lo observado.')
      await page.keyboard.press('Enter')
      await form.getByRole('button', { name: 'Crear' }).click()
      await page.getByRole('button', { name: 'Abrir Observación de prueba', exact: true }).waitFor()
      const created = await (await page.request.get(`${origin}/api/areas/a-error/templates`)).json()
      const file = (created.items ?? created).find((t) => t.name === 'Observación de prueba').body_markdown
      assert.match(file, /label: "Qué se observó", required: false/)
    } finally {
      await context.close()
    }
  })

  test('each function offers only the providers it accepts (J1-A-45)', async () => {
    const { page, context } = await session()
    try {
      await page.goto(`${origin}/settings`)
      const options = async (slot) => {
        const select = page.locator(`li[data-slot="${slot}"] select`)
        await select.waitFor()
        return select.locator('option').allInnerTexts()
      }
      const text = await options('text')
      assert.ok(text.includes('Anthropic') && !text.some((o) => o.includes('transcripción')), `Texto ofrece: ${text.join(', ')}`)
      assert.deepEqual(await options('speech'), ['Groq (transcripción)'])
    } finally {
      await context.close()
    }
  })
})

// ---------------------------------------------------------------- Round 1, judge B: send, analyze, review and publish
const THREE = 'Corregir el desalineado del sidebar en la vista dashboard.\n\nAgregar la sincronización con WhatsApp en el sidebar.\n\nPregunta: ¿el audio máximo sigue en 25 MB?'

describe('publishing flow (round 1, judge B)', () => {
  test('the proposal shows all the messages at once and the button says how many it sends (J1-B-11)', async () => {
    const { page, context } = await session('bruno')
    try {
      await sendInput(page, THREE)
      await openFirst(page, 20000)
      // One open and the other two on one line: the three titles are in view, without paging.
      await page.getByRole('button', { name: /^Abrir el mensaje \d/ }).first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
      assert.equal(await page.getByRole('button', { name: /^Abrir el mensaje \d/ }).count(), 2, 'two folded messages on one line')
      // The pager of the two lists of Home is outside the proposal: with the strip gone from Home they have room and page, which says nothing about the proposal.
      assert.equal(await page.getByTestId('send-drawer').getByRole('button', { name: 'Página siguiente' }).count(), 0, 'no pagination for three messages')
      await page.getByRole('button', { name: 'Enviar 3 mensajes', exact: true }).waitFor()
      // Opening another folds the previous one: there are still three, one open.
      await page.getByRole('button', { name: /^Abrir el mensaje 2/ }).click()
      await page.getByRole('button', { name: /^Área:/ }).first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
      assert.equal(await page.getByRole('button', { name: /^Área:/ }).count(), 1)
      await page.getByRole('button', { name: /^Abrir el mensaje \d/ }).first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
      assert.equal(await page.getByRole('button', { name: /^Abrir el mensaje \d/ }).count(), 2)
      await page.getByRole('button', { name: /^Abrir el mensaje 1/ }).first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
      assert.equal(await page.getByRole('button', { name: /^Abrir el mensaje 1/ }).count(), 1, 'the first one stayed folded')
    } finally {
      await context.close()
    }
  })

  test('a discard can be undone and returns with what was edited; there is no silent discard (J1-B-26)', async () => {
    const { page, context } = await session('carla')
    try {
      await sendInput(page, 'Una idea que se descarta por error.\n\nOtra idea.')
      await openFirst(page, 20000)
      await page.getByRole('button', { name: /^Título del mensaje: / }).first().click()
      await page.getByRole('textbox', { name: 'Título del mensaje' }).fill('Título corregido antes de descartar')
      await page.getByRole('textbox', { name: 'Título del mensaje' }).press('Enter')
      await page.getByRole('button', { name: /^Título del mensaje: Título corregido/ }).waitFor()
      await page.getByRole('button', { name: 'Descartar' }).last().click()
      const notice = page.locator('[data-notice]')
      await notice.getByText('Envío descartado').waitFor()
      await page.getByRole('button', { name: /^Título del mensaje: Título corregido/ }).waitFor({ state: 'detached' })
      await notice.getByRole('button', { name: 'Deshacer' }).click()
      // The send goes back to the inbox, with the proposal as it was edited; its messages come back folded (UD-257).
      await page.getByRole('button', { name: /^Abrir el mensaje 1: Título corregido antes de descartar/ }).click({ timeout: 10000 })
      await page.getByRole('button', { name: /^Título del mensaje: Título corregido antes de descartar/ }).waitFor()
    } finally {
      await context.close()
    }
  })

  test('re-analyzing: without changes it goes straight; with changes it asks for confirmation (J1-B-18)', async () => {
    const { page, context } = await session('diego')
    try {
      await sendInput(page, 'Un punto para analizar dos veces.')
      await openFirst(page, 20000)
      // The analysis is held while it re-runs and released once the page shows it running: the proposal comes back folded only for a page that saw the analysis.
      // Left free, a loaded machine finished it before the page asked again, the open proposal was never replaced and «Abrir el mensaje 1» never appeared.
      await panel.control.hold()
      await page.getByRole('button', { name: 'Volver a analizar' }).click()
      assert.equal(await page.getByRole('dialog', { name: 'Volver a analizar' }).count(), 0, 'with no changes there is no need to confirm')
      await page.getByText('En espera').first().waitFor()
      await panel.control.release()
      await openFirst(page, 20000)
      await page.getByRole('button', { name: /^Título del mensaje: / }).first().click()
      await page.getByRole('textbox', { name: 'Título del mensaje' }).fill('Cambio que se perdería')
      await page.getByRole('textbox', { name: 'Título del mensaje' }).press('Enter')
      await page.getByRole('button', { name: /^Título del mensaje: Cambio/ }).waitFor()
      await page.getByRole('button', { name: 'Volver a analizar' }).click()
      await page.getByText(/Se descartan los cambios/).waitFor()
    } finally {
      await context.close()
    }
  })

  test('editing a body says how it is saved and how to break a line (J1-B-19)', async () => {
    const { page, context } = await session('eduardo')
    try {
      await sendInput(page, 'Un punto con cuerpo para editar.')
      await openFirst(page, 20000)
      await page.getByRole('button', { name: /^Texto del mensaje: / }).first().click()
      await page.locator('[data-edit-hint]').getByText(/Intro guarda/).waitFor()
    } finally {
      await context.close()
    }
  })

  test('the composer grows in a single jump and removing an attachment has a 24 px target (J1-B-01, J1-B-02, J1-B-30)', async () => {
    const { page, context } = await session('sofia')
    try {
      await page.goto(origin)
      const bar = page.getByLabel('Nuevo mensaje', { exact: true }).last()
      const box = () => bar.evaluate((el) => el.closest('[data-compose-box]').getBoundingClientRect().height)
      const none = await box()
      const wav = (name) => ({ name, mimeType: 'audio/wav', buffer: Buffer.alloc(8044, 128) })
      const input = page.locator('input[type=file]:not([capture])')
      await input.setInputFiles([wav('uno.wav')])
      const one = await box()
      await input.setInputFiles([wav('uno.wav'), wav('dos.wav'), wav('tres.wav')])
      const three = await box()
      assert.ok(one > none, 'the first attachment opens the row')
      assert.ok(Math.abs(three - one) <= 1, `three attachments do not enlarge the bar more than one: ${one} against ${three}`)
      for (const x of await page.getByRole('button', { name: /^Quitar / }).all()) {
        const b = await x.boundingBox()
        assert.ok(b.width >= 24 && b.height >= 24, `target of ${b.width}x${b.height}`)
      }
    } finally {
      await context.close()
    }
  })

  test('an area with several templates lets the user choose the template from the proposal (J1-B-18)', async () => {
    const { page, context } = await session('tomas')
    try {
      await sendInput(page, 'Se rompe la pantalla de inicio: el botón queda cortado.')
      await openFirst(page, 20000)
      const pick = page.getByRole('button', { name: /^Plantilla: / })
      await pick.waitFor()
      await pick.click()
      await page.getByRole('menuitemradio', { name: 'Error visual' }).click()
      await page.getByRole('button', { name: 'Plantilla: Error visual' }).waitFor()
      await page.getByRole('button', { name: 'Deshacer' }).first().waitFor()
    } finally {
      await context.close()
    }
  })

  test('on the phone Enviar and Descartar stay in view with three messages (J1-B-29)', async () => {
    const { page, context } = await session('bruno', { width: 390, height: 844 })
    try {
      await sendInput(page, THREE)
      await openFirst(page, 20000)
      const send = page.getByRole('button', { name: 'Enviar 3 mensajes', exact: true })
      const b = await send.boundingBox()
      assert.ok(b.y + b.height <= 844 && b.y >= 0, `«Enviar» is off screen: ${JSON.stringify(b)}`)
      const d = await page.getByRole('button', { name: 'Descartar' }).last().boundingBox()
      assert.ok(d.y + d.height <= 844, '«Descartar» is off screen')
    } finally {
      await context.close()
    }
  })
})

describe('publishing flow (round 2, judge B)', () => {
  test('Enter never publishes: after saving a field the focus stays on it, and from the container it does nothing (J2-B-13)', async () => {
    const { page, context } = await session('bruno')
    try {
      await sendInput(page, THREE)
      await openFirst(page, 20000)
      const tray = page.getByTestId('tray-control')
      const publishes = []
      page.on('request', (r) => r.method() === 'POST' && /\/inputs\/[^/]+\/publish$/.test(r.url()) && publishes.push(r.url()))
      await page.getByRole('button', { name: /^Texto del mensaje: / }).first().click()
      const field = page.getByRole('textbox', { name: 'Texto del mensaje' })
      await field.fill('Cuerpo corregido, guardado con Intro.')
      await field.press('Enter')
      const saved = page.getByRole('button', { name: /^Texto del mensaje: Cuerpo corregido/ })
      await saved.waitFor()
      // The focus returns to the edited text, not to the window container.
      assert.equal(await saved.evaluate((el) => el === document.activeElement), true, 'focus stays on the saved text')
      // A second Enter reopens that same text: it is what it does in any field, and it does not publish.
      await page.keyboard.press('Enter')
      await page.getByRole('textbox', { name: 'Texto del mensaje' }).waitFor()
      await page.keyboard.press('Escape')
      await saved.waitFor()
      assert.equal(await saved.evaluate((el) => el === document.activeElement), true, 'Escape also returns focus to the text')
      // From the container (the drawer itself, no field focused) Enter does not publish either.
      await page.getByTestId('send-drawer').evaluate((el) => el.focus())
      await page.keyboard.press('Enter')
      await page.keyboard.press('Enter')
      await settled(page)
      assert.equal(publishes.length, 0, 'no Enter published')
      await page.getByRole('button', { name: 'Enviar 3 mensajes', exact: true }).waitFor()
      assert.ok(await tray.count(), 'the submission is still in the tray')
    } finally {
      await context.close()
    }
  })
})

describe('composer (round 2, judge B)', () => {
  test('«Enlace» leaves the focus in its field; long text grows over the page without moving it and keeps the writing line in view (J2-B-01, J2-B-02, J2-B-04)', async () => {
    const { page, context } = await session('sofia')
    try {
      await page.goto(origin)
      await page.getByRole('heading', { name: 'Últimos mensajes' }).waitFor()
      await page.getByRole('button', { name: 'Adjuntar' }).click()
      await page.getByRole('menuitem', { name: 'Enlace' }).click()
      const field = page.getByLabel('Enlace', { exact: true })
      await field.waitFor()
      assert.equal(await field.evaluate((el) => el === document.activeElement), true, 'the link field starts focused')
      assert.ok((await page.locator('label[for="compose-link"]').count()) === 1, 'the field has its label visible')
      await page.keyboard.press('Escape')
      // Long text: the page does not move and the box stops at its maximum.
      const feed = page.getByRole('heading', { name: 'Últimos mensajes' })
      const y0 = (await feed.boundingBox()).y
      const bar = page.getByLabel('Nuevo mensaje', { exact: true }).last()
      await bar.fill(Array.from({ length: 12 }, (_, i) => `Párrafo ${i + 1} del texto largo que se escribe.`).join('\n\n'))
      // `fill` sets the value without moving the caret into view in Firefox (Chromium scrolls on its own); the person's caret goes to the end of what they wrote.
      await page.keyboard.press('Control+End')
      await settled(page)
      assert.equal((await feed.boundingBox()).y, y0, 'typing a long text does not move the page')
      const box = await bar.boundingBox()
      assert.ok(box.height <= 192, `the text box stops at its maximum: ${box.height}`)
      // The writing line stays in view: the cursor is at the end and the box scrolled down to it.
      assert.equal(await bar.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 2), true, 'the end of the text is visible')
      assert.ok((await bar.boundingBox()).y + (await bar.boundingBox()).height <= 900, 'the box is inside the window')
    } finally {
      await context.close()
    }
  })
})

/** Waits until the review of the open send shows its proposal. */
const proposalReady = (page) => openFirst(page, 30000)

describe('tray and proposal (round 2, judge B)', () => {
  test('the strip of sends is a button with its progress, does not move the page, and the window opens on the recent send (J2-B-07, J2-B-08, J2-B-09, J2-B-10)', async () => {
    const { page, context } = await session('diego')
    try {
      await page.goto(origin)
      await page.getByRole('heading', { name: 'Últimos mensajes' }).waitFor()
      const y = async () => ({ bar: (await page.getByLabel('Nuevo mensaje', { exact: true }).last().boundingBox()).y, row: (await page.getByRole('heading', { name: 'Nuevo mensaje' }).boundingBox()).y })
      const before = await y()
      const bar = page.getByLabel('Nuevo mensaje', { exact: true }).last()
      // The first send waits in the queue while the strip is looked at; the test lets the analysis run when it has seen it (H-901).
      await panel.control.hold()
      await bar.fill('Primer envío: revisar el contraste del botón.')
      await page.getByRole('button', { name: 'Enviar' }).first().click()
      const control = page.getByTestId('tray-control')
      await control.waitFor()
      assert.equal(await control.evaluate((el) => el.tagName), 'BUTTON', 'the strip is a button')
      assert.ok((await control.evaluate((el) => getComputedStyle(el).borderTopWidth)) !== '0px', 'button-shaped: it has an outline')
      assert.deepEqual(await y(), before, 'the strip appears without moving the bar or its title')
      // The progress shows with the strip folded.
      await control.getByRole('progressbar').waitFor()
      await panel.control.release()
      // A second send: the drawer lands on the most recent one, not the old one.
      await bar.fill('Segundo envío: agregar la sincronización con WhatsApp.')
      await page.getByRole('button', { name: 'Enviar' }).first().click()
      await control.getByText('2 para revisar').waitFor({ timeout: 40000 })
      const selected = await page.locator('[role="option"][aria-selected="true"]').first().getAttribute('aria-label')
      assert.match(selected, /Segundo envío/, `the dropdown opens on the latest: ${selected}`)
    } finally {
      await context.close()
    }
  })

  test('the window of a send being analyzed keeps the height of the one with a proposal (J3-B-04), and Cancelar looks like a button (J2-B-12)', async () => {
    const { page, context } = await session('eduardo')
    try {
      // The analysis waits for the test's order: «being analyzed» is a state it holds, not a race against the server's clock (H-901).
      await panel.control.hold()
      await page.goto(origin)
      await page.getByLabel('Nuevo mensaje', { exact: true }).last().fill('Un envío que se queda analizando un rato.')
      await page.getByRole('button', { name: 'Enviar' }).first().click()
      const cancel = page.getByRole('button', { name: 'Cancelar', exact: true })
      await cancel.waitFor()
      assert.ok((await cancel.evaluate((el) => parseFloat(getComputedStyle(el).borderTopWidth))) >= 1, '«Cancelar» has an outline')
      const box = await page.getByTestId('send-drawer').boundingBox()
      assert.ok(box.height >= 250, `the dropdown keeps its height from the queue: ${box.height} px`)
    } finally {
      await context.close()
    }
  })

  test('history buttons: Volver a analizar does not move, «Partes sin mensaje» is a button and removing has a single Deshacer that pushes nothing (J2-B-14, J2-B-15, J2-B-21)', async () => {
    const { page, context } = await session('sofia')
    try {
      await sendInput(page, THREE)
      await proposalReady(page)
      const again = page.getByRole('button', { name: 'Volver a analizar' })
      const x0 = (await again.boundingBox()).x
      const send = page.getByRole('button', { name: 'Enviar 3 mensajes', exact: true })
      const sendY = (await send.boundingBox()).y
      await page.getByRole('button', { name: /^Quitar el mensaje/ }).first().click()
      await page.getByRole('button', { name: 'Enviar 2 mensajes', exact: true }).waitFor()
      assert.equal((await again.boundingBox()).x, x0, '«Volver a analizar» keeps its place when the history appears')
      await page.getByRole('button', { name: 'Deshacer' }).first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
      assert.equal(await page.getByRole('button', { name: 'Deshacer' }).count(), 1, 'a single «Deshacer» in view')
      await page.locator('[data-notice]').getByText(/^Mensaje quitado/).waitFor()
      assert.equal(await page.locator('[data-notice]').getByRole('button', { name: 'Deshacer' }).count(), 0, 'the notice does not repeat the «Deshacer»')
      assert.ok((await page.getByRole('button', { name: 'Enviar 2 mensajes', exact: true }).boundingBox()).y <= sendY, 'removing a message does not push «Enviar» down because of the notice')
      // No field of the open message goes past the right edge of its surface (J2-B-18).
      const region = await page.getByRole('region', { name: 'Análisis' }).boundingBox()
      for (const field of await page.locator('dd [role="button"]').all()) {
        const b = await field.boundingBox()
        assert.ok(b.x + b.width <= region.x + region.width - 1, `a field overflows on the right: ${b.x + b.width} against ${region.x + region.width}`)
      }
      // The original is beside the analysis and always open: the proposal keeps its width whatever the original says (J2-B-20, UD-046).
      const original = await page.getByTestId('original-box').boundingBox()
      assert.ok(original.x + original.width <= region.x + 1, 'the original sits to the left of the analysis')
      const unitsButton = page.getByRole('button', { name: /^Partes sin mensaje/ })
      assert.ok((await unitsButton.evaluate((el) => parseFloat(getComputedStyle(el).borderTopWidth))) >= 1, '«Partes sin mensaje» has the shape of a button')
      await unitsButton.click()
      const items = page.locator('[data-lane="discarded-units"] li')
      assert.ok((await items.count()) >= 1)
      assert.ok((await items.first().evaluate((el) => getComputedStyle(el).borderBottomWidth)) !== undefined)
    } finally {
      await context.close()
    }
  })

  test('the recipients menu fits entirely in the window and a row with no recipient says so with a mark (J2-B-17, J2-B-19)', async () => {
    const { page, context } = await session('tomas')
    try {
      await sendInput(page, THREE)
      await proposalReady(page)
      await page.getByRole('button', { name: 'Agregar destinatario' }).first().click()
      const list = page.locator('[data-lane="member-picker"]')
      await list.waitFor()
      const b = await page.getByRole('menu').or(list.locator('..')).first().boundingBox()
      assert.ok(b.y >= 0 && b.y + b.height <= 900, `the menu is inside the window: ${JSON.stringify(b)}`)
      // With up to nine people (the team in the development data) there is nothing to scroll; with more, the box stays inside the window.
      if ((await list.locator('li').count()) <= 9) assert.equal(await list.evaluate((el) => el.scrollHeight <= el.clientHeight + 1), true, 'with nine people there is no need to scroll')
      await page.keyboard.press('Escape')
      // Removing every recipient of the open message leaves its row marked once folded; the others stay plain.
      const chips = page.getByRole('button', { name: /^Quitar a / })
      while (await chips.count()) await chips.first().click({ force: true })
      await page.getByRole('button', { name: /^Abrir el mensaje 2/ }).click()
      await page.locator('[data-needs-attention]').first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
      assert.equal(await page.locator('[data-needs-attention]').count(), 1, 'only the row with no recipient is flagged')
    } finally {
      await context.close()
    }
  })

  test('discarding with more sends leaves its place with its Undo and does not jump to another send (J2-B-22, J2-B-24)', async () => {
    const { page, context } = await session('valentina')
    try {
      await page.goto(origin)
      const bar = page.getByLabel('Nuevo mensaje', { exact: true }).last()
      for (const text of ['Primer punto para descartar uno.', 'Segundo punto que queda en la bandeja.']) {
        await bar.fill(text)
        await page.getByRole('button', { name: 'Enviar' }).first().click()
      }
      const control = page.getByTestId('tray-control')
      await control.getByText('2 para revisar').waitFor({ timeout: 40000 })
      await proposalReady(page)
      await page.getByRole('button', { name: 'Descartar' }).last().click()
      await page.getByRole('status').getByText('Envío descartado').waitFor()
      assert.equal(await page.getByRole('button', { name: /^Área:/ }).count(), 0, 'the detail does not jump to another submission')
      await page.getByRole('status').getByRole('button', { name: 'Deshacer' }).click()
      await proposalReady(page)
    } finally {
      await context.close()
    }
  })

  test('on the phone the sends are one row of options and the proposal is within the first two screens; menus fit in it (J2-B-11, J2-B-23, UD-046)', async () => {
    const { page, context } = await session('ana', { width: 390, height: 844 })
    try {
      await page.goto(origin)
      const bar = page.getByLabel('Nuevo mensaje', { exact: true }).last()
      for (const text of ['Primero.', 'Segundo.', 'Tercero.']) {
        await bar.fill(`${text} Un punto para revisar con el equipo.`)
        await page.getByRole('button', { name: 'Enviar' }).first().click()
      }
      const control = page.getByTestId('tray-control')
      await control.getByText('3 para revisar').waitFor({ timeout: 40000 })
      await proposalReady(page)
      // One row that scrolls sideways, not a list that takes the screen: three sends do not push the proposal down.
      const switcher = await page.getByTestId('send-switcher').boundingBox()
      assert.ok(switcher.height < 100, `the submissions selector is ${switcher.height} px tall`)
      await page.getByTestId('send-switcher').getByRole('option').first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
      assert.equal(await page.getByTestId('send-switcher').getByRole('option').count(), 3, 'each submission has its own option')
      const proposal = await page.getByRole('region', { name: 'Análisis' }).boundingBox()
      assert.ok(proposal.y < 844 * 1.2, `the proposal starts within the first two screens: y=${proposal.y}`)
      await page.getByTestId('send-switcher').getByRole('option').first().click()
      // It is the send already open: its first message stays unfolded (UD-257), with its «Área» button.
      await page.getByRole('button', { name: /^Área:/ }).first().waitFor()
      await page.getByRole('button', { name: /^Área:/ }).first().click()
      const menu = await page.getByRole('menu').boundingBox()
      assert.ok(menu.x >= 0 && menu.x + menu.width <= 390, `the area menu fits the width: ${JSON.stringify(menu)}`)
    } finally {
      await context.close()
    }
  })

  test('publishing says how many messages and to how many people, without moving the window, and the messages exist in Mensajes (J2-B-25, J2-B-26)', async () => {
    const { page, context } = await session('bruno')
    try {
      await sendInput(page, THREE)
      await proposalReady(page)
      const total = async () => ((await (await page.request.get(`${origin}/api/messages?limit=100`)).json()).total ?? 0)
      const had = await total()
      await page.getByRole('button', { name: 'Enviar 3 mensajes', exact: true }).click()
      const notice = page.locator('[data-notice]')
      await notice.getByText(/^3 mensajes publicados para \d+ personas?/).waitFor()
      const heading = page.getByRole('heading', { name: 'Últimos mensajes' })
      const y = (await heading.boundingBox()).y
      await settled(page)
      assert.equal((await heading.boundingBox()).y, y, 'the notice floats: it does not push the page')
      assert.equal(await notice.evaluate((el) => getComputedStyle(el.parentElement).position), 'fixed', 'the page notice floats over it')
      // The trace of the send: its three messages exist in Mensajes, where the link of the notice leads.
      assert.equal(await total(), had + 3, 'the three messages were published')
      await notice.getByRole('link', { name: 'Ver mensajes' }).click()
      await page.waitForURL(/\/messages/)
    } finally {
      await context.close()
    }
  })
})

