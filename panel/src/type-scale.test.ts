// @vitest-environment node
// J1-A-53: the panel has three type steps with a clear jump between them (support 12 px, body 15 px,
// headings from 18.75 px) and nothing below 12 px. The tokens live in styles.css; a component that
// writes its own size with `text-[…]` may only do it for a heading size. The browser side of the same
// rule (every visible text node measured) is in fits-one-screen.browser.test.mjs.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('.', import.meta.url))
const ROOT_PX = 15
const SUPPORT_MIN_PX = 12
const HEADING_MIN_PX = 18.75

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'assets' ? [] : files(path)
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : []
  })
}

const px = (value: string, unit: string) => (unit === 'rem' ? Number(value) * ROOT_PX : Number(value))

describe('type scale (J1-A-53)', () => {
  const css = readFileSync(join(SRC, 'styles.css'), 'utf8')

  it('the support, body and heading tokens keep their steps', () => {
    const token = (name: string) => {
      const m = new RegExp(`--text-${name}:\\s*([\\d.]+)rem`).exec(css)
      if (!m) throw new Error(`styles.css no define --text-${name}`)
      return Number(m[1]) * ROOT_PX
    }
    expect(token('xs')).toBeGreaterThanOrEqual(SUPPORT_MIN_PX)
    expect(token('sm')).toBeGreaterThanOrEqual(token('xs') * 1.2)
    expect(token('lg')).toBeGreaterThanOrEqual(token('sm') * 1.2)
  })

  it('no component writes an arbitrary size below the heading step', () => {
    const found: string[] = []
    for (const file of files(SRC)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          for (const m of line.matchAll(/text-\[([\d.]+)(px|rem)\]/g)) {
            if (px(m[1], m[2]) < HEADING_MIN_PX) found.push(`${relative(SRC, file)}:${i + 1} ${m[0]}`)
          }
        })
    }
    expect(found).toEqual([])
  })

  it('the field size on a phone is a step of the scale and at least 16 px, so iOS does not zoom on focus (H-2302, UD-191)', () => {
    const rule = /@media \(max-width: 640px\)\s*{\s*input,\s*textarea\s*{\s*font-size:\s*([^;!]+?)\s*!important/.exec(css)
    expect(rule, 'styles.css no fija el tamaño de los campos en teléfono').not.toBeNull()
    const token = /^var\(--text-([a-z]+)\)$/.exec(rule![1])
    expect(token, `el tamaño ${rule![1]} no es un paso de la escala`).not.toBeNull()
    const size = Number(new RegExp(`--text-${token![1]}:\\s*([\\d.]+)rem`).exec(css)![1]) * ROOT_PX
    expect(size).toBeGreaterThanOrEqual(16)
  })
})
