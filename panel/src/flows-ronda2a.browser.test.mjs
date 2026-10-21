// Round 2, judge A (J2-A-01 to J2-A-49): each flow reads what the screen shows, in a real browser, against dev-server.mjs
// serving panel/dist: `npm run test:flows`. Every test can fail if the defect it names comes back.
import assert from 'node:assert'
import { after, before, describe, test } from 'node:test'
import { login, startPanel } from './browser-support.mjs'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_2A_PORT ?? 8797), { stepMs: 80 })
  origin = panel.origin
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
  assert.ok(hit, `no hay un mensaje que empiece con «${titleStart}»`)
  return hit
}

async function openMessage(page, titleStart) {
  const hit = await messageByTitle(page, titleStart)
  await page.goto(`${origin}/messages/${hit.id}`)
  await page.locator('main h1').waitFor()
  return hit
}

const csrf = { 'x-team-request': 'panel' }

describe('entrada y navegación', () => {
  test('el error de la entrada no mueve la tarjeta, no entra al nombre del campo y marca el campo (J2-A-01, J2-A-03)', async () => {
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
      assert.ok(Math.abs(after.y - before.y) < 0.5 && Math.abs(after.height - before.height) < 0.5, `la tarjeta se movió: ${before.y}→${after.y}, alto ${before.height}→${after.height}`)
      assert.equal(await page.getByLabel('Contraseña', { exact: true }).count(), 1, 'el aviso entró al nombre del campo')
      assert.equal(await page.getByLabel('Correo').getAttribute('aria-invalid'), 'true')
      assert.equal(await page.getByLabel('Contraseña').getAttribute('aria-invalid'), null, 'el campo que no falló no se marca')
      await page.getByLabel('Correo').fill('ana@dev.invalid')
      await page.getByLabel('Contraseña').fill('')
      await page.getByRole('button', { name: 'Entrar' }).click()
      await page.getByRole('alert').filter({ hasText: 'Falta la contraseña' }).waitFor()
      assert.equal(await page.getByLabel('Contraseña').getAttribute('aria-invalid'), 'true')
      const note = await page.getByText('Las cuentas las crea el Editor del equipo').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
      assert.ok(note >= 15, `el texto de abajo mide ${note} px`)
    } finally {
      await context.close()
    }
  })

  test('no hay menú superior que repita Configuración, Tema y Cerrar sesión, y una sola forma de salir (J2-A-38, J2-A-40)', async () => {
    const { page, context } = await session()
    try {
      assert.equal(await page.getByRole('button', { name: 'Menú' }).count(), 0, 'el menú superior duplicaba la barra lateral')
      assert.equal(await page.getByText('Salir', { exact: true }).count(), 0)
      assert.equal(await page.getByRole('button', { name: 'Cerrar sesión' }).count(), 1, 'cerrar sesión tiene una sola puerta')
    } finally {
      await context.close()
    }
  })

  test('las conexiones de la barra lateral navegan y marcan la elegida (J2-A-34)', async () => {
    const { page, context } = await session()
    try {
      await page.getByRole('button', { name: 'Desplegar conexiones' }).click()
      await page.getByRole('link', { name: 'MCP' }).click()
      await page.waitForURL(/\/connections\/mcp$/)
      await page.getByRole('heading', { name: 'Conexiones', level: 1 }).waitFor()
      assert.equal(await page.getByRole('button', { name: /^MCP/ }).getAttribute('aria-current'), 'true')
      assert.equal((await page.getByText('No disponible todavía').count()) >= 5, true, 'cada conexión dice su estado')
    } finally {
      await context.close()
    }
  })

  test('lo seleccionado se ve igual en la barra lateral, en Áreas y en los controles segmentados (J2-A-41)', async () => {
    const { page, context } = await session()
    try {
      await page.goto(`${origin}/areas/a-error`)
      const bg = (loc) => loc.evaluate((el) => getComputedStyle(el).backgroundColor)
      const row = await bg(page.locator('section[aria-current="true"]'))
      const side = await bg(page.locator('nav a[aria-current="page"]').last())
      assert.equal(side, row, 'la barra lateral y la fila elegida de Áreas usan rellenos distintos')
      await page.goto(`${origin}/settings`)
      const seg = await bg(page.getByRole('radio', { checked: true }).first())
      assert.equal(seg, row, 'el control segmentado usa otro relleno para lo elegido')
    } finally {
      await context.close()
    }
  })

  test('la primera parada del teclado se ve (J2-A-48)', async () => {
    const { page, context } = await session()
    try {
      await page.goto(`${origin}/messages`)
      await page.locator('main article').first().waitFor()
      await page.keyboard.press('Tab')
      const link = page.getByRole('link', { name: 'Ir al contenido' })
      assert.equal(await link.evaluate((el) => el === document.activeElement), true)
      const box = await link.boundingBox()
      assert.ok(box && box.width > 80 && box.x >= 0 && box.y >= 0, `el atajo no se dibuja al tomar el foco: ${JSON.stringify(box)}`)
      const ring = await link.evaluate((el) => parseFloat(getComputedStyle(el).outlineWidth))
      assert.ok(ring >= 3, `el anillo de foco mide ${ring} px`)
    } finally {
      await context.close()
    }
  })
})

