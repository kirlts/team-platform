import { describe, expect, it } from 'vitest'
import { areaPalette, areaStyle, contrast, isAreaColor } from './area-color'

/** The initial colors of templates/areas.json and the colors a person could pick at the extremes. */
const INITIAL = ['#6d28d9', '#c2410c', '#15803d', '#0f766e', '#a21caf']
const EXTREMES = ['#000000', '#ffffff', '#ffff00', '#00ff00', '#0000ff', '#ff0000', '#00ffff', '#ff00ff', '#777777', '#808080', '#ffd700', '#fffacd', '#0a0a1a']

describe('area palette', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`keeps 4.5:1 for text on the chip and on the tint, and 3:1 for the edge, in ${theme} theme, for every initial and extreme color`, () => {
      for (const color of [...INITIAL, ...EXTREMES]) {
        const p = areaPalette(color, theme)
        expect(contrast(p.mainText, p.main), `${color} chip`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(p.softText, p.soft), `${color} tint text`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(p.edge, p.soft), `${color} edge`).toBeGreaterThanOrEqual(3)
      }
    })
  }

  it('makes the tint pale in the light theme and deep in the dark one, and the chosen color stays the main one', () => {
    const light = areaPalette('#ff0000', 'light')
    const dark = areaPalette('#ff0000', 'dark')
    expect(light.main).toBe('#ff0000')
    expect(dark.main).toBe('#ff0000')
    expect(contrast(light.soft, '#ffffff')).toBeLessThan(1.3) // a pale pink
    expect(contrast(dark.soft, '#000000')).toBeLessThan(2) // a dark red
    // Pink, not grey: the tint of a red keeps red above blue and green.
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(light.soft.slice(i, i + 2), 16))
    expect(r).toBeGreaterThan(g)
    expect(r).toBeGreaterThan(b)
  })

  it('gives different tints to different colors, so two areas are told apart', () => {
    const tints = new Set(INITIAL.map((c) => areaPalette(c, 'light').soft))
    expect(tints.size).toBe(INITIAL.length)
  })

  it('accepts only #rrggbb and falls back for anything else', () => {
    expect(isAreaColor('#a1B2c3')).toBe(true)
    for (const bad of ['red', '#abc', '#12345g', '', undefined, 3]) expect(isAreaColor(bad)).toBe(false)
    expect(areaPalette('nonsense', 'light').main).toBe('#4f46e5')
  })

  it('writes the pair of both themes as CSS variables', () => {
    const style = areaStyle('#15803d')
    expect(style['--area-light-main']).toBe('#15803d')
    expect(Object.keys(style)).toHaveLength(10)
  })
})
