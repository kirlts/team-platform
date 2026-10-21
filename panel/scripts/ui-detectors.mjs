#!/usr/bin/env node
// One reusable pass of UI detectors over every route of the panel (headless Chromium, never a window).
// Each detector is a pure function over the DOM, evaluated in the page; this file only drives the pages
// and gathers the findings. It is a report, not a guard: it exits 0 with findings and non-zero only when
// the pass itself fails.
//
// Usage: node scripts/ui-detectors.mjs [--out file] [--screens a,b] [--viewports desktop,phone]
//        [--themes light,dark] [--max-saturated N] [--voice-patterns file.json] [--json] [--no-build]
// The port comes from PANEL_DETECTORS_PORT (default 8974).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { login, settled, startPanel } from '../src/browser-support.mjs'

const PANEL = fileURLToPath(new URL('..', import.meta.url))

// ---------------------------------------------------------------------------------------------
// Thresholds, each with its source.
// ---------------------------------------------------------------------------------------------

/** WCAG 2.2, success criterion 2.5.8 Target Size (Minimum): 24 by 24 CSS px, or 24 px of spacing. https://www.w3.org/TR/WCAG22/#target-size-minimum */
export const MIN_TARGET_PX = 24
/** WCAG 2.2, criterion 1.4.3 Contrast (Minimum): 4.5:1 for normal text. https://www.w3.org/TR/WCAG22/#contrast-minimum */
export const CONTRAST_NORMAL = 4.5
/** Same criterion: 3:1 for large text, which is 18 pt (24 px) or 14 pt (18.66 px) bold. */
export const CONTRAST_LARGE = 3
export const LARGE_PX = 24
export const LARGE_BOLD_PX = 18.66
/**
 * Equal weight: at most this many visible elements may share one saturated fill. Three is the number the
 * task fixed (a screen with a primary action and two companions still reads as hierarchy); it is a knob,
 * `--max-saturated`.
 */
export const MAX_SATURATED_DEFAULT = 3
/** A fill counts as saturated at HSV saturation of 0.5 or more with a value of 0.3 or more (not a near-black). Chosen to separate the accent blue and the status colors from the neutral glass and silver surfaces; falsified in the unit test. */
export const SATURATION_MIN = 0.5
export const VALUE_MIN = 0.3
/** Overlaps under this many px in either axis are leading, not a collision: the line box of 15 px text at line-height 1.45 and the content area of its font differ by up to about 3 px (measured on the team screen, where a name and an email touch by 2 px). */
export const OVERLAP_MIN_PX = 4
/** Tolerance when comparing a computed font size with a token (rounding of rem times 15). */
export const FONT_TOLERANCE_PX = 0.06
/** Siblings of a column list whose trailing mark (a count, an icon) differs by more than this in right edge or vertical center are misaligned. 1 px is the tolerance of the sidebar test (UD-130); sub-pixel rounding stays under it. */
export const ALIGN_TOLERANCE_PX = 1
/** A trailing mark is small (a count or an icon), not a label: at most this wide, and in the right 40 % of its item. */
export const MARK_MAX_WIDTH_PX = 80

/** The type scale is read from the same source as src/type-scale.test.ts: the --text-* tokens of styles.css times the 15 px root. */
export function readTypeScale() {
  const css = readFileSync(join(PANEL, 'src/styles.css'), 'utf8')
  const rootPx = 15 // ROOT_PX in src/type-scale.test.ts
  const sizes = [...css.matchAll(/--text-([a-z]+):\s*([\d.]+)rem/g)].map((m) => ({ name: m[1], px: Number(m[2]) * rootPx }))
  if (!sizes.length) throw new Error('styles.css no define tokens --text-*')
  const lg = sizes.find((s) => s.name === 'lg')
  if (!lg) throw new Error('styles.css no define --text-lg (piso de los títulos)')
  return { steps: [...new Set(sizes.map((s) => s.px))].sort((a, b) => a - b), headingMin: lg.px }
}

// ---------------------------------------------------------------------------------------------
// Helpers injected into the page as window.__ud.
// ---------------------------------------------------------------------------------------------