describe('lista de mensajes e inicio', () => {
  test('el estado va sin píldora, los destinatarios dicen «para» y «y N más», sin esferas (J2-A-05, J2-A-12)', async () => {
    const { page, context } = await session()
    try {
      await page.goto(`${origin}/messages`)
      const row = page.locator('main article').first()
      await row.waitFor()
      const bg = await row.locator('.led').first().evaluate((el) => getComputedStyle(el).backgroundColor)
      assert.equal(bg, 'rgba(0, 0, 0, 0)', 'el estado de la fila sigue siendo una píldora de color')
      assert.ok((await row.getByText('para', { exact: true }).count()) === 1, 'falta la palabra «para» ante los destinatarios')
      assert.ok((await row.getByText(/^y \d+ más$/).count()) === 1, 'el pliegue de destinatarios no dice qué es')
      const spheres = await row.evaluate((el) => el.querySelectorAll('ul[aria-label="Destinatarios"] .orb').length)
      assert.equal(spheres, 0, 'cada destinatario repite una esfera')
    } finally {
      await context.close()
    }
  })

  test('Últimas respuestas encabeza con la respuesta y deja el mensaje como contexto (J2-A-06)', async () => {
    const { page, context } = await session()
    try {
      await page.goto(origin)
      const reply = page.getByRole('region', { name: 'Últimas respuestas' }).locator('article').first()
      const message = page.getByRole('region', { name: 'Últimos mensajes' }).locator('article').first()
      await reply.waitFor()
      const size = (loc) => loc.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
      assert.ok((await size(reply.locator('h3'))) < (await size(reply.locator('p').first())), 'el título del mensaje todavía manda sobre la respuesta')
      assert.ok((await size(message.locator('h3'))) > (await size(message.locator('p').first())), 'en Últimos mensajes el título lidera')
    } finally {
      await context.close()
    }
  })

  test('el reloj de Inicio es texto corriente y la paginación es un blanco de 32 px (J2-A-08, J2-A-10)', async () => {
    const { page, context } = await session()
    try {
      await page.goto(origin)
      const clock = page.locator('time').first()
      assert.equal(await clock.evaluate((el) => getComputedStyle(el.parentElement).textTransform), 'none')
      const next = await page.getByRole('button', { name: 'Página siguiente' }).first().boundingBox()
      assert.ok(next.width >= 32 && next.height >= 32, `la flecha mide ${next.width}x${next.height}`)
    } finally {
      await context.close()
    }
  })

  test('el menú de filtro lleva su cuenta y marca lo aplicado (J2-A-13)', async () => {
    const { page, context } = await session()
    try {
      await page.goto(`${origin}/messages`)
      await page.getByRole('button', { name: 'Filtro', exact: true }).click()
      await page.getByRole('menuitemcheckbox', { name: 'Estado' }).click()
      await page.keyboard.press('Escape')
      const button = page.getByRole('button', { name: 'Filtro, 1 aplicado' })
      await button.waitFor()
      await button.click()
      assert.equal(await page.getByRole('menuitemcheckbox', { name: /^Estado/ }).getAttribute('aria-checked'), 'true')
      assert.equal(await page.getByRole('menuitemcheckbox', { name: /^Área/ }).getAttribute('aria-checked'), 'false')
    } finally {
      await context.close()
    }
  })

  test('un mensaje cerrado pesa menos que uno abierto en la lista (J2-A-15)', async () => {
    const { page, context } = await session()
    try {
      const hit = await messageByTitle(page, 'Enlace al caso')
      await page.request.post(`${origin}/api/messages/${hit.id}/close`, { headers: csrf })
      await page.goto(`${origin}/messages?q=Enlace`)
      const closed = page.locator('main article[data-closed]').first()
      await closed.waitFor()
      const weight = await closed.locator('h3').evaluate((el) => Number(getComputedStyle(el).fontWeight))
      assert.ok(weight < 600, `el título cerrado pesa ${weight}`)
      const color = await closed.locator('h3').evaluate((el) => getComputedStyle(el).color)
      await page.request.post(`${origin}/api/messages/${hit.id}/reopen`, { headers: csrf })
      await page.goto(`${origin}/messages?q=Enlace`)
      const open = page.locator('main article').first()
      await open.waitFor()
      assert.notEqual(await open.locator('h3').evaluate((el) => getComputedStyle(el).color), color, 'abierto y cerrado se leen con la misma tinta')
    } finally {
      await context.close()
    }
  })

  test('en el teléfono una tarjeta de la lista cabe en media pantalla (J2-A-16)', async () => {
    const { page, context } = await session('ana', { width: 390, height: 844 }, true)
    try {
      await page.goto(`${origin}/messages`)
      await page.locator('main article').first().waitFor()
      const heights = await page.evaluate(() => [...document.querySelectorAll('main article')].slice(0, 3).map((a) => a.getBoundingClientRect().height))
      assert.ok(Math.max(...heights) <= 844 * 0.5, `una tarjeta mide ${Math.max(...heights)} px: ${heights.join(', ')}`)
    } finally {
      await context.close()
    }
  })
})

