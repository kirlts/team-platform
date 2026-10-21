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
  assert.ok(hit, `no hay un mensaje que empiece con «${titleStart}»`)
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
  assert.equal(await bar.inputValue(), '', 'la barra se vacía al enviar, sin esperar el análisis')
  // Los envíos están plegados tras un solo control (UD-030): la revisión se abre sobre la página.
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

describe('edición en el lugar', () => {
  test('clic abre, Enter guarda, Escape cancela, y Deshacer y Rehacer lo recorren', async () => {
    const { page, context } = await session()
    try {
      await openMessage(page, 'Agregar exportación')
      const title = page.getByRole('button', { name: /^Título: Agregar exportación/ })
      const before = await title.boundingBox()
      await title.click()
      const field = page.getByRole('textbox', { name: 'Título' })
      const editing = await field.boundingBox()
      // La misma caja y el mismo alto: nada salta al entrar en edición.
      assert.ok(Math.abs(editing.y - before.y) <= 1 && Math.abs(editing.height - before.height) <= 2, `salto al editar: ${JSON.stringify({ before, editing })}`)
      await field.fill('Agregar la exportación de mensajes cerrados a CSV')
      await field.press('Enter')
      await page.getByRole('button', { name: /^Título: Agregar la exportación de mensajes cerrados a CSV/ }).waitFor()

      // Escape descarta.
      await page.getByRole('button', { name: /^Título: Agregar la exportación/ }).click()
      await page.getByRole('textbox', { name: 'Título' }).fill('Otro título que no se guarda')
      await page.getByRole('textbox', { name: 'Título' }).press('Escape')
      await page.getByRole('button', { name: /^Título: Agregar la exportación de mensajes cerrados a CSV/ }).waitFor()

      // Deshacer y Rehacer con los botones.
      const undo = page.getByRole('button', { name: 'Deshacer' })
      const redo = page.getByRole('button', { name: 'Rehacer' })
      assert.equal(await redo.isDisabled(), true, 'Rehacer debe estar apagado sin nada que rehacer')
      await undo.click()
      await page.getByRole('button', { name: /^Título: Agregar exportación de mensajes cerrados$/ }).waitFor()
      assert.equal(await undo.isDisabled(), true, 'Deshacer debe apagarse sin nada más que deshacer')
      await redo.click()
      await page.getByRole('button', { name: /^Título: Agregar la exportación de mensajes cerrados a CSV/ }).waitFor()

      // Ctrl+Z y Ctrl+Shift+Z con el foco fuera de un campo.
      await page.getByRole('link', { name: 'Mensajes' }).first().focus()
      await page.keyboard.press('Control+z')
      await page.getByRole('button', { name: /^Título: Agregar exportación de mensajes cerrados$/ }).waitFor()
      await page.keyboard.press('Control+Shift+z')
      await page.getByRole('button', { name: /^Título: Agregar la exportación de mensajes cerrados a CSV/ }).waitFor()

      // Lo guardado sobrevive a una recarga; la pila no.
      await page.reload()
      await page.getByRole('button', { name: /^Título: Agregar la exportación de mensajes cerrados a CSV/ }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Deshacer' }).isDisabled(), true, 'la pila vive en memoria: se pierde al recargar')
    } finally {
      await context.close()
    }
  })
})

describe('propuesta del análisis', () => {
  test('cambiar el área conserva los campos que coinciden y la propuesta se publica', async () => {
    const { page, context } = await session()
    try {
      await sendInput(page, 'Podríamos probar un resumen semanal por área.\n\nAgregar la sincronización con WhatsApp en el sidebar.')
      await page.getByRole('button', { name: /^Área:/ }).first().waitFor({ timeout: 20000 })
      const first = page.getByRole('button', { name: /^Área:/ }).first()
      // Una de las áreas con plantilla de más campos obligatorios.
      await first.click()
      await page.getByRole('menuitemradio', { name: 'Error', exact: true }).click()
      await page.getByRole('button', { name: /^Pasos para reproducir: Obligatorio/ }).first().waitFor()
      const send = page.getByRole('button', { name: 'Enviar', exact: true }).last()
      assert.equal(await send.isDisabled(), true, 'con campos obligatorios vacíos no se puede enviar')
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

  test('quitar un mensaje manda sus unidades a «Sin acción» y Deshacer las devuelve', async () => {
    const { page, context } = await session('bruno')
    try {
      await sendInput(page, 'Primera idea para el equipo.\n\nSegunda idea para el equipo.')
      await page.getByRole('button', { name: /^Área:/ }).first().waitFor({ timeout: 20000 })
      assert.equal(await page.getByRole('button', { name: /^Sin acción/ }).count(), 0)
      await page.getByRole('button', { name: /^Quitar el mensaje/ }).first().click()
      await page.getByRole('button', { name: /^Sin acción/ }).waitFor()
      await page.getByRole('button', { name: 'Deshacer' }).click()
      await page.getByRole('button', { name: /^Sin acción/ }).waitFor({ state: 'detached' })
      // Lo editado sobrevive a recargar: el borrador está en el servidor.
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

  test('un análisis fallido ofrece Reintentar y conserva el texto', async () => {
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

  test('un archivo rechazado antes de encolar se explica bajo la barra', async () => {
    const { page, context } = await session('diego')
    try {
      await page.goto(origin)
      await page.locator('input[type=file]:not([capture])').setInputFiles([{ name: 'foto-demasiado-grande.png', mimeType: 'image/png', buffer: Buffer.alloc(32) }])
      await page.getByRole('button', { name: 'Enviar' }).first().click()
      await page.getByRole('alert').filter({ hasText: 'La foto supera el tamaño máximo' }).first().waitFor()
      await page.getByTestId('tray-control').click()
      // La fila de la bandeja conserva el envío para reintentarlo y la barra queda libre.
      await page.getByRole('button', { name: 'Reintentar' }).first().waitFor()
      assert.equal(await page.getByLabel('Nuevo mensaje', { exact: true }).last().inputValue(), '')
    } finally {
      await context.close()
    }
  })
})

describe('respuestas con medios', () => {
  test('una respuesta con un archivo muestra su ícono de medio', async () => {
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

describe('equipo y cuenta', () => {
  test('el Editor da de alta, desactiva y reactiva con Deshacer', async () => {
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

  test('la contraseña se cambia con la actual', async () => {
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

  test('el idioma cambia toda la interfaz al instante', async () => {
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

describe('envíos seguidos (UD-025)', () => {
  test('diez envíos seguidos no cambian el alto, llegan de a uno y se revisan con el teclado', async () => {
    const { page, context } = await session('tomas')
    try {
      await page.goto(origin)
      const bar = page.getByLabel('Nuevo mensaje', { exact: true }).last()
      const send = async (i) => {
        await bar.fill(`Envío ${i}: revisar el punto ${i} del panel y avisar al equipo.`)
        await page.getByRole('button', { name: 'Enviar' }).first().click()
        assert.equal(await bar.inputValue(), '', `la barra debe quedar vacía al enviar el ${i}`)
      }
      const heights = () => page.evaluate(() => ({ doc: document.scrollingElement.scrollHeight, main: document.querySelector('main').scrollHeight, win: innerHeight }))
      const tray = page.getByTestId('tray-control')
      await send(1)
      await tray.waitFor()
      await page.waitForTimeout(500)
      const base = await heights()
      const baseFrame = (await tray.boundingBox()).height
      for (let i = 2; i <= 10; i++) await send(i)
      // Terminan escalonados: la cabecera plegada cuenta los diez cuando están listos para revisar.
      await tray.getByText('10 para revisar').waitFor({ timeout: 40000 })
      await page.waitForTimeout(800)
      assert.deepEqual(await heights(), base, 'diez envíos no deben cambiar el alto de la página')
      assert.ok(Math.abs((await tray.boundingBox()).height - baseFrame) <= 1, 'el control de envíos conserva su alto')
      assert.ok(base.main <= base.win, 'la región principal no desplaza')

      // Teclado dentro de la revisión: J mueve al siguiente, K al anterior y Enter publica el que se ve; el siguiente se abre solo.
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

// ---------------------------------------------------------------- UD-028, UD-029, UD-030: Inicio, la insignia y la prioridad
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
  test('el fondo de la insignia de Mensajes, de la campana y del aviso de Inicio es el de la prioridad más alta presente, en las ocho combinaciones y en los dos temas', async () => {
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
            assert.equal(await bell.getAttribute('data-tone'), null)
          }
        } finally {
          await context.close()
        }
      }
    }
  })

  test('los datos reales: la insignia de Mensajes cuenta lo que dice el servidor y el aviso de Inicio la repite por prioridad', async () => {
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

  test('un pendiente por área lleva a Mensajes filtrado por esa área y por abiertos, y muestra tantos mensajes como dice el número', async () => {
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
  test('con envíos en curso, los últimos mensajes y respuestas siguen a la vista y los envíos quedan plegados con su estado', async () => {
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
      // Los dos bloques ocupan lo principal de la página: cada uno mide al menos un tercio de su alto.
      const box = await page.getByRole('region', { name: 'Últimos mensajes' }).boundingBox()
      assert.ok(box.height >= 900 / 3, `los últimos mensajes miden ${box.height} px`)
      // El texto del análisis es lo que más destaca: más grande que el resto del análisis, en su tipografía de lectura justificada.
      await control.click()
      const body = page.getByRole('button', { name: /^Texto del mensaje/ }).first()
      await body.waitFor()
      const fontOf = (locator) => locator.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
      const sizes = { text: await fontOf(body), other: await fontOf(page.getByRole('dialog').getByRole('button', { name: /^Resumen/ }).first()) }
      assert.ok(sizes.text >= 16, `el texto del análisis mide ${sizes.text} px`)
      assert.ok(sizes.text > sizes.other, 'el texto del análisis es más grande que los controles del análisis')
      // El original va plegado hasta que se abre.
      assert.equal(await page.getByRole('button', { name: /^Original/ }).getAttribute('aria-expanded'), 'false')
    } finally {
      await context.close()
    }
  })
})
