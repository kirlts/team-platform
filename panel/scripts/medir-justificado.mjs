#!/usr/bin/env node
// Measures how wide the gaps between words get when running text is justified (UD-022), by container width.
//
//   npm run build && node scripts/medir-justificado.mjs
//
// It takes every paragraph the panel justifies (`.prose-block`) from the real screens, lays each one out in a container
// of a given width with the panel's own font and the rule `text-align: justify; hyphens: none; text-wrap: pretty`, and
// measures, line by line (the last line of a paragraph is never stretched), the space between each pair of words.
// Prints, per width: the largest gap, the 95th percentile and how many lines are over the reference gap.
//
// The reference gap is the largest gap measured at 1440x900, where the owner saw and asked for justified text (UD-022):
// the narrowest container that stays within it is the one UD-034 uses to switch justification on.
import { login, startPanel } from '../src/browser-support.mjs'

// The size class of the text: `text-sm` (15 px) for replies, profiles and descriptions, `text-read` (17 px) for the body of a message.
const SIZE = process.env.TEXT_SIZE ?? 'text-sm'
const panel = await startPanel(8886, { build: false })
// A coarse sweep over the widths a screen can give a paragraph, finer where the answer is decided.
const WIDTHS = [...Array.from({ length: 19 }, (_, i) => 200 + i * 10), ...Array.from({ length: 101 }, (_, i) => 390 + i * 2), ...Array.from({ length: 31 }, (_, i) => 600 + i * 10)]
  .sort((a, b) => a - b)
  .filter((w, i, all) => all.indexOf(w) === i)

/** Runs in the page: lays `texts` out at `width` and returns the gaps (px) of every stretched line, and the natural width of a space. */
const measureInPage = ({ texts, width, justify, size }) => {
  const host = document.createElement('div')
  host.style.cssText = `position:fixed;left:0;top:0;visibility:hidden;width:${width}px;`
  host.className = size
  document.body.appendChild(host)
  const gaps = []
  let natural = 0
  for (const text of texts) {
    const p = document.createElement('p')
    p.style.cssText = `margin:0;white-space:normal;text-align:${justify ? 'justify' : 'left'};hyphens:none;text-wrap:pretty;`
    const words = text.split(/\s+/).filter(Boolean)
    words.forEach((w, i) => {
      const s = document.createElement('span')
      s.textContent = w
      p.appendChild(s)
      if (i < words.length - 1) p.appendChild(document.createTextNode(' '))
    })
    host.appendChild(p)
    const spans = [...p.querySelectorAll('span')]
    const rects = spans.map((s) => s.getBoundingClientRect())
    const lastTop = rects.at(-1)?.top
    for (let i = 0; i < rects.length - 1; i++) {
      if (Math.abs(rects[i].top - rects[i + 1].top) < 2 && Math.abs(rects[i].top - lastTop) > 2) gaps.push(rects[i + 1].left - rects[i].right)
    }
    if (!natural) {
      const probe = document.createElement('span')
      probe.textContent = 'a a'
      p.appendChild(probe)
      const a = document.createElement('span')
      a.textContent = 'aa'
      p.appendChild(a)
      natural = probe.getBoundingClientRect().width - a.getBoundingClientRect().width
    }
  }
  host.remove()
  return { gaps, natural }
}

try {
  const context = await panel.browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-CL' })
  const page = await context.newPage()
  await login(page, panel.origin, 'ana')
  // The paragraphs of the screens that justify: a message with replies, the project description, the profiles and a template.
  const collected = new Set()
  const grab = async (path, ready) => {
    await page.goto(`${panel.origin}${path}`)
    await page.locator(ready).first().waitFor()
    await page.waitForTimeout(500)
    for (const t of await page.locator('.prose-block, [data-lane="message-body"] .text-read').allInnerTexts()) for (const para of t.split(/\n+/)) if (para.trim().split(/\s+/).length > 12) collected.add(para.trim())
  }
  await page.goto(panel.origin)
  const ids = await page.evaluate(async () => { const b = await (await fetch('/api/messages?limit=100')).json(); return (b.items ?? b.data ?? b).map((m) => m.id) })
  for (const id of ids) await grab(`/messages/${id}`, 'main h1')
  await grab('/settings', 'main h1')
  await grab('/team', 'main h1')
  const texts = [...collected]
  console.log(`${texts.length} paragraphs`)

  // Reference: the widths the justified blocks have at 1440 px, in every screen that has them.
  const desktopWidths = new Set()
  for (const id of ids) {
    await page.goto(`${panel.origin}/messages/${id}`)
    await page.locator('main h1').waitFor()
    for (const w of await page.locator('.prose-block').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)))) desktopWidths.add(w)
  }
  for (const path of ['/settings', '/team']) {
    await page.goto(`${panel.origin}${path}`)
    await page.locator('main h1').waitFor()
    for (const w of await page.locator('.prose-block').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)))) desktopWidths.add(w)
  }
  console.log(`widths of .prose-block at 1440: ${[...desktopWidths].sort((a, b) => a - b).join(', ')}`)

  const stats = async (width) => {
    const { gaps, natural } = await page.evaluate(measureInPage, { texts, width, justify: true, size: SIZE })
    const sorted = [...gaps].sort((a, b) => a - b)
    return { width, natural, n: gaps.length, max: sorted.at(-1) ?? 0, p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0 }
  }
  let reference = 0
  let natural = 0
  for (const w of desktopWidths) {
    const s = await stats(w)
    natural = s.natural
    reference = Math.max(reference, s.max)
  }
  console.log(`reference gap: ${reference.toFixed(1)} px, the largest at those widths (natural space ${natural.toFixed(2)} px)`)
  const rows = []
  for (const width of WIDTHS) rows.push(await stats(width))
  for (const s of rows) console.log(`${String(s.width).padStart(4)} px: largest ${s.max.toFixed(1).padStart(5)} px  p95 ${s.p95.toFixed(1).padStart(5)}  (${(s.max / s.natural).toFixed(1)}x the natural space)${s.max > reference ? '  OVER' : ''}`)
  // The threshold: the narrowest width from which no wider one goes over the reference.
  let threshold = WIDTHS.at(-1)
  for (let i = rows.length - 1; i >= 0 && rows[i].max <= reference; i--) threshold = rows[i].width
  console.log(`size ${SIZE}: threshold ${threshold} px`)
} finally {
  await panel.stop()
}
