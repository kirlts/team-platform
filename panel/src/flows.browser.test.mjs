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
import { login, startPanel } from './browser-support.mjs'

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
  // Submissions are folded behind a single control (UD-030): the review opens over the page.
  await page.getByTestId('tray-control').click()
}

/** Pages forward until the text shows (lists paginate inside their frame). */
async function showRow(page, text) {
  for (let i = 0; i < 20; i++) {
    if (await page.getByText(text).first().isVisible().catch(() => false)) return
    const next = page.getByRole('button', { name: 'Página siguiente' }).first()
    if (!(await next.isEnabled())) break
    await next.click()
    await page.waitForTimeout(300)
  }
  await page.getByText(text).first().waitFor({ timeout: 2000 })
}

describe('in-place editing', () => {
  test('click opens, Enter saves, Escape cancels, and «Deshacer» and «Rehacer» step through it', async () => {
    const { page, context } = await session()
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

      // Escape descarta.
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
      await page.getByRole('button', { name: /^Área:/ }).first().waitFor({ timeout: 20000 })
      const first = page.getByRole('button', { name: /^Área:/ }).first()
      // One of the areas whose template has the most required fields.
      await first.click()
      await page.getByRole('menuitemradio', { name: 'Error', exact: true }).click()
      await page.getByRole('button', { name: /^Pasos para reproducir: Obligatorio/ }).first().waitFor()
      const send = page.getByRole('button', { name: /^Enviar \d+ mensajes?$/ })
      assert.equal(await send.isDisabled(), true, 'it cannot be sent with required fields empty')
      // Se llenan en el lugar.
      for (const label of ['Pasos para reproducir', 'Qué se esperaba', 'Qué pasó']) {
        await page.getByRole('button', { name: new RegExp(`^${label}: Obligatorio`) }).first().click()
        await page.getByRole('textbox', { name: label }).first().fill('Abrir Inicio y mirar la barra')
        await page.getByRole('textbox', { name: label }).first().press('Enter')
      }
      await page.getByRole('button', { name: 'Deshacer' }).waitFor()
      await send.click()
      // Publishing says what happened: what went out, how many and where to see it (J1-B-25).
      const notice = page.locator('[data-notice]')
      await notice.getByText(/^Se publicaron 2 mensajes/).waitFor({ timeout: 10000 })
      await notice.getByRole('link', { name: 'Ver mensajes' }).waitFor()
      await page.getByRole('region', { name: 'Análisis' }).waitFor({ state: 'detached', timeout: 10000 })
    } finally {
      await context.close()
    }
  })

  test('removing a message sends its units to «Sin mensaje» and Deshacer brings them back', async () => {
    const { page, context } = await session('bruno')
    try {
      await sendInput(page, 'Primera idea para el equipo.\n\nSegunda idea para el equipo.')
      await page.getByRole('button', { name: /^Área:/ }).first().waitFor({ timeout: 20000 })
      assert.equal(await page.getByRole('button', { name: /^Partes sin mensaje/ }).count(), 0)
      await page.getByRole('button', { name: /^Quitar el mensaje/ }).first().click()
      await page.getByRole('button', { name: /^Partes sin mensaje/ }).waitFor()
      await page.locator('[data-notice]').getByText(/^Mensaje quitado/).waitFor()
      await page.getByRole('group', { name: 'Historial de cambios' }).getByRole('button', { name: 'Deshacer' }).click()
      await page.getByRole('button', { name: /^Partes sin mensaje/ }).waitFor({ state: 'detached' })
      // What was edited survives a reload: the draft is on the server.
      await page.getByRole('button', { name: /^Título del mensaje: Primera idea/ }).click()
      await page.getByRole('textbox', { name: 'Título del mensaje' }).fill('Primera idea, ya corregida')
      await page.getByRole('textbox', { name: 'Título del mensaje' }).press('Enter')
      await page.getByRole('button', { name: /^Título del mensaje: Primera idea, ya corregida/ }).waitFor()
      await page.reload()
      await page.getByTestId('tray-control').click() // the review comes back folded
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
      await page.getByText('El texto y los adjuntos del envío se conservaron.').waitFor()
      assert.equal(await page.getByRole('button', { name: 'Reintentar' }).count(), 1)
      await page.getByRole('button', { name: 'Reintentar' }).first().click()
      await page.getByRole('button', { name: /^Área:/ }).first().waitFor({ timeout: 20000 })
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
      await page.getByTestId('tray-control').click()
      // The tray row keeps the submission so it can be retried and the bar is left free.
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
      // The tile of the file is the reply's media: one row of attachments, with the kind drawn in it (J3-A-25).
      await row.getByRole('list', { name: 'Adjuntos' }).getByRole('link', { name: /borrador\.pdf/ }).waitFor()
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
      await page.getByRole('button', { name: 'Miembro', exact: true }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByLabel('Nombre').fill('Marta Nueva')
      await dialog.getByLabel('Correo').fill('marta@dev.invalid')
      await dialog.getByRole('button', { name: 'Crear' }).click()
      await showRow(page, 'Marta Nueva')
      await page.getByRole('button', { name: 'Desactivar a Marta Nueva' }).click()
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
      await page.waitForTimeout(500)
      const base = await heights()
      const baseFrame = (await tray.boundingBox()).height
      for (let i = 2; i <= 10; i++) await send(i)
      // They finish staggered: the folded header counts all ten once they are ready for review.
      await tray.getByText('10 para revisar').waitFor({ timeout: 40000 })
      await page.waitForTimeout(800)
      assert.deepEqual(await heights(), base, 'diez envíos no deben cambiar el alto de la página')
      assert.ok(Math.abs((await tray.boundingBox()).height - baseFrame) <= 1, 'el control de envíos conserva su alto')
      assert.ok(base.main <= base.win, 'la región principal no desplaza')

      // Keyboard inside the review: J moves to the next one and K to the previous one. Enter publishes from nowhere (J2-B-13): a click on Enviar or Enter with the focus on that button does; the next one opens by itself.
      await tray.click()
      await page.getByRole('dialog').waitFor()
      const selected = () => page.locator('[role="option"][aria-selected="true"]').first().getAttribute('aria-label')
      const first = await selected()
      // The window opens on the most recent send (J2-B-10): K goes to the previous one and J comes back.
      await page.keyboard.press('k')
      await page.waitForFunction((prev) => document.querySelector('[role="option"][aria-selected="true"]')?.getAttribute('aria-label') !== prev, first)
      await page.keyboard.press('j')
      await page.waitForFunction((prev) => document.querySelector('[role="option"][aria-selected="true"]')?.getAttribute('aria-label') === prev, first)
      await page.keyboard.press('Enter')
      await page.waitForTimeout(600)
      await tray.getByText('10 para revisar').waitFor()
      await page.getByRole('button', { name: /^Enviar \d+ mensajes?$/ }).focus()
      await page.keyboard.press('Enter')
      await tray.getByText('9 para revisar').waitFor()
      assert.notEqual(await selected(), first, 'al publicar se abre el siguiente')
    } finally {
      await context.close()
    }
  })
})

