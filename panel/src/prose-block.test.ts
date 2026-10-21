// @vitest-environment node
// UD-022: running text is justified without hyphenation, with a single shared class,
// `.prose-block`. No component justifies on its own and the class never turns `hyphens` on.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('.', import.meta.url))

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'assets' ? [] : files(path)
    return /\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

/** The body of `.prose-block { ... }` in styles.css, with the `[data-wide]` rule that justifies it. */
function proseRule(css: string): string {
  const match = /\.prose-block\s*\{([^}]*)\}/.exec(css)
  if (!match) throw new Error('styles.css no define .prose-block')
  const wide = /\.prose-block\[data-wide\]\s*\{([^}]*)\}/.exec(css)
  if (!wide) throw new Error('styles.css no define .prose-block[data-wide], la regla que justifica (UD-034)')
  return `${match[1]}\n${wide[1]}`
}

describe('prose-block (UD-022, UD-034)', () => {
  const css = readFileSync(join(SRC, 'styles.css'), 'utf8')
  const rule = proseRule(css)

  it('justifies, never hyphenates and balances the last lines', () => {
    expect(rule).toMatch(/text-align:\s*justify/)
    expect(rule).toMatch(/hyphens:\s*none/)
    expect(rule).toMatch(/text-wrap:\s*pretty/)
    expect(rule).not.toMatch(/hyphens:\s*(auto|manual)/)
  })

  it('aligns to the left by default and justifies only the blocks wide enough (J3-A-21)', () => {
    const base = /\.prose-block\s*\{([^}]*)\}/.exec(css)![1]
    expect(base).toMatch(/text-align:\s*left/)
    expect(base).not.toMatch(/justify/)
    const main = readFileSync(join(SRC, 'main.tsx'), 'utf8')
    expect(main).toMatch(/watchProse\(\)/)
    const lib = readFileSync(join(SRC, 'lib/prose-width.ts'), 'utf8')
    // The width comes from the measurement of UD-034: the constant and the document that cites it move together.
    expect(/JUSTIFY_MIN_REM\s*=\s*([\d.]+)/.exec(lib)![1]).toBe('29.2')
    const decisions = readFileSync(join(SRC, '../../docs/USER-DECISIONS.md'), 'utf8')
    expect(decisions).toMatch(/UD-034/)
    expect(decisions).toMatch(/438 px/)
  })

  it('nothing else sets text-align: justify, and nothing turns hyphens on', () => {
    const found: string[] = []
    for (const file of files(SRC)) {
      const text = readFileSync(file, 'utf8')
      const scrubbed = file.endsWith('styles.css') ? text.replace(/\.prose-block(\[data-wide\])?\s*\{[^}]*\}/g, '') : text
      scrubbed.split('\n').forEach((line, i) => {
        if (/text-justify|text-align:\s*justify|\bjustify\s*:/.test(line) && !/justify-(start|end|center|between|around|evenly|items|self|content)/.test(line.replace(/text-justify/, ''))) {
          found.push(`${relative(SRC, file)}:${i + 1} justifica fuera de .prose-block`)
        }
        if (/hyphens-(auto|manual)|hyphens:\s*(auto|manual)/.test(line)) found.push(`${relative(SRC, file)}:${i + 1} enciende hyphens`)
      })
    }
    expect(found).toEqual([])
  })
})