/** Runs in the page: installs the shared helpers. */
export function installHelpers() {
  const ud = {}
  ud.rect = (el) => el.getBoundingClientRect()
  ud.hidden = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n)
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return true
      if (n.hasAttribute('hidden') || n.getAttribute('aria-hidden') === 'true') return true
      if (n.classList.contains('sr-only') || n.tagName === 'SCRIPT' || n.tagName === 'STYLE') return true
      if (parseFloat(cs.opacity) === 0) return true
    }
    return false
  }
  /** The part of the box a person can see: clipped by every ancestor that clips and by the window. */
  ud.visibleRect = (el) => {
    const r = el.getBoundingClientRect()
    let left = Math.max(0, r.left)
    let top = Math.max(0, r.top)
    let right = Math.min(innerWidth, r.right)
    let bottom = Math.min(innerHeight, r.bottom)
    for (let p = el.parentElement; p; p = p.parentElement) {
      const cs = getComputedStyle(p)
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue
      if (cs.position === 'fixed' && p !== el.parentElement) continue
      const pr = p.getBoundingClientRect()
      if (cs.overflowX !== 'visible') { left = Math.max(left, pr.left); right = Math.min(right, pr.right) }
      if (cs.overflowY !== 'visible') { top = Math.max(top, pr.top); bottom = Math.min(bottom, pr.bottom) }
    }
    return right > left && bottom > top ? { left, top, right, bottom, width: right - left, height: bottom - top } : null
  }
  ud.ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').replace(/\s+/g, ' ').trim()
  ud.sel = (el) => {
    const part = (n) => {
      const tag = n.tagName.toLowerCase()
      const tid = n.getAttribute('data-testid')
      if (tid) return `${tag}[data-testid="${tid}"]`
      if (n.id) return `${tag}#${CSS.escape(n.id)}`
      const label = n.getAttribute('aria-label')
      if (label && label.length < 40) return `${tag}[aria-label="${label}"]`
      const role = n.getAttribute('role')
      const cls = [...n.classList].filter((c) => !/[:\[\]\/%]/.test(c) && !/\d$/.test(c)).slice(0, 2)
      return tag + (role ? `[role=${role}]` : '') + cls.map((c) => '.' + CSS.escape(c)).join('')
    }
    const parts = []
    for (let n = el, i = 0; n && n.nodeType === 1 && n !== document.body && i < 3; n = n.parentElement, i++) {
      parts.unshift(part(n))
      if (n.id || n.getAttribute('data-testid')) break
    }
    return parts.join(' > ')
  }
  ud.interactive = (el) => el.matches('a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=menuitem], [role=menuitemcheckbox], [role=checkbox], [role=switch]')
  /** Sticky and fixed elements (headers of a scrolled list, the shell bar) are laid over the content that scrolls under them on purpose. */
  ud.pinned = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const pos = getComputedStyle(n).position
      if (pos === 'sticky' || pos === 'fixed') return true
    }
    return false
  }
  /** Layers that sit over the page on purpose: they overlap what is behind them by design. */
  ud.LAYERS = '[role=dialog], [role=alertdialog], [role=menu], [role=listbox], [role=tooltip], [data-radix-popper-content-wrapper], [data-radix-portal], [data-notice], [role=status], [role=alert]'
  let canvas
  ud.rgba = (color) => {
    canvas ??= document.createElement('canvas')
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = '#000'
    ctx.fillStyle = color
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    // getImageData returns the premultiplied-then-restored value; with a=0 the color is lost.
    return { r, g, b, a: a / 255 }
  }
  ud.over = (top, under) => ({
    r: top.r * top.a + under.r * (1 - top.a),
    g: top.g * top.a + under.g * (1 - top.a),
    b: top.b * top.a + under.b * (1 - top.a),
    a: 1,
  })
  ud.luminance = ({ r, g, b }) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  ud.ratio = (a, b) => {
    const [hi, lo] = [ud.luminance(a), ud.luminance(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
  }
  window.__ud = ud
}

// ---------------------------------------------------------------------------------------------
// Detectors. Each one is self-contained (it is serialized into the page) and returns
// { findings: [{ rule, selector, detail, measure }], skipped?: [string] }.
// ---------------------------------------------------------------------------------------------

export const DETECTORS = {
  /**
   * Visible elements whose boxes intersect without one containing the other. Only elements that carry
   * their own text or that are interactive are candidates (a container always overlaps its children).
   * Left out on purpose: layers that sit over the page by design (dialogs, menus, listboxes, tooltips,
   * popper content, the notice bar and live regions, see ud.LAYERS), aria-hidden decoration (the sky
   * and the avatar initials), sticky and fixed elements (laid over scrolling content by design), and anything clipped away by a scroll container (only the visible part counts).
   */
  overlap: () => {
    const ud = window.__ud
    const candidates = []
    for (const el of document.body.querySelectorAll('*')) {
      if (el.closest(ud.LAYERS) || ud.hidden(el)) continue
      if (ud.pinned(el)) continue
      if (!ud.ownText(el) && !ud.interactive(el)) continue
      const v = ud.visibleRect(el)
      if (v) candidates.push({ el, v })
    }
    const out = []
    const seen = new Set()
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const a = candidates[i], b = candidates[j]
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue
        const w = Math.min(a.v.right, b.v.right) - Math.max(a.v.left, b.v.left)
        const h = Math.min(a.v.bottom, b.v.bottom) - Math.max(a.v.top, b.v.top)
        if (w < OVERLAP_MIN_PX || h < OVERLAP_MIN_PX) continue
        const sa = ud.sel(a.el), sb = ud.sel(b.el)
        const key = [sa, sb].sort().join(' | ')
        if (seen.has(key)) continue
        seen.add(key)
        out.push({
          rule: 'overlap',
          selector: key.length > 160 ? key.slice(0, 160) : key,
          detail: `Se solapan ${Math.round(w)} x ${Math.round(h)} px: «${(ud.ownText(a.el) || a.el.tagName).slice(0, 24)}» y «${(ud.ownText(b.el) || b.el.tagName).slice(0, 24)}»`,
          measure: { width: Math.round(w), height: Math.round(h) },
        })
      }
    }
    return { findings: out }
  },

  /**
   * Siblings of a list that stacks (ul, ol, role=list, role=menu, nav): each item's trailing mark is its last visible leaf
   * (a count, an icon), when it is small and sits in the right part of the item. Marks whose right edge differs by more than
   * ALIGN_TOLERANCE_PX across the list, or whose vertical center differs from their item's by more than it, are findings (UD-130).
   * Items with no such mark are skipped; the vertical check only looks at items of one line (a mark beside a block of text may sit at the top).
   */
  'sibling-alignment': () => {
    const ud = window.__ud
    const out = []
    const trailing = (item) => {
      const leaves = [...item.querySelectorAll('*')].filter((el) => el.children.length === 0 && !ud.hidden(el) && (ud.ownText(el) || el.tagName.toLowerCase() === 'svg' || el.tagName === 'IMG'))
      for (let i = leaves.length - 1; i >= 0; i--) {
        const r = leaves[i].getBoundingClientRect()
        if (r.width > 0 && r.height > 0) return { el: leaves[i], r }
      }
      return null
    }
    for (const list of document.body.querySelectorAll('ul, ol, [role=list], [role=menu], nav')) {
      if (list.closest(ud.LAYERS) && !list.matches(ud.LAYERS)) continue
      if (ud.hidden(list)) continue
      const items = [...list.children].filter((c) => !ud.hidden(c) && c.getBoundingClientRect().height > 0)
      if (items.length < 2) continue
      const boxes = items.map((c) => c.getBoundingClientRect())
      let stacked = true
      for (let i = 1; i < boxes.length; i++) if (boxes[i].top < boxes[i - 1].bottom - 1) stacked = false
      if (!stacked) continue
      const marks = []
      items.forEach((item, i) => {
        const t = trailing(item)
        if (!t || t.r.width > MARK_MAX_WIDTH_PX) return
        if (t.r.left < boxes[i].left + boxes[i].width * 0.6) return
        marks.push({ item, box: boxes[i], mark: t })
      })
      if (marks.length < 2) continue
      const rights = marks.map((m) => m.mark.r.right)
      const spread = Math.max(...rights) - Math.min(...rights)
      if (spread > ALIGN_TOLERANCE_PX) {
        out.push({ rule: 'sibling-alignment', selector: ud.sel(list), detail: `Las marcas finales de los elementos de la lista terminan a ${Math.round(spread * 10) / 10} px entre sí (borde derecho)`, measure: { spread: Math.round(spread * 10) / 10, axis: 'right' } })
      }
      for (const m of marks) {
        if (m.box.height > 56) continue
        const dy = Math.abs(m.mark.r.top + m.mark.r.height / 2 - (m.box.top + m.box.height / 2))
        if (dy > ALIGN_TOLERANCE_PX) {
          out.push({ rule: 'sibling-alignment', selector: ud.sel(m.mark.el), detail: `La marca final está ${Math.round(dy * 10) / 10} px fuera del centro vertical de su fila`, measure: { offset: Math.round(dy * 10) / 10, axis: 'center' } })
        }
      }
    }
    return { findings: out }
  },

  /** WCAG 2.5.8: interactive controls under 24 x 24 px, unless a 24 px circle on them touches no other target, or they are inline text links. */
  'tap-target': () => {
    const ud = window.__ud
    const MIN = 24
    const targets = []
    for (const el of document.body.querySelectorAll('a[href], button, input:not([type=hidden]), select, [role=button], [role=tab], [role=menuitem], [role=menuitemcheckbox], [role=checkbox], [role=switch]')) {
      if (el.disabled || ud.hidden(el)) continue
      const v = ud.visibleRect(el)
      if (!v) continue
      const r = el.getBoundingClientRect()
      // A file input is driven by a visible label or button; a native checkbox hidden under a styled one is not a target either.
      if (el.type === 'file' || (r.width <= 1 && r.height <= 1)) continue
      targets.push({ el, r })
    }
    const out = []
    for (const t of targets) {
      const { r, el } = t
      if (r.width >= MIN && r.height >= MIN) continue
      const cs = getComputedStyle(el)
      // Exemption (inline): a link inside a sentence takes the size of the text line.
      if (el.tagName === 'A' && cs.display === 'inline') {
        const parentText = [...el.parentElement.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
        if (parentText) continue
      }
      // Exemption (spacing): a circle of 24 px centered on the box touches no other target nor the circle of another undersized one.
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2
      let crowded = false
      for (const o of targets) {
        if (o === t || o.el.contains(el) || el.contains(o.el)) continue
        const small = o.r.width < MIN || o.r.height < MIN
        // Distance from the circle's center to the other box (or its own circle's center when it is also undersized).
        let d
        if (small) d = Math.hypot(cx - (o.r.left + o.r.width / 2), cy - (o.r.top + o.r.height / 2)) - MIN
        else d = Math.hypot(Math.max(o.r.left - cx, 0, cx - o.r.right), Math.max(o.r.top - cy, 0, cy - o.r.bottom)) - MIN / 2
        if (d < 0) { crowded = true; break }
      }
      if (!crowded) continue
      out.push({
        rule: 'tap-target',
        selector: ud.sel(el),
        detail: `Control de ${Math.round(r.width)} x ${Math.round(r.height)} px, bajo el mínimo de ${MIN} y con vecino interactivo a menos de ${MIN} px`,
        measure: { width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10 },
      })
    }
    return { findings: out }
  },

  /** Computed font sizes outside the scale: a step of styles.css, or at least the heading step. */
  'type-scale': ({ steps, headingMin }) => {
    const ud = window.__ud
    const out = []
    const seen = new Set()
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement
      if (!el || !n.textContent.trim() || ud.hidden(el) || el.closest('[aria-hidden=true]')) continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      const px = parseFloat(getComputedStyle(el).fontSize)
      const ok = px >= headingMin - FONT_TOLERANCE_PX || steps.some((s) => Math.abs(s - px) <= FONT_TOLERANCE_PX)
      if (ok) continue
      const key = ud.sel(el) + '|' + px
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        rule: 'type-scale',
        selector: ud.sel(el),
        detail: `Tamaño de ${px.toFixed(2)} px fuera de la escala (${steps.map((s) => +s.toFixed(2)).join(', ')} y desde ${headingMin} px): «${n.textContent.trim().slice(0, 24)}»`,
        measure: { font_size_px: +px.toFixed(2) },
      })
    }
    return { findings: out }
  },

  /**
   * WCAG 1.4.3 contrast of each visible text against its effective background: ancestors are composited
   * until an opaque color. Text whose background chain reaches a background-image (gradient or picture) or
   * that sits on an img, svg, canvas or video is not measured (its background is not one color) and counted in `skipped`.
   * Disabled controls are exempt, as the criterion says. The page's own sky (radial and linear glows on html/body, light pastel washes over the opaque body color) is measured against that body color, not skipped: it is the base of every glass surface. Translucent glass is composited over the page's
   * opaque body color, which is the base the glass is drawn on.
   */
  contrast: () => {
    const ud = window.__ud
    const out = []
    let unmeasurable = 0
    const seen = new Set()
    for (const el of document.body.querySelectorAll('*')) {
      const text = ud.ownText(el)
      if (!text || ud.hidden(el)) continue
      if (el.disabled || el.closest(':disabled, [aria-disabled=true]')) continue
      const v = ud.visibleRect(el)
      if (!v) continue
      const cs = getComputedStyle(el)
      let opacity = 1
      let bg = null
      let image = false
      const layers = []
      for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
        const s = getComputedStyle(n)
        opacity *= parseFloat(s.opacity)
        if (s.backgroundImage !== 'none' && n !== document.body && n !== document.documentElement) { image = true; break }
        const c = ud.rgba(s.backgroundColor)
        if (c.a > 0) layers.push(c)
        if (c.a >= 0.999) break
      }
      if (image) { unmeasurable++; continue }
      bg = layers.length && layers[layers.length - 1].a >= 0.999 ? layers[layers.length - 1] : { r: 255, g: 255, b: 255, a: 1 }
      for (let i = layers.length - (layers[layers.length - 1]?.a >= 0.999 ? 2 : 1); i >= 0; i--) bg = ud.over(layers[i], bg)
      const fg0 = ud.rgba(cs.color)
      const fg = ud.over({ ...fg0, a: fg0.a * opacity }, bg)
      const ratio = ud.ratio(fg, bg)
      const size = parseFloat(cs.fontSize)
      const bold = parseInt(cs.fontWeight, 10) >= 700
      const large = size >= LARGE_PX || (bold && size >= LARGE_BOLD_PX)
      const need = large ? CONTRAST_LARGE : CONTRAST_NORMAL
      if (ratio >= need) continue
      const key = ud.sel(el)
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        rule: 'contrast',
        selector: key,
        detail: `Contraste ${ratio.toFixed(2)}:1 con mínimo ${need}:1 (${large ? 'texto grande' : 'texto normal'}): «${text.slice(0, 24)}»`,
        measure: { ratio: +ratio.toFixed(2), required: need, font_size_px: size },
      })
    }
    return { findings: out, unmeasurable }
  },

  /** Text that overflows its box with the overflow hidden (cut, ellipsis, line clamp), and boxes that leave the window sideways. */
  'overflow-clip': () => {
    const ud = window.__ud
    const out = []
    for (const el of document.body.querySelectorAll('*')) {
      if (ud.hidden(el)) continue
      const cs = getComputedStyle(el)
      const own = ud.ownText(el)
      if (own) {
        const clipsX = cs.overflowX !== 'visible' && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll'
        const clipsY = cs.overflowY !== 'visible' && cs.overflowY !== 'auto' && cs.overflowY !== 'scroll'
        const clamp = cs.webkitLineClamp && cs.webkitLineClamp !== 'none'
        const cutX = clipsX && el.scrollWidth > el.clientWidth + 1
        const cutY = (clipsY || clamp) && el.scrollHeight > el.clientHeight + 1
        if (cutX || cutY) {
          out.push({
            rule: 'overflow-clip',
            selector: ud.sel(el),
            detail: `Texto cortado (${cutX ? `ancho ${el.scrollWidth} en caja de ${el.clientWidth} px` : `alto ${el.scrollHeight} en caja de ${el.clientHeight} px`}${cs.textOverflow === 'ellipsis' ? ', con puntos suspensivos' : ''}${clamp ? ', con límite de líneas' : ''}): «${own.slice(0, 24)}»`,
            measure: { scroll: cutX ? el.scrollWidth : el.scrollHeight, client: cutX ? el.clientWidth : el.clientHeight },
          })
          continue
        }
      }
      // A box that leaves the window sideways, unless a scroll container clips it (then only its visible part counts).
      if (!own && !ud.interactive(el)) continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      let clipped = false
      for (let p = el.parentElement; p; p = p.parentElement) {
        const s = getComputedStyle(p)
        if (s.overflowX !== 'visible') { const pr = p.getBoundingClientRect(); if (pr.right <= innerWidth + 1 && pr.left >= -1) { clipped = true; break } }
      }
      if (clipped) continue
      if (r.right > innerWidth + 1 || r.left < -1) {
        out.push({
          rule: 'overflow-clip',
          selector: ud.sel(el),
          detail: `La caja sale de la ventana: de ${Math.round(r.left)} a ${Math.round(r.right)} px en una ventana de ${innerWidth}`,
          measure: { left: Math.round(r.left), right: Math.round(r.right), window: innerWidth },
        })
      }
    }
    return { findings: out }
  },

  /** The document is wider than the window. */
  'horizontal-scroll': () => {
    const se = document.scrollingElement
    const main = document.querySelector('main')
    const wide = Math.max(se.scrollWidth - innerWidth, main ? main.scrollWidth - main.clientWidth : 0)
    if (wide <= 0) return { findings: [] }
    return { findings: [{ rule: 'horizontal-scroll', selector: 'html', detail: `El documento es ${wide} px más ancho que la ventana de ${innerWidth}`, measure: { overflow_px: wide, window: innerWidth } }] }
  },

  /**
   * Height of the screen against the window: the document plus whatever the main region scrolls on its
   * own (the shell is h-dvh, so the document alone is always one window). Always returned as `ratio`;
   * the driver turns it into a finding only for the screens that must fit one screen.
   */
  'page-height': () => {
    const se = document.scrollingElement
    const main = document.querySelector('main')
    const extra = main ? Math.max(0, main.scrollHeight - main.clientHeight) : 0
    const total = Math.max(se.scrollHeight, innerHeight) + extra
    return { findings: [], ratio: +(total / innerHeight).toFixed(3), total, window: innerHeight }
  },

  /**
   * More than `max` visible elements with the same saturated fill and text inside. Nested elements of the
   * same color count once (the innermost). Elements in the sky (aria-hidden) are not counted.
   */
  'equal-weight': ({ max }) => {
    const ud = window.__ud
    const groups = new Map()
    for (const el of document.body.querySelectorAll('*')) {
      if (ud.hidden(el) || el.closest('[aria-hidden=true]')) continue
      const c = ud.rgba(getComputedStyle(el).backgroundColor)
      if (c.a < 0.6) continue
      const mx = Math.max(c.r, c.g, c.b), mn = Math.min(c.r, c.g, c.b)
      const sat = mx === 0 ? 0 : (mx - mn) / mx
      if (sat < SATURATION_MIN || mx / 255 < VALUE_MIN) continue
      if (!el.textContent.trim() && !el.querySelector('svg')) continue
      if (!ud.visibleRect(el)) continue
      const key = `rgb(${c.r}, ${c.g}, ${c.b})`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(el)
    }
    const out = []
    for (const [color, els] of groups) {
      const leaves = els.filter((e) => !els.some((o) => o !== e && e.contains(o)))
      if (leaves.length <= max) continue
      out.push({
        rule: 'equal-weight',
        selector: `fill ${color}`,
        detail: `${leaves.length} elementos visibles con el mismo relleno saturado ${color} (máximo ${max}): ${leaves.slice(0, 3).map((e) => ud.sel(e).split(' > ').pop()).join(', ')}`,
        measure: { count: leaves.length, max },
      })
    }
    return { findings: out }
  },

  /** Visible texts that match the patterns of the language guard (R1 to R14 of UD-050). Patterns arrive as { id, source, flags }. */
  voice: ({ patterns }) => {
    const ud = window.__ud
    const out = []
    const seen = new Set()
    for (const el of document.body.querySelectorAll('*')) {
      const text = ud.ownText(el)
      if (!text || ud.hidden(el) || el.closest('textarea, [data-user-text]')) continue
      for (const p of patterns) {
        if (!new RegExp(p.source, p.flags).test(text)) continue
        const key = ud.sel(el) + '|' + p.id
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ rule: 'voice', selector: ud.sel(el), detail: `Texto fuera del lenguaje de instrumento (${p.id}): «${text.slice(0, 40)}»`, measure: { pattern: p.id } })
      }
    }
    return { findings: out }
  },
}