// ---------------------------------------------------------------- UD-028, UD-029, UD-030: Home, the badge and the priority
/** The fill each priority has, read from a probe element in the page: the reference every badge is compared with. */
const probeFills = (page, weight) =>
  page.evaluate((w) => {
    const out = {}
    for (const tone of ['red', 'yellow', 'blue']) {
      const probe = document.createElement('span')
      probe.setAttribute('data-tone', tone)
      if (w) probe.setAttribute('data-weight', w)
      document.body.append(probe)
      out[tone] = getComputedStyle(probe).backgroundColor
      probe.remove()
    }
    return out
  }, weight)

/** Replaces GET /api/messages/summary with the given counts, to draw every combination without touching the data. */
async function withSummary(page, mine, areas = []) {
  const items = ['red', 'yellow', 'blue'].flatMap((tone) => Array.from({ length: mine[tone] }, (_, i) => ({ message_id: `${tone}-${i}`, title: `Mensaje ${tone} ${i}`, tone, at: '2026-10-21T10:00:00.000Z' })))
  await page.route(/\/api\/messages\/summary$/, (route) => route.fulfill({ json: { mine: { ...mine, total: mine.red + mine.yellow + mine.blue }, items, areas } }))
}

describe('insignia y prioridad (UD-028, UD-029)', () => {
  test('the bell takes the background of the highest priority present, and the Messages badge and the Home notice carry it in the color of their shape, in all eight combinations and both themes (UD-029, UD-036)', async () => {
    for (const scheme of ['light', 'dark']) {
      for (let bits = 0; bits < 8; bits++) {
        const mine = { red: bits & 1 ? 2 : 0, yellow: bits & 2 ? 3 : 0, blue: bits & 4 ? 4 : 0 }
        const context = await panel.browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-CL', colorScheme: scheme })
        const page = await context.newPage()
        try {
          await withSummary(page, mine)
          await login(page, origin, 'ana')
          await page.getByTestId('attention').waitFor()
          const fills = await probeFills(page)
                    assert.equal(new Set(Object.values(fills)).size, 3, 'las tres prioridades tienen fondos distintos')
                    const top = mine.red ? 'red' : mine.yellow ? 'yellow' : mine.blue ? 'blue' : null
          const total = mine.red + mine.yellow + mine.blue
          const surfaces = {
            pestaña: page.getByRole('navigation', { name: 'Navegación' }).locator('[data-testid="messages-badge"]'),
            aviso: page.getByTestId('attention').locator(`[data-testid="tone-mark"][data-tone="${mine.red ? 'red' : mine.yellow ? 'yellow' : 'blue'}"]`),
          }
          for (const [name, badge] of Object.entries(surfaces)) {
            if (!top) {
              assert.equal(await badge.count(), 0, `${name}: sin nada pendiente no hay insignia (${scheme})`)
              continue
            }
            assert.equal(await badge.getAttribute('data-tone'), top, `${name}: prioridad ${top} (${scheme}, ${JSON.stringify(mine)})`)
            // Quiet (UD-036): no tinted fill; the priority is the color of the shape.
            assert.equal(await badge.evaluate((el) => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', `${name}: una marca callada no se rellena (${scheme}, ${JSON.stringify(mine)})`)
            const shape = await badge.locator('svg').first().evaluate((el) => getComputedStyle(el).color)
            assert.equal(shape, await page.evaluate((t) => { const p = document.createElement('i'); p.setAttribute('data-tone', t); p.setAttribute('data-weight', 'quiet'); const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); p.append(s); document.body.append(p); const c = getComputedStyle(s).color; p.remove(); return c }, top), `${name}: la forma lleva el color de ${top} (${scheme})`)
            if (name === 'pestaña') assert.equal((await badge.textContent()).trim(), String(total), `${name}: el número es el total`)
          }
          const bell = page.getByTestId('bell')
          if (top) {
            assert.equal(await bell.getAttribute('data-tone'), top, `campana: prioridad ${top}`)
            assert.equal(await bell.evaluate((el) => getComputedStyle(el).backgroundColor), fills[top], `campana: el fondo pintado es el de ${top} (${scheme})`)
            assert.match((await bell.textContent()).trim(), new RegExp(`${total}$`))
            // One source of truth (J2-B-03): the bell is the only saturated fill on the screen; everything else is quiet.
            const weights = await page.evaluate(() => [...document.querySelectorAll('[data-tone]')].map((el) => el.getAttribute('data-weight') ?? 'solid'))
            assert.equal(weights.filter((w) => w === 'solid').length, 1, `un solo relleno saturado (${scheme}, ${JSON.stringify(mine)})`)
            // The bell lists exactly what it counts (J2-A-43).
            await bell.click()
            assert.equal(await page.locator('[data-lane="bell-list"] li').count(), total, `la campana lista ${total} (${scheme}, ${JSON.stringify(mine)})`)
          } else {
            // With nothing affecting the member, the bell can only show the event-stream news (blue), never another priority.
            assert.ok([null, 'blue'].includes(await bell.getAttribute('data-tone')), 'bell: with nothing pending it can only be blue')
          }
        } finally {
          await context.close()
        }
      }
    }
  })

  test('real data: the Messages badge counts what the server says and the Home notice repeats it per priority', async () => {
    const { page, context } = await session('ana')
    try {
      const summary = await (await page.request.get(`${origin}/api/messages/summary`)).json()
      assert.ok(summary.mine.red > 0 && summary.mine.yellow > 0 && summary.mine.blue > 0, 'los datos de desarrollo tienen las tres prioridades para Ana')
      const badge = page.getByRole('navigation', { name: 'Navegación' }).locator('[data-testid="messages-badge"]')
      await badge.waitFor()
      assert.equal(await badge.getAttribute('data-tone'), 'red')
      assert.equal((await badge.textContent()).trim(), String(summary.mine.total))
      const attention = page.getByTestId('attention')
      for (const [tone, word, n] of [['red', 'Por atender', summary.mine.red], ['yellow', 'Pendiente', summary.mine.yellow], ['blue', 'Novedad', summary.mine.blue]]) {
        const mark = attention.locator(`[data-testid="tone-mark"][data-tone="${tone}"]`)
        assert.equal((await mark.textContent()).replace(/\s+/g, ''), `${word}${n}`.replace(/\s+/g, ''))
      }
    } finally {
      await context.close()
    }
  })

  test('a closed message loses its urgency edge and mark and leaves the count and the bell (J2-A-09, J2-A-43)', async () => {
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
        assert.equal(await row.locator('[data-testid="tone-mark"]').count(), 0, 'sin marca de prioridad')
        assert.match(await row.evaluate((el) => getComputedStyle(el).boxShadow), /^none$/, 'sin borde de urgencia')
      }
      await page.getByTestId('bell').click()
      await page.waitForTimeout(400)
      const listed = await page.locator('[data-lane="bell-list"] li').allInnerTexts()
      assert.ok(listed.length <= before, 'la lista de la campana no crece')
      assert.ok(!listed.some((t) => t.includes(title)), 'la campana ya no lista el mensaje cerrado')
    } finally {
      await context.close()
    }
  })

  test('a pending item per area leads to Messages filtered by that area and by open ones, and shows as many messages as the number says', async () => {
    const { page, context } = await session('ana')
    try {
      const chip = page.getByTestId('area-pending').filter({ hasText: 'Error' }).first()
      await chip.waitFor()
      const summary = await (await page.request.get(`${origin}/api/messages/summary`)).json()
      const areas = await (await page.request.get(`${origin}/api/areas`)).json()
      const error = (areas.items ?? areas).find((a) => a.title === 'Error')
      const open = summary.areas.find((a) => a.area_id === error.id).open
      assert.ok(open > 0)
      await chip.click()
      await page.waitForURL(/\/messages\?/)
      const url = new URL(page.url())
      assert.deepEqual(url.searchParams.getAll('f').sort(), [`area:eq:${error.id}`, 'status:eq:open'])
      await page.getByText(`${open} mensajes`, { exact: true }).waitFor()
      assert.equal(await page.getByText('Abierto', { exact: true }).count() > 0, true)
      assert.equal(await page.getByText('Respondido', { exact: true }).count(), 0, 'el filtro deja sólo abiertos')
    } finally {
      await context.close()
    }
  })
})