describe('ficha', () => {
  test('cerrar con un campo obligatorio vacío no deja el aviso rojo, y se confirma con Deshacer (J2-A-17, J2-A-18)', async () => {
    const { page, context } = await session()
    try {
      const hit = await messageByTitle(page, 'Revisar la lectura')
      await page.request.patch(`${origin}/api/messages/${hit.id}`, { data: { fields: { summary: '', device: 'x' } }, headers: csrf })
      await page.goto(`${origin}/messages/${hit.id}`)
      await page.getByRole('term').filter({ hasText: 'Obligatorio' }).waitFor()
      await page.getByRole('button', { name: 'Cerrar', exact: true }).click()
      const notice = page.getByRole('status').filter({ hasText: 'Mensaje cerrado' })
      await notice.waitFor()
      assert.equal(await page.getByRole('term').filter({ hasText: 'Obligatorio' }).count(), 0, 'el aviso Obligatorio sobrevive al cierre')
      await notice.getByRole('button', { name: 'Deshacer' }).click()
      await page.getByRole('term').filter({ hasText: 'Obligatorio' }).waitFor()
      await page.request.patch(`${origin}/api/messages/${hit.id}`, { data: { fields: { summary: 'La fila se desborda.', device: 'x' } }, headers: csrf })
    } finally {
      await context.close()
    }
  })

  test('reabrir dice en qué estado queda (J2-A-18)', async () => {
    const { page, context } = await session()
    try {
      await openMessage(page, 'Confirmar el formato')
      await page.getByRole('button', { name: 'Cerrar', exact: true }).click()
      await page.getByRole('button', { name: 'Reabrir', exact: true }).click()
      await page.getByRole('status').filter({ hasText: /^Mensaje reabierto: (Abierto|Respondido)/ }).waitFor()
    } finally {
      await context.close()
    }
  })

  test('Deshacer y Rehacer pesan menos que la acción de la pantalla, y los campos se ven editables (J2-A-18, J2-A-20)', async () => {
    const { page, context } = await session()
    try {
      await openMessage(page, 'Revisar la lectura')
      await page.getByRole('button', { name: 'Cerrar', exact: true }).click()
      const group = page.getByRole('group', { name: 'Historial de cambios' })
      await group.waitFor()
      const undoBg = await group.getByRole('button', { name: 'Deshacer' }).evaluate((el) => getComputedStyle(el).backgroundColor)
      assert.equal(undoBg, 'rgba(0, 0, 0, 0)', 'Deshacer pesa como un botón principal')
      await page.getByRole('button', { name: 'Reabrir', exact: true }).click()
      const border = await page.getByRole('button', { name: /^Resumen: / }).evaluate((el) => getComputedStyle(el).borderTopColor)
      assert.notEqual(border, 'rgba(0, 0, 0, 0)', 'un campo lleno no tiene pista de que se edita')
    } finally {
      await context.close()
    }
  })

  test('en el teléfono las acciones van arriba, sin nada entre el título y lo que describe, y al menos tres filas de chips caben (J2-A-21)', async () => {
    const { page, context } = await session('ana', { width: 390, height: 844 }, true)
    try {
      await openMessage(page, 'Revisar la lectura')
      const close = await page.getByRole('button', { name: 'Cerrar', exact: true }).boundingBox()
      const title = await page.locator('main h1').boundingBox()
      assert.ok(close.y + close.height <= title.y, `Cerrar queda entre el título y los datos: ${close.y} contra ${title.y}`)
      const chips = await page.getByRole('list', { name: 'Destinatarios' }).boundingBox()
      assert.ok(chips.height <= 130, `los destinatarios ocupan ${chips.height} px`)
      assert.ok((await page.getByRole('button', { name: /^Quitar a / }).first().isVisible()), 'la × de un destinatario no se dibuja')
    } finally {
      await context.close()
    }
  })

  test('los medios de la respuesta van dentro de su marco y debajo sólo quedan el tipo y Responder (J2-A-22)', async () => {
    const { page, context } = await session('bruno')
    try {
      await openMessage(page, 'Revisar la lectura')
      const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Responder' }) })
      const attach = await form.getByRole('button', { name: /Adjuntar/ }).boundingBox()
      const send = await form.getByRole('button', { name: 'Responder', exact: true }).boundingBox()
      assert.ok(attach.y < send.y - 10, 'el clip sigue en la fila del botón Responder')
    } finally {
      await context.close()
    }
  })
})

