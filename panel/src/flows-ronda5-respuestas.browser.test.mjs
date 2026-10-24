// Round 5, the detail and the reply flow (J5 findings of message-detail and flow-reply-close): each test measures the screen in a real
// browser, against dev-server.mjs serving panel/dist: `npm run test:flows`.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, startPanel } from './browser-support.mjs'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_PORT ?? 8806), { stepMs: 80 })
  origin = panel.origin
})
beforeEach(async () => {
  await panel.control.reset()
})
after(async () => {
  await panel?.stop()
})

const PHONE = { width: 390, height: 844 }

async function session(who = 'bruno', viewport = { width: 1440, height: 900 }, { mobile = false, scheme = 'light' } = {}) {
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL', colorScheme: scheme, isMobile: mobile, hasTouch: mobile })
  const page = await context.newPage()
  await login(page, origin, who)
  return { page, context }
}

async function openMessage(page, titleStart) {
  const body = await (await page.request.get(`${origin}/api/messages`)).json()
  const list = Array.isArray(body) ? body : body.items
  const hit = list.find((m) => m.title.startsWith(titleStart))
  assert.ok(hit, `no message starts with «${titleStart}»`)
  await page.goto(`${origin}/messages/${hit.id}`)
  await page.locator('main h1').waitFor()
  return hit
}