describe('Inicio (UD-030)', () => {
  test('with submissions in progress, the latest messages and replies stay in view and the submissions are folded with their status', async () => {
    const { page, context } = await session('ana')
    try {
      await page.getByRole('heading', { name: 'Últimos mensajes' }).waitFor()
      await page.getByLabel('Nuevo mensaje', { exact: true }).last().fill('Revisar el contraste del botón Enviar en el tema oscuro.')
      await page.getByRole('button', { name: 'Enviar' }).first().click()
      const control = page.getByTestId('tray-control')
      await control.waitFor()
      await control.getByText('para revisar').waitFor({ timeout: 20000 })
      assert.equal(await page.getByRole('dialog').count(), 0, 'los envíos nacen plegados')
      assert.equal(await page.getByRole('heading', { name: 'Últimos mensajes' }).isVisible(), true)
      assert.equal(await page.getByRole('heading', { name: 'Últimas respuestas' }).isVisible(), true)
      // The two blocks take up the main part of the page: each one is at least a third of its height.
      const box = await page.getByRole('region', { name: 'Últimos mensajes' }).boundingBox()
      assert.ok(box.height >= 900 / 3, `the latest messages measure ${box.height} px`)
      // The analysis text stands out the most: larger than the rest of the analysis, in its justified reading typeface.
      await control.click()
      const body = page.getByRole('button', { name: /^Texto del mensaje/ }).first()
      await body.waitFor()
      const fontOf = (locator) => locator.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
      const sizes = { text: await fontOf(body), other: await fontOf(page.getByRole('dialog').getByRole('button', { name: /^Resumen/ }).first()) }
      assert.ok(sizes.text >= 16, `el texto del análisis mide ${sizes.text} px`)
      assert.ok(sizes.text > sizes.other, 'the analysis text is larger than the analysis controls')
      // The original stays folded until it is opened.
      assert.equal(await page.getByRole('button', { name: /^Original/ }).getAttribute('aria-expanded'), 'false')
    } finally {
      await context.close()
    }
  })
})

