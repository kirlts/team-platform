// @vitest-environment node
// UD-016: no text is cut with an ellipsis. Text wraps, moves to another line or the layout changes.
// A line that really needs one of these says why in a `justified:` comment on the same line.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('.', import.meta.url))

const FORBIDDEN: { name: string; test: (line: string) => boolean }[] = [
  { name: 'truncate', test: (l) => /(^|[\s"'`:])truncate(?=[\s"'`]|$)/.test(l) },
  { name: 'line-clamp', test: (l) => /line-clamp/.test(l) },
  { name: 'text-ellipsis', test: (l) => /text-ellipsis/.test(l) },
  { name: 'text-overflow', test: (l) => /text-overflow/.test(l) },
  { name: 'overflow-hidden with whitespace-nowrap', test: (l) => /overflow-hidden/.test(l) && /whitespace-nowrap/.test(l) },
  { name: 'overflow: hidden with white-space: nowrap', test: (l) => /overflow:\s*hidden/.test(l) && /white-space:\s*nowrap/.test(l) },
]

export function offenses(line: string): string[] {
  if (/justified:/.test(line)) return []
  return FORBIDDEN.filter((f) => f.test(line)).map((f) => f.name)
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'assets' ? [] : files(path)
    return /\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

describe('no truncation (UD-016)', () => {
  it('recognises each forbidden form and the justification', () => {
    expect(offenses('<span className="min-w-0 truncate">')).toEqual(['truncate'])
    expect(offenses('<p className="line-clamp-2 text-sm">')).toEqual(['line-clamp'])
    expect(offenses('text-overflow: ellipsis;')).toEqual(['text-overflow'])
    expect(offenses('<span className="overflow-hidden whitespace-nowrap">')).toEqual(['overflow-hidden with whitespace-nowrap'])
    expect(offenses('<span className="truncate"> {/* justified: the value is a fixed-width code */}')).toEqual([])
    expect(offenses('<div className="glass leaf overflow-hidden">')).toEqual([])
    expect(offenses('<span className="break-words">truncated text is not a class</span>')).toEqual([])
  })

  it('no file under src/ truncates text without a justification', () => {
    const found: string[] = []
    for (const file of files(SRC)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          for (const name of offenses(line)) found.push(`${relative(SRC, file)}:${i + 1} ${name}`)
        })
    }
    expect(found).toEqual([])
  })
})
