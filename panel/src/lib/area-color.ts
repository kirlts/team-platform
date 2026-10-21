// Color of an area (UD-045). The Editor chooses one color, `#rrggbb`; the panel derives the rest from it, so
// there is no second value to keep in step. The derivation works in OKLCH (the same space as the panel's tokens in
// styles.css) because lightness there is perceptual: «light tint at L 0.95, dark tint at L 0.27» gives the same
// feel for every hue, which HSL does not (a yellow and a blue of equal HSL lightness differ a lot in brightness).
// The chip is the area color with black or white text, whichever contrasts more (always ≥ 4.5:1: the worst case
// of that choice is 4.58:1); the analysis box is the tint with a near-ink text of the same hue.
// Pure and dependency free: `scripts/contraste.mjs` imports this same file to measure the pairs.

export type AreaTheme = 'light' | 'dark'

export interface AreaPalette {
  /** The area color, as chosen. Chip fill. */
  main: string
  /** Text on `main`: black or white. */
  mainText: string
  /** Secondary: the tint the analysis box has. Pale in the light theme, deep in the dark one. */
  soft: string
  /** Text on `soft`. */
  softText: string
  /** Border and marks of the area on `soft` and on the page: at least 3:1 against `soft`. */
  edge: string
}

type Rgb = [number, number, number]
interface Oklch { l: number; c: number; h: number }

export const AREA_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/
export const isAreaColor = (value: unknown): value is string => typeof value === 'string' && AREA_COLOR_PATTERN.test(value)
/** What an area shows when the server did not send one (an older server). */
export const FALLBACK_AREA_COLOR = '#4f46e5'

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const fromLinear = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)

export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export const rgbToHex = (rgb: Rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')

function rgbToOklch(rgb: Rgb): Oklch {
  const [r, g, b] = rgb.map((v) => toLinear(v / 255))
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return { l: L, c: Math.hypot(a, bb), h: ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360 }
}

/** OKLCH to sRGB (0 to 255). A color outside the gamut loses chroma until it fits, keeping lightness and hue. */
function oklchToRgb({ l, c, h }: Oklch): Rgb {
  const make = (chroma: number): number[] => {
    const a = chroma * Math.cos((h * Math.PI) / 180)
    const b = chroma * Math.sin((h * Math.PI) / 180)
    const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
    const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
    const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
    return [4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_, -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_, -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_]
  }
  let chroma = c
  let lin = make(chroma)
  for (let i = 0; i < 24 && lin.some((v) => v < -0.0005 || v > 1.0005); i++) {
    chroma *= 0.8
    lin = make(chroma)
  }
  return lin.map((v) => clamp01(fromLinear(clamp01(v))) * 255) as Rgb
}

/** WCAG 2 relative luminance and contrast ratio. */
export function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((v) => toLinear(v / 255))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(hexToRgb(a)), luminance(hexToRgb(b))].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const hex = (o: Oklch) => rgbToHex(oklchToRgb(o))

/**
 * The five colors of an area in one theme.
 * - `soft`: lightness 0.95 (light) or 0.27 (dark), chroma a third of the color's up to 0.05 so the tint reads as the same hue without shouting.
 * - `softText`: lightness 0.25 (light) or 0.95 (dark), the same hue at low chroma.
 * - `edge`: the color itself with its lightness pushed to at most 0.55 (light) or at least 0.7 (dark), and further until it is 3:1 from `soft`.
 */
export function areaPalette(color: string, theme: AreaTheme): AreaPalette {
  const main = (isAreaColor(color) ? color : FALLBACK_AREA_COLOR).toLowerCase()
  const base = rgbToOklch(hexToRgb(main))
  const light = theme === 'light'
  const soft = hex({ l: light ? 0.95 : 0.27, c: Math.min(base.c * 0.33, 0.05), h: base.h })
  const softText = hex({ l: light ? 0.25 : 0.95, c: Math.min(base.c * 0.25, 0.04), h: base.h })
  let l = light ? Math.min(base.l, 0.55) : Math.max(base.l, 0.7)
  let edge = hex({ l, c: base.c, h: base.h })
  for (let i = 0; i < 40 && contrast(edge, soft) < 3; i++) {
    l = light ? l - 0.02 : l + 0.02
    edge = hex({ l, c: base.c, h: base.h })
  }
  const mainText = contrast('#ffffff', main) >= contrast('#000000', main) ? '#ffffff' : '#000000'
  return { main, mainText, soft, softText, edge }
}

/** The CSS variables a box or chip of this area carries; the stylesheet picks the pair of the current theme (`.area-tint`). */
export function areaStyle(color: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const theme of ['light', 'dark'] as const) {
    const p = areaPalette(color ?? FALLBACK_AREA_COLOR, theme)
    for (const [k, v] of Object.entries(p)) out[`--area-${theme}-${k}`] = v
  }
  return out
}
