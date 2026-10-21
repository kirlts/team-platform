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
import { after, before, describe, test } from 'node:test'
import { login, startPanel } from './browser-support.mjs'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_PORT ?? 8796), { stepMs: 80 })
  origin = panel.origin
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
      assert.equal(await page.getByRole('button', { name: /^Sin mensaje/ }).count(), 0)
      await page.getByRole('button', { name: /^Quitar el mensaje/ }).first().click()
      await page.getByRole('button', { name: /^Sin mensaje/ }).waitFor()
      await page.locator('[data-notice]').getByText(/^Mensaje quitado/).waitFor()
      await page.getByRole('group', { name: 'Historial de cambios' }).getByRole('button', { name: 'Deshacer' }).click()
      await page.getByRole('button', { name: /^Sin mensaje/ }).waitFor({ state: 'detached' })
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
      await row.getByRole('list', { name: 'Adjuntos' }).first().getByText('Documento').waitFor({ state: 'attached' })
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
      // J2-A-18: el cambio se dice bajo la barra y trae su Deshacer.
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

      // Keyboard inside the review: J moves to the next one, K to the previous one and Enter publishes the one in view; the next one opens by itself.
      await tray.click()
      await page.getByRole('dialog').waitFor()
      const selected = () => page.locator('[role="option"][aria-selected="true"]').first().getAttribute('aria-label')
      const first = await selected()
      await page.keyboard.press('j')
      await page.waitForFunction((prev) => document.querySelector('[role="option"][aria-selected="true"]')?.getAttribute('aria-label') !== prev, first)
      await page.keyboard.press('k')
      assert.equal(await selected(), first)
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
const probeFills = (page) =>
  page.evaluate(() => {
    const out = {}
    for (const tone of ['red', 'yellow', 'blue']) {
      const probe = document.createElement('span')
      probe.setAttribute('data-tone', tone)
      document.body.append(probe)
      out[tone] = getComputedStyle(probe).backgroundColor
      probe.remove()
    }
    return out
  })

/** Replaces GET /api/messages/summary with the given counts, to draw every combination without touching the data. */
async function withSummary(page, mine, areas = []) {
  await page.route(/\/api\/messages\/summary$/, (route) => route.fulfill({ json: { mine: { ...mine, total: mine.red + mine.yellow + mine.blue }, areas } }))
}

describe('insignia y prioridad (UD-028, UD-029)', () => {
  test('the background of the Messages badge, the bell and the Home notice is that of the highest priority present, in all eight combinations and both themes', async () => {
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
            aviso: page.getByTestId('attention-badge'),
          }
          for (const [name, badge] of Object.entries(surfaces)) {
            if (!top) {
              assert.equal(await badge.count(), 0, `${name}: sin nada pendiente no hay insignia (${scheme})`)
              continue
            }
            assert.equal(await badge.getAttribute('data-tone'), top, `${name}: prioridad ${top} (${scheme}, ${JSON.stringify(mine)})`)
            assert.equal(await badge.evaluate((el) => getComputedStyle(el).backgroundColor), fills[top], `${name}: el fondo pintado es el de ${top} (${scheme}, ${JSON.stringify(mine)})`)
            assert.equal((await badge.textContent()).trim(), String(total), `${name}: el número es el total`)
          }
          const bell = page.getByTestId('bell')
          if (top) {
            assert.equal(await bell.getAttribute('data-tone'), top, `campana: prioridad ${top}`)
            assert.equal(await bell.evaluate((el) => getComputedStyle(el).backgroundColor), fills[top], `campana: el fondo pintado es el de ${top} (${scheme})`)
            assert.match((await bell.textContent()).trim(), new RegExp(`${total}$`))
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
      const xs = await page.evaluate(() => [...document.querySelectorAll('main article')].map((a) => Math.round(a.querySelector('.led').getBoundingClientRect().left)))
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
      // J2-A-18: cerrar se confirma bajo la barra con su Deshacer, junto a la acción.
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

/** Leaves the person with an empty tray: tests that count messages must not inherit the sends of an earlier test. */
async function clearTray(page) {
  const body = await (await page.request.get(`${origin}/api/inputs`)).json()
  for (const input of body.items ?? body) {
    if (!['published', 'cancelled'].includes(input.status)) await page.request.post(`${origin}/api/inputs/${input.id}/cancel`, { headers: { 'X-Team-Request': 'panel' } })
  }
}

describe('publishing flow (round 1, judge B)', () => {
  test('the proposal shows all the messages at once and the button says how many it sends (J1-B-11)', async () => {
    const { page, context } = await session('bruno')
    try {
      await clearTray(page)
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
      await clearTray(page)
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
      await clearTray(page)
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
      await clearTray(page)
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
      const box = () => bar.evaluate((el) => el.closest('.glass').getBoundingClientRect().height)
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
      await clearTray(page)
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
      await clearTray(page)
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