// ---------------------------------------------------------------------------------------------
// Driver.
// ---------------------------------------------------------------------------------------------

export const VIEWPORTS = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } }
export const THEMES = ['light', 'dark']
export const SCREEN_IDS = ['home', 'messages', 'message-detail', 'areas', 'area-detail', 'team', 'settings', 'connections', 'login']
/** Screens that must fit one screen per src/fits-one-screen.browser.test.mjs (UD-017), measured there at desktop sizes. */
export const MUST_FIT = new Set(['home', 'messages', 'message-detail', 'areas', 'area-detail', 'team', 'settings'])

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}
const flag = (name) => process.argv.includes(`--${name}`)
const list = (name, all) => (arg(name) ? arg(name).split(',').map((s) => s.trim()).filter(Boolean) : all)

/** Loads the voice patterns: the guard of wt-voz if this branch has it, otherwise the optional file. */
export function loadVoicePatterns(file) {
  if (file) {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    return { patterns: raw.map((p, i) => ({ id: p.id ?? `p${i}`, source: p.source ?? p.regex, flags: p.flags ?? 'iu' })) }
  }
  const guard = join(PANEL, 'src/ui-voice.test.ts')
  if (existsSync(guard)) {
    return { reason: 'omitido: panel/src/ui-voice.test.ts existe pero es un archivo de prueba de vitest y no exporta patrones importables fuera de él; pasar --voice-patterns con un JSON [{id, source, flags}]' }
  }
  return { reason: 'omitido: la guardia de wt-voz aún no está en esta rama' }
}

