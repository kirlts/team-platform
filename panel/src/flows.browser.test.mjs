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
      assert.equal(await page.getByRole('button', { name: 'Deshacer' }).isDisabled(), true, 'the stack lives in memory: it is lost on reload')
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
      const send = page.getByRole('button', { name: 'Enviar', exact: true }).last()
      assert.equal(await send.isDisabled(), true, 'it cannot be sent with required fields empty')
      // Se llenan en el lugar.
      for (const label of ['Pasos para reproducir', 'Qué se esperaba', 'Qué pasó']) {
        await page.getByRole('button', { name: new RegExp(`^${label}: Obligatorio`) }).first().click()
        await page.getByRole('textbox', { name: label }).first().fill('Abrir Inicio y mirar la barra')
        await page.getByRole('textbox', { name: label }).first().press('Enter')
      }
      await page.getByRole('button', { name: 'Deshacer' }).waitFor()
      await send.click()
      await page.getByRole('region', { name: 'Análisis' }).waitFor({ state: 'detached', timeout: 10000 })
    } finally {
      await context.close()
    }
  })

  test('removing a message sends its units to «Sin acción» and «Deshacer» brings them back', async () => {
    const { page, context } = await session('bruno')
    try {
      await sendInput(page, 'Primera idea para el equipo.\n\nSegunda idea para el equipo.')
      await page.getByRole('button', { name: /^Área:/ }).first().waitFor({ timeout: 20000 })
      assert.equal(await page.getByRole('button', { name: /^Sin acción/ }).count(), 0)
      await page.getByRole('button', { name: /^Quitar el mensaje/ }).first().click()
      await page.getByRole('button', { name: /^Sin acción/ }).waitFor()
      await page.getByRole('button', { name: 'Deshacer' }).click()
      await page.getByRole('button', { name: /^Sin acción/ }).waitFor({ state: 'detached' })
      // What was edited survives a reload: the draft is on the server.
      await page.getByRole('button', { name: /^Título del mensaje: Primera idea/ }).click()
      await page.getByRole('textbox', { name: 'Título del mensaje' }).fill('Primera idea, ya corregida')
      await page.getByRole('textbox', { name: 'Título del mensaje' }).press('Enter')
      await page.getByRole('button', { name: /^Título del mensaje: Primera idea, ya corregida/ }).waitFor()
      await page.reload()
      await page.getByRole('button', { name: /^Título del mensaje: Primera idea, ya corregida/ }).waitFor()
    } finally {
      await context.close()
    }
  })

  test('a failed analysis offers «Reintentar» and keeps the text', async () => {
    const { page, context } = await session()
    try {
      await sendInput(page, 'Texto que no se debe perder [simular falla]')
      await page.getByRole('alert').filter({ hasText: 'proveedor de modelo' }).waitFor({ timeout: 20000 })
      await page.getByText('Texto que no se debe perder', { exact: false }).first().waitFor()
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
      // The tray row keeps the input so it can be retried, and the bar is left free.
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
      await page.getByRole('button', { name: 'Deshacer' }).click()
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
      const tray = page.getByRole('region', { name: 'Envíos', exact: true })
      await send(1)
      await tray.waitFor()
      await page.waitForTimeout(500)
      const base = await heights()
      const baseFrame = (await tray.boundingBox()).height
      for (let i = 2; i <= 10; i++) await send(i)
      await tray.getByText('10 envíos').waitFor()
      // They finish staggered: wait until all ten are ready to review.
      for (let i = 0; i < 100; i++) {
        const body = await (await page.request.get(`${origin}/api/inputs?mine=1&status=proposed`)).json()
        if ((body.items ?? body).length === 10) break
        await page.waitForTimeout(200)
      }
      await page.waitForTimeout(800)
      assert.deepEqual(await heights(), base, 'ten inputs must not change the page height')
      assert.ok(Math.abs((await tray.boundingBox()).height - baseFrame) <= 1, 'the tray frame keeps its height')
      assert.ok(base.main <= base.win, 'the main region does not scroll')

      // Keyboard: J moves to the next, K to the previous and Enter publishes the one in view; the next one opens by itself.
      await page.locator('body').click({ position: { x: 5, y: 5 } })
      const selected = () => page.locator('[role="option"][aria-selected="true"]').first().getAttribute('aria-label')
      const first = await selected()
      await page.keyboard.press('j')
      await page.waitForFunction((prev) => document.querySelector('[role="option"][aria-selected="true"]')?.getAttribute('aria-label') !== prev, first)
      await page.keyboard.press('k')
      assert.equal(await selected(), first)
      await page.keyboard.press('Enter')
      await tray.getByText('9 envíos').waitFor()
      assert.notEqual(await selected(), first, 'publishing opens the next one')
      assert.deepEqual(await heights(), base)
    } finally {
      await context.close()
    }
  })
})
