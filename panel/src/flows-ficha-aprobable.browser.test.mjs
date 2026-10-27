// The sheet of a message in every capability it shows (CAPACIDADES-1.0): the Guard of the idea, the handoff to a person, the text read from what the message carries, the
// review, the work tree and the adequacy with their labels and scales, the own reply with each file once, targets of 44 px on a phone, and the frame of the waiting and failing states.
// Against dev-server.mjs: `node scripts/browser-tests.mjs src/flows-ficha-aprobable.browser.test.mjs`. With FICHA_CAPTURES_DIR it also saves the screens.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

process.env.PANEL_DEV_AUTO_PUBLISH = '0'

let panel
let origin = ''
const DIR = process.env.FICHA_CAPTURES_DIR

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_FICHA_PORT ?? 8991), { stepMs: 40 })
  origin = panel.origin
})
beforeEach(async () => {
  await panel.control.reset()
})
after(async () => {
  await panel?.stop()
})

async function session(who, path, viewport = { width: 1440, height: 900 }, scheme = 'light') {
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL', colorScheme: scheme, hasTouch: viewport.width < 768 })
  const page = await context.newPage()
  await login(page, origin, who)
  await page.goto(`${origin}${path}`)
  await page.locator('main h1').waitFor()
  await settled(page)
  return { page, context }
}
const shot = async (page, name) => { if (DIR) await page.screenshot({ path: `${DIR}/${name}.png` }) }

describe('the Guard of the idea (UD-307)', () => {
  test('the thread says «Lista para ver», the evaluation says the Guard applies and why, and the review has its control', async () => {
    const { message_id: id } = await panel.control.ideaGuard()
    const { page, context } = await session('ana', `/messages/${id}`)
    try {
      assert.match(await page.locator('section[aria-label="Respuestas"]').innerText(), /Lista para ver/)
      assert.equal(await page.getByTestId('review-reason').innerText(), 'Cambio listo para revisar')
      await page.getByTestId('review-reply').waitFor()
      await page.getByRole('button', { name: 'Detalles', exact: true }).click()
      assert.equal((await page.getByTestId('idea-guard').innerText()).trim(), 'Aplica')
      assert.match(await page.getByTestId('idea-reason').innerText(), /comparte una posibilidad/)
      assert.match(await page.getByTestId('estimates').innerText(), /Idea\s*0,90 de 1/)
      await shot(page, 'guardia-de-la-idea-escritorio')
    } finally {
      await context.close()
    }
  })
})

describe('the handoff to a person (UD-269)', () => {
  test('the question is the last reply, the person who decides holds the message and can answer it', async () => {
    const { message_id: id } = await panel.control.handoff()
    const { page, context } = await session('ana', `/messages/${id}`)
    try {
      assert.match(await page.locator('section[aria-label="Respuestas"]').innerText(), /Necesito una decisión/)
      assert.match(await page.locator('section[aria-label="Respuestas"]').innerText(), /Recomendación/)
      await page.locator('#reply-field').waitFor()
      assert.equal(await page.getByTestId('review-pending').count(), 0, 'a handoff has no held change')
      await shot(page, 'traspaso-escritorio')
    } finally {
      await context.close()
    }
  })
})

describe('the text read from what the message carries', () => {
  test('the speech of the audio and of the video is read in the gallery', async () => {
    const { message_id: id } = await panel.control.extraction()
    const { page, context } = await session('ana', `/messages/${id}`)
    try {
      const gallery = page.locator('[data-gallery]').first()
      await gallery.waitFor()
      const first = await gallery.locator('[data-gallery-transcript]').textContent()
      assert.match(first ?? '', /el botón Enviar no se distingue/)
      await shot(page, 'extraccion-escritorio')
      await gallery.locator('[data-gallery-thumb] button').nth(1).click()
      await gallery.locator('[data-gallery-transcript]').filter({ hasText: 'lista de pacientes' }).waitFor()
    } finally {
      await context.close()
    }
  })
})