async function settle(page, hasMain) {
  if (hasMain) await page.locator('main h1').first().waitFor({ timeout: 15000 }).catch(() => {})
  await page.waitForLoadState('networkidle').catch(() => {})
  await settled(page)
}

export async function run(options = {}) {
  const outFile = options.out ?? arg('out') ?? join(homedir(), '.cache/claude-tmp/team-platform-ui/detectors.json')
  const screens = options.screens ?? list('screens', SCREEN_IDS)
  const viewports = options.viewports ?? list('viewports', Object.keys(VIEWPORTS))
  const themes = options.themes ?? list('themes', THEMES)
  const maxSaturated = Number(options.maxSaturated ?? arg('max-saturated') ?? MAX_SATURATED_DEFAULT)
  const port = Number(process.env.PANEL_DETECTORS_PORT ?? 8974)
  for (const s of screens) if (!SCREEN_IDS.includes(s)) throw new Error(`pantalla desconocida: ${s}`)
  for (const v of viewports) if (!VIEWPORTS[v]) throw new Error(`viewport desconocido: ${v}`)
  for (const t of themes) if (!THEMES.includes(t)) throw new Error(`tema desconocido: ${t}`)

  const scale = readTypeScale()
  const voice = loadVoicePatterns(options.voicePatterns ?? arg('voice-patterns'))
  const skipped = []
  if (voice.reason) skipped.push({ rule: 'voice', reason: voice.reason })

  const panel = await startPanel(port, { build: !(flag('no-build') || process.env.FIT_SIN_BUILD) })
  const merged = new Map() // screen|rule|selector -> finding
  const ratios = {}
  let unmeasurableContrast = 0
  try {
    // Ids that the screens need, from the seeded data of the example server.
    const probe = await panel.browser.newContext()
    const ppage = await probe.newPage()
    await login(ppage, panel.origin)
    const body = await (await ppage.request.get(`${panel.origin}/api/messages`)).json()
    const items = Array.isArray(body) ? body : body.items
    const rich = items.find((m) => m.title.startsWith('Revisar la lectura')) ?? items[0]
    const areasBody = await (await ppage.request.get(`${panel.origin}/api/areas`)).json()
    const areaList = Array.isArray(areasBody) ? areasBody : (areasBody.items ?? [])
    const area = areaList.find((a) => a.id === 'a-error') ?? areaList[0]
    await probe.close()
    const routes = {
      home: '/', messages: '/messages', 'message-detail': `/messages/${rich.id}`, areas: '/areas',
      'area-detail': area ? `/areas/${area.id}` : null, team: '/team', settings: '/settings', connections: '/connections', login: '/',
    }

    for (const viewport of viewports) {
      for (const theme of themes) {
        const context = await panel.browser.newContext({ viewport: VIEWPORTS[viewport], locale: 'es-CL', colorScheme: theme, reducedMotion: 'reduce' })
        await context.addInitScript((t) => { try { localStorage.setItem('team-theme', t) } catch {} }, theme)
        const page = await context.newPage()
        try {
          let loggedIn = false
          for (const id of screens) {
            const route = routes[id]
            if (route === null) { if (!skipped.some((s) => s.rule === id)) skipped.push({ rule: id, reason: 'la pantalla no existe en los datos de ejemplo' }); continue }
            if (id === 'login') {
              const anon = await panel.browser.newContext({ viewport: VIEWPORTS[viewport], locale: 'es-CL', colorScheme: theme, reducedMotion: 'reduce' })
              await anon.addInitScript((t) => { try { localStorage.setItem('team-theme', t) } catch {} }, theme)
              const lp = await anon.newPage()
              await lp.goto(panel.origin)
              await lp.getByLabel('Correo').waitFor()
              await settled(lp)
              await measure(lp, id, route, viewport, theme)
              await anon.close()
              continue
            }
            if (!loggedIn) { await login(page, panel.origin); loggedIn = true }
            await page.goto(`${panel.origin}${route}`)
            await settle(page, true)
            await measure(page, id, route, viewport, theme)
          }
        } finally {
          await context.close()
        }
      }
    }

    async function measure(page, id, route, viewport, theme) {
      await page.evaluate(installHelpers)
      const add = (f) => {
        const key = `${id}|${f.rule}|${f.selector}`
        const seenIn = `${viewport}-${theme}`
        const cur = merged.get(key)
        if (cur) { if (!cur.measure.seen_in.includes(seenIn)) { cur.measure.seen_in.push(seenIn); cur.measure.combinations++ } return }
        merged.set(key, { screen: id, route, viewport, theme, rule: f.rule, selector: f.selector, detail: f.detail, measure: { ...f.measure, combinations: 1, seen_in: [seenIn] } })
      }
      const args = { type: scale, voice, maxSaturated }
      for (const [name, fn] of Object.entries(DETECTORS)) {
        if (name === 'voice' && !voice.patterns) continue
        const input = name === 'type-scale' ? scale : name === 'equal-weight' ? { max: maxSaturated } : name === 'voice' ? { patterns: voice.patterns } : undefined
        const res = await runDetector(page, name, input)
        if (name === 'page-height') {
          ratios[id] ??= { route, ratios: {} }
          ratios[id].ratios[`${viewport}-${theme}`] = res.ratio
          if (viewport === 'desktop' && MUST_FIT.has(id) && res.ratio > 1.001) {
            add({ rule: 'page-height', selector: 'html', detail: `Alto de ${res.total} px en una ventana de ${res.window} (${res.ratio.toFixed(2)} ventanas), la pantalla debe caber en una`, measure: { ratio: res.ratio, total: res.total, window: res.window } })
          }
          continue
        }
        if (name === 'contrast') unmeasurableContrast += res.unmeasurable
        for (const f of res.findings) add(f)
      }
      void args
    }
  } finally {
    await panel.stop()
  }

  if (unmeasurableContrast) skipped.push({ rule: 'contrast', reason: `${unmeasurableContrast} textos sobre fondo con imagen o degradado no se miden (el fondo no es un color)` })

  const screensOut = {}
  for (const id of screens) screensOut[id] = { route: ratios[id]?.route ?? null, page_height_ratio: ratios[id]?.ratios ?? {}, findings: [] }
  for (const f of merged.values()) {
    const { screen, route, ...finding } = f
    screensOut[screen].route ??= route
    screensOut[screen].findings.push(finding)
  }
  const byRule = {}, byScreen = {}
  let total = 0
  for (const [id, s] of Object.entries(screensOut)) {
    byScreen[id] = s.findings.length
    for (const f of s.findings) { total++; byRule[f.rule] = (byRule[f.rule] ?? 0) + 1 }
  }
  const report = {
    generated_at: new Date().toISOString(), viewports, themes, screens: screensOut, skipped,
    summary: { total, by_rule: byRule, by_screen: byScreen },
  }
  mkdirSync(dirname(outFile), { recursive: true })
  writeFileSync(outFile, JSON.stringify(report, null, 2) + '\n')
  return { report, outFile }
}