// Round 1, judge A (J1-A-03, 10, 11, 15, 16, 21, 28, 32, 45, 57): what the judge found, as flows.
describe('estados, teclado y filas', () => {
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
      await page.getByRole('link', { name: 'Volver a mensajes' }).click()
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
      const xs = await page.evaluate(() => [...document.querySelectorAll('main article')].map((a) => Math.round((a.querySelector('.led') ?? a.querySelector('[data-testid="tone-mark"]')).getBoundingClientRect().left)))
      assert.ok(xs.length >= 3, 'hacen falta varias filas')
      // J1-A-56: the background orbit fades under the top bar and does not cross titles or buttons.
      assert.match(await page.evaluate(() => getComputedStyle(document.querySelector('svg[aria-hidden]')).maskImage), /gradient/)
      assert.equal(new Set(xs).size, 1, `el estado salta de columna: ${xs.join(', ')}`)
      const row = page.locator('main article').first()
      const reply = row.getByRole('link', { name: 'Responder' })
      const opacity = () => reply.evaluate((el) => getComputedStyle(el.parentElement).opacity)
      // J2-A-11: one rule for every row and screen: the actions are always drawn, with no pointer or focus, and at rest they are light.
      await page.mouse.move(0, 0)
      assert.equal(await opacity(), '1', 'las acciones de la fila sólo existían al pasar el cursor')
      assert.ok(await reply.isVisible())
      assert.ok(await row.getByRole('button', { name: 'Cerrar', exact: true }).isVisible())
      assert.equal(await page.locator('main article').first().evaluate((el) => getComputedStyle(el.querySelector('.btn-ghost')).backgroundColor), 'rgba(0, 0, 0, 0)', 'en reposo la acción no es un botón pesado')
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
    const { page, context } = await session()
    try {
      await openMessage(page, 'Revisar la lectura')
      const button = page.getByRole('button', { name: 'Cerrar', exact: true })
      const before = await button.boundingBox()
      assert.equal(await page.getByRole('button', { name: 'Deshacer' }).count(), 0, 'sin cambios no hay Deshacer')
      await button.click()
      await page.getByRole('button', { name: 'Reabrir', exact: true }).waitFor()
      await page.getByText('Cerrado').first().waitFor()
      // J2-A-18: closing is confirmed under the bar with its Deshacer, next to the action.
      const notice = page.getByRole('status').filter({ hasText: 'Mensaje cerrado' })
      await notice.waitFor()
      await notice.getByRole('button', { name: 'Deshacer' }).click()
      await page.getByRole('button', { name: 'Cerrar', exact: true }).waitFor()
      assert.ok(Math.abs((await page.getByRole('button', { name: 'Cerrar', exact: true }).boundingBox()).x - before.x) <= 1)
    } finally {
      await context.close()
    }
  })

  test('an API error and a slow load show as states, not as an empty screen (J1-A-57)', async () => {
    const { page, context } = await session()
    try {
      await page.route(/\/api\/messages(\?|$)/, async (route) => {
        await new Promise((r) => setTimeout(r, 1200))
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Fallo de prueba' } }) })
      })
      await page.goto(`${origin}/messages`)
      await page.getByText('Cargando').first().waitFor()
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
      await page.getByText('Las cuentas las crea el Editor del equipo').waitFor()
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
      await page.getByRole('button', { name: /^Campos e instrucciones/ }).first().click()
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('heading', { name: 'Campos' }).waitFor()
      const text = await dialog.innerText()
      for (const raw of ['---', 'fields:', 'required:', 'name:', '{ name']) assert.ok(!text.includes(raw), `el formulario muestra sintaxis cruda: «${raw}»`)
      await dialog.getByRole('button', { name: 'Campo', exact: true }).click()
      await dialog.getByRole('button', { name: /^Rótulo del campo: Campo nuevo/ }).waitFor()
      const required = dialog.getByLabel('Obligatorio').last()
      await required.click()
      await page.waitForTimeout(400)
      assert.equal(await required.isChecked(), true, 'la casilla Obligatorio guarda el cambio')
      await dialog.getByRole('button', { name: 'Quitar el campo Campo nuevo' }).click()
      await dialog.getByRole('button', { name: /^Rótulo del campo: Campo nuevo/ }).waitFor({ state: 'detached' })
      await page.keyboard.press('Escape')

      await page.getByRole('button', { name: 'Plantilla', exact: true }).click()
      const form = page.getByRole('dialog')
      await form.getByLabel('Nombre').fill('Observación de prueba')
      await form.getByLabel('Descripción').fill('Una plantilla creada desde el formulario.')
      await form.getByRole('button', { name: 'Campo', exact: true }).click()
      await form.getByLabel('Rótulo del campo').fill('Qué se observó')
      await form.getByRole('button', { name: /^Instrucciones al modelo:/ }).click()
      await page.keyboard.type('Leer el texto y anotar lo observado.')
      await page.keyboard.press('Enter')
      await form.getByRole('button', { name: 'Crear' }).click()
      await page.getByRole('button', { name: /^Nombre: Observación de prueba/ }).waitFor()
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
      await page.getByRole('button', { name: 'Proveedor de Texto' }).click()
      const options = await page.getByRole('menuitemradio').allInnerTexts()
      assert.ok(options.includes('anthropic') && !options.includes('groq-speech'), `Texto ofrece: ${options.join(', ')}`)
      await page.keyboard.press('Escape')
      assert.equal(await page.getByRole('button', { name: 'Proveedor de Transcripción' }).count(), 0, 'una función con un solo proveedor no ofrece un control vacío')
    } finally {
      await context.close()
    }
  })
})