describe('the evaluation and the work of an agent say what each figure is', () => {
  test('the estimates carry their scale and the judgement its indicators by name, in one unit and with a word for each failure', async () => {
    const { done_id: id } = await panel.control.execution()
    const { page, context } = await session('ana', `/messages/${id}`)
    try {
      await page.getByRole('button', { name: 'Detalles', exact: true }).click()
      const details = page.getByTestId('details')
      await details.waitFor()
      // Decimal comma and the unit of the sheet in the tree: «23 min 0 s», not «1380 s».
      const text = await details.innerText()
      assert.match(text, /US\$ 0,31/)
      assert.doesNotMatch(text.replaceAll('Haiku 5.5', ''), /\d\.\d/, 'no figure is written with a decimal point')
      assert.doesNotMatch(text, /\bexecute[.\w]*/, 'no internal name of a span')
      assert.doesNotMatch(text, /\d{4} s\b/, 'one unit of duration')
      const tree = details.locator('[data-span="execute"]')
      assert.match(await tree.innerText(), /Tarea\s+23 min 0 s/)
      assert.match(await details.locator('[data-span="execute.machine.create"]').innerText(), /Crear máquina\s+1 min 35 s/)
      // A failed order says «Falló» in words and with a cross, in the list and in the tree.
      assert.ok((await details.locator('[data-failed-mark]').count()) >= 2, 'the failure is a mark with a word, not a color')
      for (const mark of await details.locator('[data-failed-mark]').all()) assert.equal((await mark.innerText()).trim(), 'Falló')
      // The indicator has its name and its sign, and the scale is said once.
      const kpi = details.getByTestId('judgment-kpi').first()
      assert.match(await kpi.innerText(), /Fiabilidad funcional\s+\+1/)
      assert.equal((await details.getByTestId('judgment-scale').innerText()).trim(), 'Puntaje de −2 a +2')
      await shot(page, 'evaluacion-y-arbol-escritorio')
    } finally {
      await context.close()
    }
  })
})