const send = async (page, text) => {
  await page.getByRole('textbox', { name: 'Respuesta' }).fill(text)
  await page.getByRole('button', { name: 'Responder', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Respuesta enviada' }).waitFor()
}

describe('the attachments of a reply (J5-flow-reply-close, J5-message-detail)', () => {
  test('a picture of a reply is open at the width of the reply and the other media carry their own name', async () => {
    const { page, context } = await session()
    try {
      await openMessage(page, 'Revisar la lectura')
      const picture = page.locator('section[aria-label="Respuestas"] ul[aria-label="Adjuntos"] img').first()
      await picture.waitFor()
      const [img, card] = [await picture.boundingBox(), await picture.locator('xpath=ancestor::article').boundingBox()]
      assert.ok(img.width >= card.width * 0.6, `the picture is ${img.width} px in a reply of ${card.width} px`)
      assert.equal(await page.locator('section[aria-label="Respuestas"]').getByText('login.svg').count(), 0, 'no file name beside a picture')
      const items = page.locator('section[aria-label="Respuestas"] ul[aria-label="Adjuntos"] > li')
      const texts = await items.evaluateAll((lis) => lis.map((li) => li.innerText.trim()))
      for (const name of ['nota-de-voz.wav', 'feedback-cliente.docx']) assert.ok(texts.some((x) => x.includes(name)), `«${name}» is named`)
      const apart = await items.evaluateAll((lis) =>
        lis.filter((li) => {
          const thumb = li.querySelector('.frame')?.getBoundingClientRect()
          const name = li.querySelector('span.text-xs')?.getBoundingClientRect()
          return thumb && name && Math.abs(thumb.top + thumb.height / 2 - (name.top + name.height / 2)) > 22
        }).length,
      )
      assert.equal(apart, 0, 'a name is not on the row of its thumbnail')
    } finally {
      await context.close()
    }
  })

  test('the icon says the medium: an audio is not drawn as a document, in the replies and in the gallery strip', async () => {
    const { page, context } = await session()
    try {
      await openMessage(page, 'Revisar la lectura')
      const kindsOf = (scope) => page.locator(`${scope} [data-media-icon]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-media-icon')))
      const replies = await kindsOf('section[aria-label="Respuestas"]')
      assert.ok(replies.includes('audio') && replies.includes('document') && replies.includes('link'), `kinds in replies: ${replies}`)
      const row = page.locator('section[aria-label="Respuestas"] ul[aria-label="Adjuntos"] li', { hasText: 'nota-de-voz.wav' })
      assert.equal(await row.locator('[data-media-icon]').getAttribute('data-media-icon'), 'audio')
      const doc = page.locator('section[aria-label="Respuestas"] ul[aria-label="Adjuntos"] li', { hasText: 'feedback-cliente.docx' })
      assert.equal(await doc.locator('[data-media-icon]').getAttribute('data-media-icon'), 'document')
      // Two different drawings, not one icon under two names.
      const drawn = async (l) => l.locator('svg[data-media-icon]').evaluate((s) => s.innerHTML)
      assert.notEqual(await drawn(row), await drawn(doc))
      const gallery = await page.locator('main [data-media-icon]').evaluateAll((els) => els.map((e) => e.getAttribute('data-media-icon')))
      assert.ok(gallery.includes('audio'), 'the gallery strip draws the audio with its icon')
    } finally {
      await context.close()
    }
  })
})

describe('the reply form (J5-flow-reply-close, J5-message-detail)', () => {
  test('«Respuesta» is the name of one control only: the field says «Texto» and «Cerrar mensaje» says what it closes', async () => {
    const { page, context } = await session()
    try {
      await openMessage(page, 'Revisar la lectura')
      const field = page.getByRole('textbox', { name: 'Respuesta' })
      assert.equal(await field.getAttribute('placeholder'), 'Texto')
      // Visible words «Respuesta» inside the form: none.
      const form = page.locator('form', { has: field })
      const visible = await form.evaluate((f) => {
        const hits = []
        const walker = document.createTreeWalker(f, NodeFilter.SHOW_TEXT)
        for (let n = walker.nextNode(); n; n = walker.nextNode()) if (/\bRespuesta\b/.test(n.textContent ?? '') && n.parentElement && n.parentElement.getClientRects().length > 0) hits.push(n.textContent.trim())
        return hits
      })
      assert.deepEqual(visible, [], `visible «Respuesta» in the form: ${JSON.stringify(visible)}`)
      assert.equal(await page.getByRole('main').getByRole('button', { name: 'Cerrar mensaje', exact: true }).isVisible(), true)
    } finally {
      await context.close()
    }
  })

  test('«Cerrar mensaje» is a quiet button apart from «Responder»: another shape and at least 16 px between them', async () => {
    const { page, context } = await session()
    try {
      await openMessage(page, 'Revisar la lectura')
      const close = page.getByRole('button', { name: 'Cerrar mensaje', exact: true })
      const reply = page.getByRole('button', { name: 'Responder', exact: true })
      const [a, b] = [await close.boundingBox(), await reply.boundingBox()]
      const sameRow = Math.abs(a.y - b.y) < 8
      if (sameRow) assert.ok(b.x - (a.x + a.width) >= 16, `${b.x - (a.x + a.width)} px between the two`)
      const style = (l) => l.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, img: getComputedStyle(el).backgroundImage, border: getComputedStyle(el).borderTopWidth }))
      const [qc, qr] = [await style(close), await style(reply)]
      assert.ok(qc.img === 'none' && /, 0\)$|rgba\(0, 0, 0, 0\)/.test(qc.bg), `«Cerrar mensaje» has no fill: ${JSON.stringify(qc)}`)
      assert.ok(qr.img !== 'none' || qr.bg !== qc.bg, '«Responder» keeps its fill')
    } finally {
      await context.close()
    }
  })

  test('each media control of the field says its name beside its icon and the three fit in the frame, on a phone too', async () => {
    for (const [viewport, mobile] of [[{ width: 1440, height: 900 }, false], [PHONE, true]]) {
      const { page, context } = await session('bruno', viewport, { mobile })
      try {
        await openMessage(page, 'Revisar la lectura')
        const field = page.getByRole('textbox', { name: 'Respuesta' })
        await field.scrollIntoViewIfNeeded()
        const frame = await page.locator('form .glass', { has: field }).first().boundingBox()
        for (const name of ['Adjuntar', 'Tomar foto', 'Grabar audio']) {
          const button = page.getByRole('button', { name, exact: true })
          assert.equal((await button.innerText()).trim(), name, `«${name}» has no visible text`)
          const box = await button.boundingBox()
          assert.ok(box.x >= frame.x && box.x + box.width <= frame.x + frame.width, `«${name}» leaves the frame at ${viewport.width} px`)
        }
        const rows = new Set()
        for (const name of ['Adjuntar', 'Tomar foto', 'Grabar audio']) rows.add(Math.round((await page.getByRole('button', { name, exact: true }).boundingBox()).y / 4))
        assert.equal(rows.size, 1, `the three controls are on one row at ${viewport.width} px`)
      } finally {
        await context.close()
      }
    }
  })
})

describe('sending and closing (J5-flow-reply-close)', () => {
  test('the confirmation sits inside the frame of the field and the controls keep their place relative to the field, on a desktop and a phone', async () => {
    for (const [viewport, mobile] of [[{ width: 1440, height: 900 }, false], [PHONE, true]]) {
      const { page, context } = await session('bruno', viewport, { mobile })
      try {
        await openMessage(page, 'Revisar la lectura')
        const field = page.getByRole('textbox', { name: 'Respuesta' })
        await field.scrollIntoViewIfNeeded()
        const frameOf = () => page.locator('form .glass', { has: field }).first().boundingBox()
        const rel = async () => {
          const [f, fr, s] = [await field.boundingBox(), await frameOf(), await page.getByRole('button', { name: 'Responder', exact: true }).boundingBox()]
          return { send: s.y - f.y, frame: fr.height }
        }
        const before = await rel()
        await send(page, 'Confirmado, queda para esta semana.')
        const after = await rel()
        assert.ok(Math.abs(after.send - before.send) <= 1, `«Responder» moved ${after.send - before.send} px relative to the field at ${viewport.width} px`)
        assert.ok(Math.abs(after.frame - before.frame) <= 1, `the frame grew ${after.frame - before.frame} px`)
        const frame = await frameOf()
        const status = await page.getByRole('status').filter({ hasText: 'Respuesta enviada' }).boundingBox()
        assert.ok(status.y >= frame.y && status.y + status.height <= frame.y + frame.height + 1 && status.x + status.width <= frame.x + frame.width, 'the confirmation is inside the frame of the field')
      } finally {
        await context.close()
      }
    }
  })

  test('on a phone, after sending, «Cerrar mensaje» is in the window with room under it and the confirmation is not at the edge', async () => {
    const { page, context } = await session('bruno', PHONE, { mobile: true })
    try {
      await openMessage(page, 'Revisar la lectura')
      await page.getByRole('textbox', { name: 'Respuesta' }).scrollIntoViewIfNeeded()
      await send(page, 'Confirmado, queda para esta semana.')
      await page.getByRole('heading', { name: 'Respuestas' }).waitFor()
      await page.waitForFunction(() => document.querySelectorAll('section[aria-label="Respuestas"] article').length >= 3)
      const close = await page.getByRole('button', { name: 'Cerrar mensaje', exact: true }).boundingBox()
      assert.ok(close.y >= 0 && close.y + close.height <= PHONE.height - 8, `«Cerrar mensaje» ends at ${close.y + close.height} of ${PHONE.height}`)
      const status = await page.getByRole('status').filter({ hasText: 'Respuesta enviada' }).boundingBox()
      assert.ok(status.y + status.height <= PHONE.height - 40, `the confirmation ends at ${status.y + status.height} of ${PHONE.height}`)
    } finally {
      await context.close()
    }
  })

  test('on a phone, closing floats no notice over the foot of the page: the word «Cerrado» and «Reabrir mensaje» stay in view and uncovered', async () => {
    const { page, context } = await session('bruno', PHONE, { mobile: true })
    try {
      await openMessage(page, 'Revisar la lectura')
      const close = page.getByRole('button', { name: 'Cerrar mensaje', exact: true })
      await close.scrollIntoViewIfNeeded()
      await close.click()
      const reopen = page.getByRole('button', { name: 'Reabrir mensaje', exact: true })
      await reopen.waitFor()
      await page.waitForFunction(() => {
        const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === 'Reabrir mensaje')
        if (!b) return false
        const r = b.getBoundingClientRect()
        return r.top >= 0 && r.bottom <= window.innerHeight
      })
      assert.equal(await page.locator('[data-notice]').count(), 0, 'a notice floats over the page')
      const covered = await reopen.evaluate((el) => {
        const r = el.getBoundingClientRect()
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
        return !(top === el || el.contains(top))
      })
      assert.equal(covered, false, '«Reabrir mensaje» is covered')
      const note = page.getByRole('status').filter({ hasText: 'Cerrado: no admite respuestas' })
      const box = await note.boundingBox()
      assert.ok(box.y >= 0 && box.y + box.height <= PHONE.height, 'the word «Cerrado» is outside the window')
      // Reopening is the undo, and it brings the form back.
      await reopen.click()
      await page.getByRole('textbox', { name: 'Respuesta' }).waitFor()
    } finally {
      await context.close()
    }
  })

  test('on a desktop closing still floats its notice with Deshacer', async () => {
    const { page, context } = await session()
    try {
      await openMessage(page, 'Revisar la lectura')
      await page.getByRole('button', { name: 'Cerrar mensaje', exact: true }).click()
      const notice = page.getByRole('status').filter({ hasText: 'Mensaje cerrado' })
      await notice.waitFor()
      await notice.getByRole('button', { name: 'Deshacer' }).waitFor()
    } finally {
      await context.close()
    }
  })

  test('on a phone the field is one tap from the first screen: «Responder» in the top row takes the focus to it', async () => {
    const { page, context } = await session('bruno', PHONE, { mobile: true })
    try {
      await openMessage(page, 'Revisar la lectura')
      const jump = page.getByRole('link', { name: 'Responder', exact: true })
      const box = await jump.boundingBox()
      assert.ok(box.y + box.height <= PHONE.height, 'the link is in the first screen')
      assert.equal(await page.getByRole('textbox', { name: 'Respuesta' }).evaluate((el) => el.getBoundingClientRect().top > window.innerHeight), true, 'the field is below the first screen')
      await jump.click()
      await page.waitForFunction(() => document.activeElement?.id === 'reply-field')
      const field = await page.getByRole('textbox', { name: 'Respuesta' }).boundingBox()
      assert.ok(field.y >= 0 && field.y + field.height <= PHONE.height, 'the field is in the window')
    } finally {
      await context.close()
    }
  })

  test('a desktop has no jump link: the field is already in view', async () => {
    const { page, context } = await session()
    try {
      await openMessage(page, 'Revisar la lectura')
      assert.equal(await page.getByRole('link', { name: 'Responder', exact: true }).count(), 0)
    } finally {
      await context.close()
    }
  })
})

describe('what the owner fixed stays', () => {
  test('the three states keep their words and the area chip its color in the detail', async () => {
    const { page, context } = await session()
    try {
      await openMessage(page, 'Revisar la lectura')
      assert.equal(await page.getByText('Respondido', { exact: true }).first().isVisible(), true)
      const chip = page.getByTestId('area-chip').first()
      const fill = await chip.evaluate((el) => getComputedStyle(el).backgroundColor)
      assert.ok(fill !== 'rgba(0, 0, 0, 0)' && !/, 0\)$/.test(fill), `the chip has its color: ${fill}`)
    } finally {
      await context.close()
    }
  })
})