// ---------------------------------------------------------------- Ronda 1, juez B: enviar, analizar, revisar y publicar
const THREE = 'Corregir el desalineado del sidebar en la vista dashboard.\n\nAgregar la sincronización con WhatsApp en el sidebar.\n\nPregunta: ¿el audio máximo sigue en 25 MB?'

describe('publishing flow (round 1, judge B)', () => {
  test('the proposal shows all the messages at once and the button says how many it sends (J1-B-11)', async () => {
    const { page, context } = await session('bruno')
    try {
      await sendInput(page, THREE)
      await page.getByRole('button', { name: /^Área:/ }).first().waitFor({ timeout: 20000 })
      // One open and the other two on one line: the three titles are in view, without paging.
      assert.equal(await page.getByRole('button', { name: /^Abrir el mensaje \d/ }).count(), 2, 'dos mensajes plegados en una línea')
      assert.equal(await page.getByRole('button', { name: 'Página siguiente' }).count(), 0, 'sin paginación para tres mensajes')
      await page.getByRole('button', { name: 'Enviar 3 mensajes', exact: true }).waitFor()
      // Opening another folds the previous one: there are still three, one open.
      await page.getByRole('button', { name: /^Abrir el mensaje 2/ }).click()
      assert.equal(await page.getByRole('button', { name: /^Área:/ }).count(), 1)
      assert.equal(await page.getByRole('button', { name: /^Abrir el mensaje \d/ }).count(), 2)
      assert.equal(await page.getByRole('button', { name: /^Abrir el mensaje 1/ }).count(), 1, 'el primero quedó plegado')
    } finally {
      await context.close()
    }
  })

  test('a discard can be undone and returns with what was edited; there is no silent discard (J1-B-26)', async () => {
    const { page, context } = await session('carla')
    try {
      await sendInput(page, 'Una idea que se descarta por error.\n\nOtra idea.')
      await page.getByRole('button', { name: /^Área:/ }).first().waitFor({ timeout: 20000 })
      await page.getByRole('button', { name: /^Título del mensaje: / }).first().click()
      await page.getByRole('textbox', { name: 'Título del mensaje' }).fill('Título corregido antes de descartar')
      await page.getByRole('textbox', { name: 'Título del mensaje' }).press('Enter')
      await page.getByRole('button', { name: /^Título del mensaje: Título corregido/ }).waitFor()
      await page.getByRole('button', { name: 'Descartar' }).last().click()
      const notice = page.locator('[data-notice]')
      await notice.getByText('Envío descartado').waitFor()
      await page.getByRole('button', { name: /^Título del mensaje: Título corregido/ }).waitFor({ state: 'detached' })
      await notice.getByRole('button', { name: 'Deshacer' }).click()
      // The send goes back to the inbox, with the proposal as it was edited.
      await page.getByRole('button', { name: /^Título del mensaje: Título corregido antes de descartar/ }).waitFor({ timeout: 10000 })
    } finally {
      await context.close()
    }
  })

  test('re-analyzing: without changes it goes straight; with changes it asks for confirmation (J1-B-18)', async () => {
    const { page, context } = await session('diego')
    try {
      await sendInput(page, 'Un punto para analizar dos veces.')
      await page.getByRole('button', { name: /^Área:/ }).first().waitFor({ timeout: 20000 })
      await page.getByRole('button', { name: 'Volver a analizar' }).click()
      assert.equal(await page.getByRole('dialog', { name: 'Volver a analizar' }).count(), 0, 'sin cambios no hace falta confirmar')
      await page.getByRole('button', { name: /^Área:/ }).first().waitFor({ timeout: 20000 })
      await page.getByRole('button', { name: /^Título del mensaje: / }).first().click()
      await page.getByRole('textbox', { name: 'Título del mensaje' }).fill('Cambio que se perdería')
      await page.getByRole('textbox', { name: 'Título del mensaje' }).press('Enter')
      await page.getByRole('button', { name: /^Título del mensaje: Cambio/ }).waitFor()
      await page.getByRole('button', { name: 'Volver a analizar' }).click()
      await page.getByText(/Se descarta esta propuesta con sus cambios/).waitFor()
    } finally {
      await context.close()
    }
  })

  test('editing a body says how it is saved and how to break a line (J1-B-19)', async () => {
    const { page, context } = await session('eduardo')
    try {
      await sendInput(page, 'Un punto con cuerpo para editar.')
      await page.getByRole('button', { name: /^Área:/ }).first().waitFor({ timeout: 20000 })
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
      assert.ok(one > none, 'el primer adjunto abre la fila')
      assert.ok(Math.abs(three - one) <= 1, `tres adjuntos no agrandan más la barra que uno: ${one} contra ${three}`)
      for (const x of await page.getByRole('button', { name: /^Quitar / }).all()) {
        const b = await x.boundingBox()
        assert.ok(b.width >= 24 && b.height >= 24, `blanco de ${b.width}x${b.height}`)
      }
    } finally {
      await context.close()
    }
  })

  test('an area with several templates lets the user choose the template from the proposal (J1-B-18)', async () => {
    const { page, context } = await session('tomas')
    try {
      await sendInput(page, 'Se rompe la pantalla de inicio: el botón queda cortado.')
      await page.getByRole('button', { name: /^Área:/ }).first().waitFor({ timeout: 20000 })
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
      await page.getByRole('button', { name: /^Área:/ }).first().waitFor({ timeout: 20000 })
      const send = page.getByRole('button', { name: 'Enviar 3 mensajes', exact: true })
      const b = await send.boundingBox()
      assert.ok(b.y + b.height <= 844 && b.y >= 0, `Enviar queda fuera de la pantalla: ${JSON.stringify(b)}`)
      const d = await page.getByRole('button', { name: 'Descartar' }).last().boundingBox()
      assert.ok(d.y + d.height <= 844, 'Descartar queda fuera de la pantalla')
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
      await page.getByRole('button', { name: /^Área:/ }).first().waitFor({ timeout: 20000 })
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
      assert.equal(await saved.evaluate((el) => el === document.activeElement), true, 'el foco queda en el texto guardado')
      // A second Enter reopens that same text: it is what it does in any field, and it does not publish.
      await page.keyboard.press('Enter')
      await page.getByRole('textbox', { name: 'Texto del mensaje' }).waitFor()
      await page.keyboard.press('Escape')
      await saved.waitFor()
      assert.equal(await saved.evaluate((el) => el === document.activeElement), true, 'Escape también devuelve el foco al texto')
      // From the container (the window itself, no field focused) Enter does not publish either.
      await page.getByRole('dialog').evaluate((el) => el.focus())
      await page.keyboard.press('Enter')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(800)
      assert.equal(publishes.length, 0, 'ningún Intro publicó')
      await page.getByRole('button', { name: 'Enviar 3 mensajes', exact: true }).waitFor()
      assert.ok(await tray.count(), 'el envío sigue en la bandeja')
    } finally {
      await context.close()
    }
  })
})

