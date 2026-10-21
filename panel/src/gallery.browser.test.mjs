// H-1200: the media gallery, in a real browser against dev-server.mjs serving panel/dist with the gallery sample data
// (PANEL_DEV_MEDIA=1): `npm run test:gallery`. Every wait is for an event the page itself produces (a counter that changes,
// a video that loads its first frame, a window that opens); none is for a number of milliseconds.
// With GALLERY_CAPTURES=<directory> it also leaves screenshots at 1440x900 and 390x844, light and dark.
import assert from 'node:assert'
import { mkdirSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { login, startPanel } from './browser-support.mjs'

// These tests go through the review of a proposal, which is what the server does with publication by hand (UD-070): they start it with auto-publication off.
// The automatic path has its own file, `flows-inicio.browser.test.mjs`.
process.env.PANEL_DEV_AUTO_PUBLISH ??= '0'

process.env.PANEL_DEV_MEDIA = '1'
const CAPTURES = process.env.GALLERY_CAPTURES
let panel
let origin = ''

before(async () => {
  if (CAPTURES) mkdirSync(CAPTURES, { recursive: true })
  panel = await startPanel(Number(process.env.PANEL_GALLERY_PORT ?? 8934))
  origin = panel.origin
})
after(async () => {
  await panel?.stop()
})

async function session(who = 'ana', viewport = { width: 1440, height: 900 }, { mobile = false, scheme = 'light' } = {}) {
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL', colorScheme: scheme, isMobile: mobile, hasTouch: mobile })
  const page = await context.newPage()
  await login(page, origin, who)
  return { page, context }
}

/** Opens the detail of the sample message with this title. */
async function openMessage(page, title) {
  const body = await (await page.request.get(`${origin}/api/messages?limit=200`)).json()
  const found = (body.items ?? body).find((m) => m.title === title)
  assert.ok(found, `the message «${title}» exists`)
  await page.goto(`${origin}/messages/${found.id}`)
  await page.locator('[data-gallery]').first().waitFor()
}

const gallery = (page) => page.locator('[data-gallery]').first()
const counter = (page) => gallery(page).locator('[data-gallery-count]')
const thumbs = (page) => gallery(page).locator('[data-gallery-thumb] button')
const shot = async (page, name) => {
  if (CAPTURES) await page.screenshot({ path: `${CAPTURES}/${name}.png` })
}
/** Waits until the counter of the gallery says «n de total». */
const until = (page, n, total) => counter(page).filter({ hasText: `${n} de ${total}` }).waitFor()

describe('selection and navigation', () => {
  test('six photos: one viewer, six thumbnails, the current one marked, and the counter follows every way of moving', async () => {
    const { page, context } = await session()
    try {
      await openMessage(page, 'Galería de seis fotos')
      assert.equal(await thumbs(page).count(), 6)
      await until(page, 1, 6)
      assert.equal(await thumbs(page).nth(0).getAttribute('aria-current'), 'true')
      assert.equal(await gallery(page).locator('[data-gallery-viewer] img').count() > 0, true, 'the viewer draws the chosen photo')
      // Next arrow.
      await gallery(page).getByRole('button', { name: 'Siguiente' }).click()
      await until(page, 2, 6)
      assert.equal(await thumbs(page).nth(1).getAttribute('aria-current'), 'true')
      assert.equal(await thumbs(page).nth(0).getAttribute('aria-current'), null, 'only one thumbnail is marked')
      // A thumbnail.
      await thumbs(page).nth(4).click()
      await until(page, 5, 6)
      // Keyboard on the viewer: arrows, Home and End; the ends are felt (the arrow is off), the gallery does not loop.
      await gallery(page).locator('[data-gallery-viewer]').focus()
      await page.keyboard.press('ArrowRight')
      await until(page, 6, 6)
      assert.equal(await gallery(page).getByRole('button', { name: 'Siguiente' }).isDisabled(), true)
      await page.keyboard.press('ArrowRight')
      await until(page, 6, 6)
      await page.keyboard.press('Home')
      await until(page, 1, 6)
      assert.equal(await gallery(page).getByRole('button', { name: 'Anterior' }).isDisabled(), true)
      await page.keyboard.press('End')
      await until(page, 6, 6)
      await page.keyboard.press('ArrowLeft')
      await until(page, 5, 6)
      // The strip brings the current thumbnail into view.
      const inView = await thumbs(page).nth(4).evaluate((el) => {
        const list = el.closest('ul').getBoundingClientRect()
        const r = el.getBoundingClientRect()
        return r.left >= list.left - 1 && r.right <= list.right + 1
      })
      assert.equal(inView, true, 'the current thumbnail is in view in the carousel')
      await shot(page, 'detalle-seis-fotos-1440-claro')
    } finally {
      await context.close()
    }
  })

  test('a swipe on a phone moves the viewer: the slide that is in view becomes the current one', async () => {
    const { page, context } = await session('ana', { width: 390, height: 844 }, { mobile: true })
    try {
      await openMessage(page, 'Galería de seis fotos')
      await until(page, 1, 6)
      // A touch swipe is the browser's own scroll of the snapping track: it is the same thing as moving the track.
      await gallery(page).locator('[data-gallery-viewer]').evaluate((el) => el.scrollTo({ left: el.clientWidth * 2, behavior: 'instant' }))
      await until(page, 3, 6)
      assert.equal(await thumbs(page).nth(2).getAttribute('aria-current'), 'true')
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
      assert.equal(overflow, false, 'the page does not scroll sideways')
      await shot(page, 'detalle-seis-fotos-390-claro')
    } finally {
      await context.close()
    }
  })

  test('one medium has no carousel: no arrows, no counter and no strip', async () => {
    const { page, context } = await session()
    try {
      await openMessage(page, 'Una sola foto')
      assert.equal(await thumbs(page).count(), 0)
      assert.equal(await gallery(page).getByRole('button', { name: 'Siguiente' }).count(), 0)
      assert.equal(await counter(page).count(), 0)
      assert.equal(await gallery(page).locator('[data-gallery-viewer] img').count(), 1)
    } finally {
      await context.close()
    }
  })

  test('a photo enlarges and Escape brings it back to the frame without closing the window around it', async () => {
    const { page, context } = await session()
    try {
      await page.goto(`${origin}/messages`)
      await page.getByRole('button', { name: 'Ver los 6 medios' }).first().click()
      const dialog = page.getByRole('dialog')
      await dialog.locator('[data-gallery-viewer] img').first().waitFor()
      await dialog.getByRole('button', { name: 'Ampliar', exact: true }).click()
      await dialog.locator('[data-gallery-zoomed]').waitFor()
      await page.keyboard.press('Escape')
      await dialog.locator('[data-gallery-zoomed]').waitFor({ state: 'detached' })
      assert.equal(await dialog.count(), 1, 'the window is still open')
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'detached' })
    } finally {
      await context.close()
    }
  })
})

