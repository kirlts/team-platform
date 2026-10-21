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

const panel = await startPanel(8886, { build: false })
const WIDTHS = [220, 260, 300, 340, 380, 420, 460, 500, 540, 580, 620, 700, 800]

/** Runs in the page: lays `texts` out at `width` and returns the gaps (px) of every stretched line, and the natural width of a space. */
const measureInPage = ({ texts, width, justify }) => {
  const host = document.createElement('div')
  host.style.cssText = `position:fixed;left:0;top:0;visibility:hidden;width:${width}px;font:inherit;`
  host.className = 'text-sm'
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
  const ids = await page.evaluate(async () => (await (await fetch('/api/messages?limit=100')).json()).data.map((m) => m.id))
  for (const id of ids) await grab(`/messages/${id}`, 'main h1')
  await grab('/settings', 'main h1')
  await grab('/team', 'main h1')
  const texts = [...collected]
  console.log(`${texts.length} paragraphs`)

  // Reference: the widths the justified blocks have at 1440 px.
  const widthsAtDesktop = []
  await page.goto(`${panel.origin}/messages/${ids[0]}`)
  await page.locator('main h1').waitFor()
  for (const w of await page.locator('.prose-block').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width))) widthsAtDesktop.push(w)
  const desktop = widthsAtDesktop.length ? Math.min(...widthsAtDesktop) : 520
  console.log(`widths of .prose-block at 1440: ${widthsAtDesktop.map(Math.round).join(', ')}`)

  const stats = async (width) => {
    const { gaps, natural } = await page.evaluate(measureInPage, { texts, width, justify: true })
    const sorted = [...gaps].sort((a, b) => a - b)
    return { width, natural, n: gaps.length, max: sorted.at(-1) ?? 0, p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0 }
  }
  const ref = await stats(desktop)
  console.log(`reference at ${Math.round(desktop)} px: natural space ${ref.natural.toFixed(2)} px, largest gap ${ref.max.toFixed(1)} px (p95 ${ref.p95.toFixed(1)})`)
  for (const width of WIDTHS) {
    const s = await stats(width)
    const over = (await page.evaluate(measureInPage, { texts, width, justify: true })).gaps.filter((g) => g > ref.max).length
    console.log(`${String(width).padStart(4)} px: largest ${s.max.toFixed(1).padStart(5)} px  p95 ${s.p95.toFixed(1).padStart(5)}  lines over reference ${over}/${s.n}  (${(s.max / s.natural).toFixed(1)}x the natural space)`)
  }
} finally {
  await panel.stop()
}