describe('compositor (ronda 2, juez B)', () => {
  test('«Enlace» leaves the focus in its field; long text grows over the page without moving it and keeps the writing line in view (J2-B-01, J2-B-02, J2-B-04)', async () => {
    const { page, context } = await session('sofia')
    try {
      await page.goto(origin)
      await page.getByRole('heading', { name: 'Últimos mensajes' }).waitFor()
      await page.getByRole('button', { name: 'Adjuntar' }).click()
      await page.getByRole('menuitem', { name: 'Enlace' }).click()
      const field = page.getByLabel('Enlace', { exact: true })
      await field.waitFor()
      assert.equal(await field.evaluate((el) => el === document.activeElement), true, 'el campo del enlace nace con el foco')
      assert.ok((await page.locator('label[for="compose-link"]').count()) === 1, 'el campo lleva su rótulo visible')
      await page.keyboard.press('Escape')
      // Long text: the page does not move and the box stops at its maximum.
      const feed = page.getByRole('heading', { name: 'Últimos mensajes' })
      const y0 = (await feed.boundingBox()).y
      const bar = page.getByLabel('Nuevo mensaje', { exact: true }).last()
      await bar.fill(Array.from({ length: 12 }, (_, i) => `Párrafo ${i + 1} del texto largo que se escribe.`).join('\n\n'))
      await page.waitForTimeout(300)
      assert.equal((await feed.boundingBox()).y, y0, 'escribir un texto largo no mueve la página')
      const box = await bar.boundingBox()
      assert.ok(box.height <= 124, `el cuadro de texto se detiene en su máximo: ${box.height}`)
      // The writing line stays in view: the cursor is at the end and the box scrolled down to it.
      assert.equal(await bar.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 2), true, 'se ve el final del texto')
      assert.ok((await bar.boundingBox()).y + (await bar.boundingBox()).height <= 900, 'el cuadro está dentro de la ventana')
    } finally {
      await context.close()
    }
  })
})