describe('one screen (UD-017)', () => {
  test('the detail with a gallery fits 1280x720 and 1440x900 without scrolling the page', async () => {
    for (const viewport of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }]) {
      const { page, context } = await session('ana', viewport)
      try {
        await openMessage(page, 'Galería de seis fotos')
        await until(page, 1, 6)
        const over = await page.evaluate(() => ({ doc: document.scrollingElement.scrollHeight - innerHeight, main: (() => { const m = document.querySelector('main'); return m.scrollHeight - m.clientHeight })() }))
        assert.ok(over.doc <= 0 && over.main <= 0, `${viewport.width}x${viewport.height}: ${JSON.stringify(over)} px too many`)
      } finally {
        await context.close()
      }
    }
  })
})

describe('each kind of medium', () => {
  test('photos mixed with a video: the video shows its controls and loads its first frame', async () => {
    const { page, context } = await session()
    try {
      await openMessage(page, 'Fotos mezcladas con un video')
      assert.equal(await thumbs(page).count(), 4)
      await thumbs(page).nth(1).click()
      await until(page, 2, 4)
      const video = gallery(page).locator('[data-gallery-viewer] video[controls]')
      await video.waitFor()
      await page.waitForFunction(() => [...document.querySelectorAll('[data-gallery-viewer] video')].some((v) => v.readyState >= 2), null, { polling: 'raf' })
      await shot(page, 'detalle-fotos-y-video-1440-claro')
      // Leaving the video takes its controls away, so it stops being reachable and does not play behind another photo.
      await thumbs(page).nth(2).click()
      await until(page, 3, 4)
      assert.equal(await gallery(page).locator('[data-gallery-viewer] video[controls]').count(), 0)
    } finally {
      await context.close()
    }
  })

  test('an audio shows its player and, because the server has one, its transcript', async () => {
    const { page, context } = await session()
    try {
      await openMessage(page, 'Nota de voz con su transcripción')
      await gallery(page).getByRole('button', { name: /^Reproducir/ }).waitFor()
      const text = await gallery(page).locator('[data-gallery-transcript]').textContent()
      assert.match(text ?? '', /el botón Enviar no se distingue/)
      await shot(page, 'detalle-audio-1440-claro')
    } finally {
      await context.close()
    }
  })

  test('a document names itself, a broken photo says so and can be retried, and a link shows its domain', async () => {
    const { page, context } = await session()
    try {
      await openMessage(page, 'Informe en PDF y una foto dañada')
      await until(page, 1, 3)
      await gallery(page).getByText('informe-del-cliente.pdf').first().waitFor()
      assert.equal(await gallery(page).getByRole('link', { name: 'Abrir informe-del-cliente.pdf' }).count(), 1)
      await thumbs(page).nth(1).click()
      await until(page, 2, 3)
      const alert = gallery(page).getByRole('alert')
      await alert.waitFor()
      assert.match((await alert.textContent()) ?? '', /No se pudo cargar/)
      await alert.getByRole('button', { name: 'Reintentar' }).click()
      await alert.waitFor() // the file is still broken: it fails again, and says so again
      await thumbs(page).nth(2).click()
      await until(page, 3, 3)
      await gallery(page).getByText('github.com', { exact: true }).waitFor()
      await shot(page, 'detalle-documento-enlace-1440-claro')
    } finally {
      await context.close()
    }
  })
})