/** Evaluates one detector in a page that already has the helpers (see installHelpers). */
export async function runDetector(page, name, input) {
  return page.evaluate(
    ({ src, input, consts }) => {
      // The constants the detectors read are declared in this file; they travel as globals of the page.
      Object.assign(window, consts)
      return new Function(`return (${src})`)()(input)
    },
    { src: DETECTORS[name].toString(), input, consts: CONSTS },
  )
}

/** Constants the in-page detectors read, shipped as globals. */
const CONSTS = { ALIGN_TOLERANCE_PX, MARK_MAX_WIDTH_PX, OVERLAP_MIN_PX, FONT_TOLERANCE_PX, LARGE_PX, LARGE_BOLD_PX, CONTRAST_NORMAL, CONTRAST_LARGE, SATURATION_MIN, VALUE_MIN }

export function summaryText(report, outFile) {
  const lines = []
  lines.push(`Detectores de interfaz: ${report.summary.total} hallazgos (${report.viewports.join(', ')} / ${report.themes.join(', ')})`)
  lines.push('', 'Por regla')
  for (const [k, v] of Object.entries(report.summary.by_rule).sort((a, b) => b[1] - a[1])) lines.push(`  ${k.padEnd(18)} ${String(v).padStart(4)}`)
  lines.push('', 'Por pantalla')
  for (const [k, v] of Object.entries(report.summary.by_screen)) {
    const r = report.screens[k].page_height_ratio
    const worst = Object.values(r).length ? Math.max(...Object.values(r)) : null
    lines.push(`  ${k.padEnd(18)} ${String(v).padStart(4)}${worst === null ? '' : `   alto máx. ${worst.toFixed(2)} ventanas`}`)
  }
  const all = Object.entries(report.screens).flatMap(([screen, s]) => s.findings.map((f) => ({ screen, ...f })))
  all.sort((a, b) => b.measure.combinations - a.measure.combinations)
  lines.push('', 'Los 10 hallazgos con más combinaciones')
  for (const f of all.slice(0, 10)) lines.push(`  ${f.measure.combinations}x ${f.screen} ${f.rule} ${f.selector.slice(-70)}\n      ${f.detail}`)
  if (report.skipped.length) {
    lines.push('', 'Omitido')
    for (const s of report.skipped) lines.push(`  ${s.rule}: ${s.reason}`)
  }
  lines.push('', `JSON: ${outFile}`)
  return lines.join('\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { report, outFile } = await run()
    if (flag('json')) process.stdout.write(JSON.stringify(report, null, 2) + '\n')
    else console.log(summaryText(report, outFile))
    process.exit(0)
  } catch (error) {
    console.error('ui-detectors falló:', error)
    process.exit(2)
  }
}