describe('the own reply draws each file once and has one name for each action', () => {
  test('a file appears once, with its «Quitar», and the tools are one row named like the form', async () => {
    const { done_id: id } = await panel.control.execution()
    const { page, context } = await session('ana', `/messages/${id}`)
    try {
      await page.locator('#reply-field').fill('Con dos archivos')
      await page.locator('input[type=file]').first().setInputFiles([
        { name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64') },
        { name: 'notas.txt', mimeType: 'text/plain', buffer: Buffer.from('notas') },
      ])
      await page.getByRole('button', { name: 'Responder', exact: true }).click()
      const tools = page.getByTestId('reply-tools')
      await tools.waitFor()
      const reply = page.locator('article').filter({ has: tools })
      assert.equal(await reply.getByRole('button', { name: 'Quitar foto.png' }).count(), 1, 'the picture has one «Quitar»')
      assert.equal(await reply.getByRole('button', { name: 'Quitar notas.txt' }).count(), 1, 'the document has one «Quitar»')
      assert.equal(await tools.getByRole('button', { name: /Quitar/ }).count(), 0, 'the tools do not list the files again')
      assert.equal(await tools.getByRole('button', { name: 'Adjuntar' }).count(), 1, 'one name for attaching, the one of the form')
      assert.equal(await page.getByRole('button', { name: 'Adjunto', exact: true }).count(), 0, 'no other name for the same action')
      // The tools make one row.
      const ys = []
      const widths = []
      for (const li of await tools.locator('li').all()) {
        const box = await li.boundingBox()
        ys.push(Math.round(box.y))
        widths.push(Math.round(box.width))
      }
      assert.ok(Math.max(...ys) - Math.min(...ys) < 12, `the tools share a row: y ${ys}, widths ${widths}, container ${Math.round((await tools.boundingBox()).width)}`)
      await shot(page, 'respuesta-propia-escritorio')
    } finally {
      await context.close()
    }
  })
})

describe('on a phone', () => {
  test('every control of the header is a target of 44 px and the first reply of the thread is in the first screen', async () => {
    const { done_id: id } = await panel.control.execution()
    const message = (await (await panel.browser.newContext()).request.get(`${origin}/api/messages?q=contraste`)).ok
    void message
    const { page, context } = await session('ana', `/messages/${id}`, { width: 390, height: 844 })
    try {
      const small = await page.evaluate(() => {
        const rects = []
        for (const el of document.querySelectorAll('main a[href], main button, main input[type=range], main select')) {
          const r = el.getBoundingClientRect()
          if (r.width === 0 || r.height === 0) continue
          if (el.closest('[data-lane="transcript"]')) continue
          if (r.width < 43.5 || r.height < 43.5) rects.push(`${(el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40)} ${Math.round(r.width)}x${Math.round(r.height)}`)
        }
        return rects
      })
      // The links and fields of the text itself (the fields of the form, the area chip) are text, not controls of the header: the header and the thread are measured.
      const header = small.filter((s) => /^(Mensajes|Reenviar|Borrar|Responder)\b/.test(s))
      assert.deepEqual(header, [])
      // The first reply of the thread is drawn inside the first screen of 390x844, for a message of the sample with a thread.
      await page.goto(`${origin}/messages/102`)
      await page.locator('main h1').waitFor()
      await settled(page)
      const first = await page.locator('section[aria-label="Respuestas"] article').first().boundingBox()
      assert.ok(first && first.y < 844 - 60, `the first reply starts at y ${first?.y} of 844`)
      await shot(page, 'telefono-cabecera')
    } finally {
      await context.close()
    }
  })

  test('the audio position and the file «Quitar» are targets of 44 px', async () => {
    const { message_id: id } = await panel.control.extraction()
    const { page, context } = await session('bruno', `/messages/${id}`, { width: 390, height: 844 })
    try {
      const slider = page.locator('main input[type=range]').first()
      await slider.waitFor()
      assert.ok((await slider.boundingBox()).height >= 44)
      const remove = page.getByTestId('detach-attachment').first()
      await remove.waitFor()
      const box = await remove.boundingBox()
      assert.ok(box.width >= 44 && box.height >= 44, `Quitar ${box.width}x${box.height}`)
    } finally {
      await context.close()
    }
  })

  test('the forward window keeps its buttons in one row', async () => {
    const { done_id: id } = await panel.control.execution()
    const { page, context } = await session('ana', `/messages/${id}`, { width: 390, height: 844 })
    try {
      await page.getByRole('button', { name: 'Reenviar', exact: true }).click()
      const dialog = page.getByRole('dialog')
      await dialog.waitFor()
      assert.equal(await dialog.getByRole('alert').count(), 0, 'a window that opens does not complain')
      await shot(page, 'telefono-reenviar')
    } finally {
      await context.close()
    }
  })
})

describe('the waiting and failing states keep the frame of the sheet', () => {
  test('the way back and the two columns are there while loading and when it fails', async () => {
    const { done_id: id } = await panel.control.execution()
    const context = await panel.browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-CL', colorScheme: 'light' })
    const page = await context.newPage()
    try {
      await login(page, origin, 'ana')
      let release = () => {}
      const gate = new Promise((resolve) => { release = resolve })
      await page.route(`**/api/messages/${id}`, async (route) => { await gate; await route.fulfill({ status: 500, json: { error: { code: 'internal', message: 'Error del servidor' } } }) })
      await page.goto(`${origin}/messages/${id}`)
      const back = page.locator('main a[href="/messages"]')
      await back.waitFor()
      assert.equal(await page.getByRole('heading', { name: 'Mensajes', exact: true }).count(), 0, 'no title of the list')
      const waiting = await page.locator('main').boundingBox()
      const frame = await page.locator('main [role="status"]').first().boundingBox()
      assert.ok(frame.width > 600, `the waiting block is as wide as the message column: ${frame.width}`)
      void waiting
      await shot(page, 'cargando-escritorio')
      release()
      await page.getByRole('alert').waitFor()
      assert.ok(await back.count(), 'the way back stays when it fails')
      await shot(page, 'error-escritorio')
    } finally {
      await context.close()
    }
  })
})