describe('where the gallery is used', () => {
  test('a row of the list opens the gallery on its media, with the count on the thumbnail', async () => {
    const { page, context } = await session()
    try {
      await page.goto(`${origin}/messages`)
      const opener = page.getByRole('button', { name: 'Ver los 6 medios' }).first()
      await opener.waitFor()
      assert.match((await opener.textContent()) ?? '', /6/)
      await opener.click()
      const dialog = page.getByRole('dialog')
      await dialog.locator('[data-gallery]').waitFor()
      assert.equal(await dialog.locator('[data-gallery-thumb]').count(), 6)
      await shot(page, 'lista-galeria-1440-claro')
    } finally {
      await context.close()
    }
  })

  test('the replies of a message open the gallery of what they carry, from their own id space', async () => {
    const { page, context } = await session()
    try {
      await openMessage(page, 'Revisar la lectura del panel en teléfonos pequeños con el tamaño de letra del sistema al máximo y el tema oscuro activado')
      const reply = page.getByRole('region', { name: 'Respuestas' }).getByRole('list', { name: 'Adjuntos' }).first()
      await reply.getByRole('button').first().click()
      const dialog = page.getByRole('dialog')
      await dialog.locator('[data-gallery]').waitFor()
      const src = await dialog.locator('[data-gallery-viewer] img, [data-gallery-viewer] audio, [data-gallery-viewer] video').first().getAttribute('src')
      assert.match(src ?? '', /\/api\/replies\/attachments\//)
    } finally {
      await context.close()
    }
  })

  test('the picker of a proposed message opens the gallery over what that message carries', async () => {
    const { page, context } = await session('carla')
    try {
      const sent = await page.evaluate(async (files) => {
        const form = new FormData()
        form.append('text', 'Corregir el contraste del botón Enviar y revisar el orden de las áreas.')
        for (const f of files) form.append('files', new File([f.svg], f.name, { type: 'image/svg+xml' }))
        return (await fetch('/api/inputs', { method: 'POST', headers: { 'X-Team-Request': 'panel' }, body: form, credentials: 'include' })).ok
      }, [30, 200].map((h) => ({ name: `captura-${h}.svg`, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="hsl(${h} 50% 70%)"/></svg>` })))
      assert.ok(sent, 'the submission with two photos is created')
      await page.goto(origin)
      await page.getByTestId('tray-control').click()
      await page.getByRole('button', { name: /^Área:/ }).first().waitFor({ timeout: 40000 })
      const list = page.getByTestId('send-drawer').locator('section[aria-label="Análisis"]').getByRole('list', { name: 'Adjuntos' }).last()
      await list.getByRole('button', { name: /^Ver 1 de/ }).first().click()
      const inner = page.getByRole('dialog').last()
      await inner.locator('[data-gallery]').waitFor()
      assert.ok((await inner.locator('[data-gallery-viewer] img').count()) > 0)
    } finally {
      await context.close()
    }
  })
})

describe('captures', () => {
  test('dark theme and phone width of the gallery in a window', { skip: !CAPTURES }, async () => {
    for (const [name, viewport, mobile, scheme] of [
      ['oscuro-1440', { width: 1440, height: 900 }, false, 'dark'],
      ['oscuro-390', { width: 390, height: 844 }, true, 'dark'],
      ['claro-390', { width: 390, height: 844 }, true, 'light'],
    ]) {
      const { page, context } = await session('ana', viewport, { mobile, scheme })
      try {
        await openMessage(page, 'Fotos mezcladas con un video')
        await thumbs(page).nth(1).click()
        await until(page, 2, 4)
        await shot(page, `detalle-fotos-y-video-${name}`)
        await page.goto(`${origin}/messages`)
        const opener = page.getByRole('button', { name: /^Ver los \d+ medios/ }).first()
        await opener.waitFor()
        await opener.click()
        await page.getByRole('dialog').locator('[data-gallery]').waitFor()
        await shot(page, `ventana-galeria-${name}`)
      } finally {
        await context.close()
      }
    }
  })
})
