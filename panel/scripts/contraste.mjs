#!/usr/bin/env node
// Measures the contrast (WCAG 2) of the panel's text pairs by reading the OKLCH tokens of
// src/styles.css, in light and dark theme. Glass surfaces (with transparency) are
// composited over both extremes of the sky, and the worst case is taken. Exits with 1 if a pair
// falls below its minimum. Usage: npm run contraste

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const css = readFileSync(fileURLToPath(new URL('../src/styles.css', import.meta.url)), 'utf8')

function block(selector) {
  const start = css.indexOf(selector)
  const open = css.indexOf('{', start)
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i)
  }
  return ''
}

function tokens(text) {
  const out = {}
  for (const m of text.matchAll(/--color-([a-z0-9-]+):\s*oklch\(([^)]+)\)/g)) {
    const [color, alpha] = m[2].split('/').map((s) => s.trim())
    const [l, c, h] = color.split(/\s+/).map(Number)
    out[m[1]] = { l, c, h, a: alpha === undefined ? 1 : Number(alpha) }
  }
  return out
}

function toSrgb({ l, c, h }) {
  const a = c * Math.cos((h * Math.PI) / 180)
  const b = c * Math.sin((h * Math.PI) / 180)
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  const lin = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ]
  return lin.map((v) => Math.min(1, Math.max(0, v)))
}

const lum = (rgb) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const over = (top, under) => {
  const t = toSrgb(top)
  return t.map((v, i) => v * top.a + under[i] * (1 - top.a))
}
const flat = (t) => toSrgb(t)

const light = tokens(block(':root[data-theme'.slice(0, 0) + '@theme'))
const dark = { ...light, ...tokens(block(":root[data-theme='dark']")) }

let failed = 0
function row(theme, name, fg, bgs, min) {
  const worst = Math.min(...bgs.map((bg) => ratio(fg, bg)))
  const ok = worst >= min
  if (!ok) failed++
  console.log(`${ok ? 'ok ' : 'MAL'} ${theme.padEnd(6)} ${worst.toFixed(2).padStart(5)} (mín ${min})  ${name}`)
}

for (const [theme, t] of [['claro', light], ['oscuro', dark]]) {
  const skyEnds = [t['sky-a'], t['sky-b'], t['sky-c']].map(flat)
  const onGlass = (token) => skyEnds.map((sky) => over(t[token], sky))
  const fg = (name) => flat(t[name])
  // Text over the sky and over the glass (worst case among the three extremes).
  row(theme, 'fg sobre cielo', fg('fg'), skyEnds, 4.5)
  row(theme, 'fg sobre vidrio', fg('fg'), onGlass('glass'), 4.5)
  row(theme, 'fg sobre vidrio fuerte', fg('fg'), onGlass('glass-strong'), 4.5)
  row(theme, 'muted sobre vidrio', fg('muted'), onGlass('glass'), 4.5)
  row(theme, 'muted sobre vidrio fuerte', fg('muted'), onGlass('glass-strong'), 4.5)
  row(theme, 'faint sobre vidrio (marcadores de posición)', fg('faint'), onGlass('glass'), 4.5)
  row(theme, 'accent-deep sobre vidrio', fg('accent-deep'), onGlass('glass'), 4.5)
  row(theme, 'accent sobre vidrio (enlaces)', fg('accent'), onGlass('glass'), 4.5)
  row(theme, 'fg sobre pozo (campos)', fg('fg'), [fg('raised')], 4.5)
  row(theme, 'fg sobre cromo (cabecera, claro)', fg('fg'), ['chrome-1', 'chrome-2', 'chrome-3', 'chrome-4'].map(fg), 4.5)
  row(theme, 'danger sobre vidrio', fg('danger'), onGlass('glass'), 4.5)
  for (const s of ['open', 'answered', 'closed']) row(theme, `estado ${s}: texto sobre su fondo`, fg(`${s}-fg`), [fg(`${s}-bg`)], 4.5)
  row(theme, 'accent-deep sobre accent-soft', fg('accent-deep'), [fg('accent-soft')], 4.5)
  // Gel button: text over the gradient at the text point (30 % of the height), with the highlight.
  const mix = (a, b, k) => a.map((v, i) => v * (1 - k) + b[i] * k)
  const top = fg('gel-top')
  const bottom = fg('gel-bottom')
  const at = (k) => mix(top, bottom, k)
  const gloss = (rgb, k) => mix(rgb, [1, 1, 1], 0.22 * (1 - k / 0.5))
  row(theme, 'texto del gel (30 % del alto, con brillo)', fg('gel-fg'), [gloss(at(0.3), 0.3), at(0.7)], 4.5)
  // Controls: a field's border against the glass must be visible (3:1).
  row(theme, 'borde de controles (edge) sobre vidrio', fg('edge'), onGlass('glass'), 3)
}

if (failed) {
  console.error(`\n${failed} par(es) bajo el mínimo.`)
  process.exit(1)
}
console.log('\nTodos los pares cumplen su mínimo.')
