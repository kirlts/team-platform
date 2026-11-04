// @vitest-environment node
// TP-14 (soft-locks 2026-11-04), the lists: the page of a list is part of the address (`?p=`), so Atrás from a message returns to the page it was
// left on and a reload keeps it. A list of the panel that pages and keeps the page only in state loses it on every visit to a row.
// Fails on the tree before the change: `FitList` kept `start` in `useState` and neither Mensajes nor the view of an area passed a page.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('.', import.meta.url))
const read = (f: string) => readFileSync(join(SRC, f), 'utf8')

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'assets' ? [] : files(path)
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : []
  })
}

/** The pages that draw a `FitList` of their own without a page in the URL, and why. A new page with a list has to carry `page=` or be named here. */
const PAGE_IN_STATE: Record<string, string> = {
  'pages/Home.tsx': 'two feeds of the latest messages and replies, side by side: a page of each one in one address has no meaning, and Atrás leaves for the full list',
  'pages/Areas.tsx': 'the catalog of areas: a handful of rows that fit the frame',
  'pages/Team.tsx': 'the roster: a handful of rows that fit the frame',
  'pages/Connections.tsx': 'the catalog of connections: a handful of rows that fit the frame',
}

describe('the page of a list is in the URL', () => {
  it('FitList takes its page from the address when it is given one', () => {
    const fit = read('components/FitList.tsx')
    expect(fit).toMatch(/page\?: UrlPage/)
    expect(fit).toMatch(/const start = page \? page\.start : ownStart/)
  })

  it('MessageList hands the page to its FitList', () => {
    expect(read('components/MessageList.tsx')).toMatch(/<FitList\s+page=\{page\}/)
  })

  it('every page that draws a MessageList passes useUrlPage', () => {
    const drawing = files(join(SRC, 'pages')).filter((f) => /<MessageList\b/.test(readFileSync(f, 'utf8')))
    expect(drawing.map((f) => relative(SRC, f)).sort()).toEqual(['pages/AreaView.tsx', 'pages/Messages.tsx'])
    for (const f of drawing) {
      const text = readFileSync(f, 'utf8')
      expect(text, relative(SRC, f)).toMatch(/useUrlPage\(\)/)
      expect(text, relative(SRC, f)).toMatch(/page=\{page\}/)
    }
  })

  it('no other page draws a FitList without naming why its page can stay in state', () => {
    const lone = files(join(SRC, 'pages'))
      .filter((f) => /<FitList\b/.test(readFileSync(f, 'utf8')) && !/page=\{/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f).replaceAll('\\', '/'))
      .filter((f) => !(f in PAGE_IN_STATE))
    expect(lone).toEqual([])
  })

  it('a change of page pushes an entry and a search or a filter replaces it (the policy is written in one module)', () => {
    const url = read('lib/useUrlState.ts')
    expect(url).toMatch(/replace: options\?\.replace \?\? false/)
    expect(read('pages/Messages.tsx')).toMatch(/setParams\(serializeQuery\(next\), \{ replace: true \}\)/)
    expect(read('pages/AreaView.tsx')).toMatch(/\{ replace: true \}/)
  })
})