/** Waits until the review of the open send shows its proposal. */
const proposalReady = (page) => page.getByRole('button', { name: /^Área:/ }).first().waitFor({ timeout: 30000 })

describe('tray and proposal (round 2, judge B)', () => {
  test('the strip of sends is a button with its progress, does not move the page, and the window opens on the recent send (J2-B-07, J2-B-08, J2-B-09, J2-B-10)', async () => {
    const { page, context } = await session('diego')
    try {
      await page.goto(origin)
      await page.getByRole('heading', { name: 'Últimos mensajes' }).waitFor()
      const y = async () => ({ feed: (await page.getByRole('heading', { name: 'Últimos mensajes' }).boundingBox()).y, bar: (await page.getByLabel('Nuevo mensaje', { exact: true }).last().boundingBox()).y })
      const before = await y()
      const bar = page.getByLabel('Nuevo mensaje', { exact: true }).last()
      await bar.fill('Primer envío: revisar el contraste del botón.')
      await page.getByRole('button', { name: 'Enviar' }).first().click()
      const control = page.getByTestId('tray-control')
      await control.waitFor()
      assert.equal(await control.evaluate((el) => el.tagName), 'BUTTON', 'la franja es un botón')
      assert.ok((await control.evaluate((el) => getComputedStyle(el).borderTopWidth)) !== '0px', 'con forma de botón: tiene contorno')
      assert.deepEqual(await y(), before, 'la franja aparece sin mover la barra ni las listas')
      // The progress shows with the strip folded.
      await control.getByRole('progressbar').waitFor()
      // A second send: on opening, the window lands on the most recent one that needs the person, not the old one.
      await bar.fill('Segundo envío: agregar la sincronización con WhatsApp.')
      await page.getByRole('button', { name: 'Enviar' }).first().click()
      await control.getByText('2 para revisar').waitFor({ timeout: 40000 })
      await control.click()
      const selected = await page.locator('[role="option"][aria-selected="true"]').first().getAttribute('aria-label')
      assert.match(selected, /Segundo envío/, `la ventana abre en el reciente: ${selected}`)
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
      await page.getByTestId('tray-control').click()
      const cancel = page.getByRole('button', { name: 'Cancelar', exact: true })
      await cancel.waitFor()
      assert.ok((await cancel.evaluate((el) => parseFloat(getComputedStyle(el).borderTopWidth))) >= 1, 'Cancelar tiene contorno')
      const box = await page.getByRole('dialog').boundingBox()
      assert.ok(box.height > 600, `la ventana conserva su alto desde la cola: ${box.height} px`)
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
      assert.equal((await again.boundingBox()).x, x0, 'Volver a analizar conserva su lugar cuando aparece el historial')
      assert.equal(await page.getByRole('button', { name: 'Deshacer' }).count(), 1, 'un solo Deshacer a la vista')
      await page.locator('[data-notice]').getByText(/^Mensaje quitado/).waitFor()
      assert.equal(await page.locator('[data-notice]').getByRole('button', { name: 'Deshacer' }).count(), 0, 'el aviso no repite el Deshacer')
      assert.ok((await page.getByRole('button', { name: 'Enviar 2 mensajes', exact: true }).boundingBox()).y <= sendY, 'quitar un mensaje no empuja Enviar hacia abajo por culpa del aviso')
      // No field of the open message goes past the right edge of its surface (J2-B-18).
      const region = await page.getByRole('region', { name: 'Análisis' }).boundingBox()
      for (const field of await page.locator('dd [role="button"]').all()) {
        const b = await field.boundingBox()
        assert.ok(b.x + b.width <= region.x + region.width - 1, `un campo se sale por la derecha: ${b.x + b.width} contra ${region.x + region.width}`)
      }
      // With the original open, the proposal keeps its width (J2-B-20): the original goes above, not beside.
      await page.getByRole('button', { name: /^Original/ }).first().click()
      const open = await page.getByRole('region', { name: 'Análisis' }).boundingBox()
      assert.ok(Math.abs(open.width - region.width) <= 2, `la propuesta cambió de ancho con el original abierto: ${region.width} a ${open.width}`)
      await page.getByRole('button', { name: /^Original/ }).first().click()
      const unitsButton = page.getByRole('button', { name: /^Partes sin mensaje/ })
      assert.ok((await unitsButton.evaluate((el) => parseFloat(getComputedStyle(el).borderTopWidth))) >= 1, '«Partes sin mensaje» tiene forma de botón')
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
      assert.ok(b.y >= 0 && b.y + b.height <= 900, `el menú está dentro de la ventana: ${JSON.stringify(b)}`)
      // With up to nine people (the team in the development data) there is nothing to scroll; with more, the box stays inside the window.
      if ((await list.locator('li').count()) <= 9) assert.equal(await list.evaluate((el) => el.scrollHeight <= el.clientHeight + 1), true, 'con nueve personas no hace falta desplazar')
      await page.keyboard.press('Escape')
      // Removing every recipient of the open message leaves its row marked once folded; the others stay plain.
      const chips = page.getByRole('button', { name: /^Quitar a / })
      while (await chips.count()) await chips.first().click({ force: true })
      await page.getByRole('button', { name: /^Abrir el mensaje 2/ }).click()
      assert.equal(await page.locator('[data-needs-attention]').count(), 1, 'sólo la fila sin destinatario se señala')
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
      await control.click()
      await proposalReady(page)
      await page.getByRole('button', { name: 'Descartar' }).last().click()
      await page.getByRole('status').getByText('Envío descartado').waitFor()
      assert.equal(await page.getByRole('button', { name: /^Área:/ }).count(), 0, 'el detalle no salta a otro envío')
      await page.getByRole('status').getByRole('button', { name: 'Deshacer' }).click()
      await proposalReady(page)
    } finally {
      await context.close()
    }
  })

  test('on the phone the list of sends folds and the proposal takes the screen; menus fit in it (J2-B-11, J2-B-23)', async () => {
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
      await control.click()
      await proposalReady(page)
      const proposal = await page.getByRole('region', { name: 'Análisis' }).boundingBox()
      assert.ok(proposal.y < 844 * 0.35, `la propuesta empieza arriba, sin la lista encima: y=${proposal.y}`)
      assert.equal(await page.getByRole('option').count(), 0, 'la lista de envíos está plegada')
      await page.getByRole('button', { name: '3 envíos' }).click()
      assert.equal(await page.getByRole('option').count(), 3, 'se abre con un toque')
      await page.getByRole('option').first().click()
      await proposalReady(page)
      await page.getByRole('button', { name: /^Área:/ }).first().click()
      const menu = await page.getByRole('menu').boundingBox()
      assert.ok(menu.x >= 0 && menu.x + menu.width <= 390, `el menú de área cabe en el ancho: ${JSON.stringify(menu)}`)
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
      await notice.getByText(/^Se publicaron 3 mensajes para \d+ personas?\./).waitFor()
      const heading = page.getByRole('heading', { name: 'Últimos mensajes' })
      const y = (await heading.boundingBox()).y
      await page.waitForTimeout(300)
      assert.equal((await heading.boundingBox()).y, y, 'el aviso flota: no empuja la página')
      assert.equal(await notice.evaluate((el) => getComputedStyle(el.parentElement).position), 'fixed', 'el aviso de la página flota sobre ella')
      // The trace of the send: its three messages exist in Mensajes, where the link of the notice leads.
      assert.equal(await total(), had + 3, 'los tres mensajes quedaron publicados')
      await notice.getByRole('link', { name: 'Ver mensajes' }).click()
      await page.waitForURL(/\/messages/)
    } finally {
      await context.close()
    }
  })
})