describe('áreas, plantillas y configuración', () => {
  test('eliminar una plantilla deja en su lugar la fila con Deshacer (J2-A-23)', async () => {
    const { page, context } = await session()
    try {
      await page.goto(`${origin}/areas/a-error`)
      const templates = page.getByRole('region', { name: 'Plantillas' })
      await templates.getByRole('button', { name: /^Eliminar / }).first().click()
      const row = templates.getByRole('status').filter({ hasText: 'eliminada' })
      await row.waitFor()
      const rowBox = await row.boundingBox()
      const header = await templates.getByRole('heading', { name: /Plantillas/ }).boundingBox()
      assert.ok(rowBox.y - header.y < 120, `el aviso queda a ${rowBox.y - header.y} px de la acción`)
      await row.getByRole('button', { name: 'Deshacer' }).click()
      await row.waitFor({ state: 'detached' })
      await templates.getByRole('button', { name: /^Eliminar / }).first().waitFor()
    } finally {
      await context.close()
    }
  })

  test('la ventana de campos guarda al instante, lo dice y se cierra con Listo; sin casillas del navegador (J2-A-24)', async () => {
    const { page, context } = await session()
    try {
      await page.goto(`${origin}/areas/a-error`)
      await page.getByRole('button', { name: /^Campos e instrucciones/ }).first().click()
      const dialog = page.getByRole('dialog')
      assert.equal(await dialog.locator('input[type=checkbox]').count(), 0, 'quedan casillas nativas del navegador')
      assert.equal(await dialog.getByText('Guardado').count(), 0, 'dice «Guardado» sin haber guardado nada')
      await dialog.getByRole('checkbox', { name: 'Obligatorio' }).first().click()
      await dialog.getByText('Guardado').waitFor()
      await dialog.getByRole('checkbox', { name: 'Obligatorio' }).first().click()
      await dialog.getByRole('button', { name: 'Listo' }).click()
      await dialog.waitFor({ state: 'detached' })
    } finally {
      await context.close()
    }
  })

  test('una plantilla nueva muestra las instrucciones como la edición, sin almohadillas (J2-A-25)', async () => {
    const { page, context } = await session()
    try {
      await page.goto(`${origin}/areas/a-error`)
      await page.getByRole('region', { name: 'Plantillas' }).getByRole('button', { name: 'Plantilla', exact: true }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('heading', { name: 'Método' }).waitFor()
      assert.ok(!(await dialog.innerText()).includes('## '), 'se ve Markdown crudo')
    } finally {
      await context.close()
    }
  })

  test('«Sin plantillas» trae su propia acción, y el cero pesa igual que los demás pendientes (J2-A-26, J2-A-49)', async () => {
    const { page, context } = await session()
    try {
      const made = await page.request.post(`${origin}/api/areas`, { data: { title: 'Área vacía de prueba', description: 'Sin plantillas.' }, headers: csrf })
      const area = await made.json()
      await page.goto(`${origin}/areas/${area.id}`)
      const empty = page.getByRole('region', { name: 'Plantillas' }).getByRole('status').filter({ hasText: 'Sin plantillas' })
      await empty.waitFor()
      await empty.getByRole('button', { name: 'Plantilla' }).click()
      await page.getByRole('dialog').getByLabel('Nombre').waitFor()
      await page.keyboard.press('Escape')
      const weights = await page.locator('section[aria-current], section').filter({ hasText: /pendiente/ }).evaluateAll((els) => els.map((el) => [...el.querySelectorAll('span')].filter((s) => /pendiente/.test(s.textContent)).map((s) => getComputedStyle(s).fontWeight + getComputedStyle(s).color).join()))
      assert.equal(new Set(weights.filter(Boolean)).size, 1, `los pendientes no pesan igual: ${weights.join(' | ')}`)
    } finally {
      await context.close()
    }
  })

  test('un proveedor sin llave dice qué hacer con el peso del cuerpo y no con una píldora (J2-A-31, J2-A-32)', async () => {
    const { page, context } = await session()
    try {
      await page.goto(`${origin}/settings`)
      const word = page.getByText('No disponible', { exact: true }).first()
      await word.waitFor()
      const size = await word.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
      assert.ok(size >= 15, `«No disponible» mide ${size} px`)
      const detail = page.getByText(/Falta \w+_API_KEY en el servidor/)
      assert.equal(await detail.evaluate((el) => parseFloat(getComputedStyle(el).fontSize) >= 15 && !getComputedStyle(el).fontFamily.includes('mono')), true)
      const border = await page.getByRole('button', { name: 'Proveedor de Texto' }).evaluate((el) => getComputedStyle(el).borderTopWidth)
      assert.equal(border, '1px', 'el selector de proveedor no parece un control')
    } finally {
      await context.close()
    }
  })

  test('reemplazar la descripción del proyecto se confirma con Deshacer, y es una acción callada (J2-A-30)', async () => {
    const { page, context } = await session()
    try {
      await page.goto(`${origin}/settings`)
      const button = page.getByRole('button', { name: 'Reemplazar con .md' })
      assert.equal(await button.evaluate((el) => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', 'pesa como un botón principal')
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

describe('equipo', () => {
  test('el perfil se lee en el cuerpo, no hay idioma de relleno y Desactivar es una acción callada con su aviso (J2-A-35, J2-A-36, J2-A-37)', async () => {
    const { page, context } = await session()
    try {
      await page.goto(`${origin}/team`)
      await page.locator('main').getByText('Bruno Prueba').first().waitFor()
      assert.equal(await page.getByText(/^Idioma: /).count(), 0, 'la fila repite el idioma de la cuenta')
      const profile = page.getByText('Me encargo de la interfaz del panel')
      assert.ok((await profile.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))) >= 15, 'el perfil se lee a menos de 15 px')
      const off = page.getByRole('button', { name: /^Desactivar a / }).first()
      assert.equal(await off.evaluate((el) => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', 'Desactivar pesa como un botón principal')
      await off.click()
      await page.getByRole('status').filter({ hasText: /desactivado/ }).getByRole('button', { name: 'Deshacer' }).click()
      await page.getByText('Inactivo').first().waitFor({ state: 'detached' })
    } finally {
      await context.close()
    }
  })
})

describe('estados', () => {
  test('una carga lenta reserva el lugar de las filas y un error trae icono, motivo y Reintentar (J2-A-46, J2-A-47)', async () => {
    const { page, context } = await session()
    try {
      let fail = true
      await page.route(/\/api\/messages(\?|$)/, async (route) => {
        await new Promise((r) => setTimeout(r, 400))
        if (fail) await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Fallo de prueba' } }) })
        else await route.continue()
      })
      await page.goto(`${origin}/messages`)
      const waiting = page.getByRole('status', { name: 'Cargando' })
      await waiting.waitFor()
      assert.ok((await waiting.boundingBox()).height >= 120, 'la espera no reserva el lugar de las filas')
      const alert = page.getByRole('alert').filter({ hasText: 'No se pudo cargar' })
      await alert.waitFor({ timeout: 15000 })
      assert.equal(await alert.locator(':scope > svg').count(), 1, 'el error no lleva icono')
      fail = false
      await alert.getByRole('button', { name: 'Reintentar' }).click()
      await page.locator('main article').first().waitFor()
      await page.unrouteAll({ behavior: 'ignoreErrors' })
    } finally {
      await context.close()
    }
  })

  test('la barra lateral no se mueve cuando llegan los contadores (J2-A-47)', async () => {
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
      await page.waitForTimeout(400)
      const tops = () => page.evaluate(() => [...document.querySelectorAll('nav > a, nav > div > div > a, nav li > a')].map((a) => Math.round(a.getBoundingClientRect().top)))
      const before = await tops()
      release()
      await page.getByTestId('messages-badge').waitFor()
      await page.waitForTimeout(300)
      const after = (await tops()).slice(0, before.length)
      assert.deepEqual(after, before, 'algo de la barra lateral se corrió al llegar los números')
      await page.unrouteAll({ behavior: 'ignoreErrors' })
    } finally {
      await context.close()
    }
  })

  test('la ficha ordena el texto del mensaje sobre los campos y los datos, y la marca pesa menos (J2-A-19, J2-A-42)', async () => {
    const { page, context } = await session()
    try {
      await openMessage(page, 'Revisar la lectura')
      const size = (loc) => loc.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
      const body = await size(page.getByRole('button', { name: /^Texto: / }))
      const field = await size(page.getByRole('button', { name: /^Resumen: / }))
      const meta = await size(page.locator('time').first())
      assert.ok(body > field && field > meta, `texto ${body}, campo ${field}, dato ${meta}`)
      const chip = await page.getByRole('list', { name: 'Destinatarios' }).locator('li').first().evaluate((el) => getComputedStyle(el).backgroundColor)
      const state = await page.locator('.led').first().evaluate((el) => getComputedStyle(el).backgroundColor)
      assert.notEqual(chip, state, 'los chips de personas y el estado comparten relleno')
      const mark = await page.getByRole('link', { name: /Team$/i }).first().evaluate((el) => getComputedStyle(el.firstElementChild).fontWeight)
      assert.ok(Number(mark) <= 600, `la marca pesa ${mark}`)
    } finally {
      await context.close()
    }
  })
})
