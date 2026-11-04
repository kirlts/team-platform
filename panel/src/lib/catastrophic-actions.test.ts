// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CATASTROPHIC_ACTIONS, namesTheObject } from './catastrophic-actions'

describe('namesTheObject', () => {
  it('accepts the name with other case and spaces at the ends', () => {
    expect(namesTheObject('  mi proyecto ', 'Mi Proyecto')).toBe(true)
  })
  it('refuses a different text, an empty one and an empty name', () => {
    expect(namesTheObject('mi', 'Mi Proyecto')).toBe(false)
    expect(namesTheObject('', 'Mi Proyecto')).toBe(false)
    expect(namesTheObject('', '')).toBe(false)
  })
})

describe('typing a name is only for the catastrophic actions', () => {
  const src = fileURLToPath(new URL('..', import.meta.url))
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) return name === 'assets' ? [] : files(path)
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
    })
  it('namesTheObject is called only from the screens of the listed actions', () => {
    const users = files(src).filter((f) => !f.endsWith('catastrophic-actions.ts') && /\bnamesTheObject\b/.test(readFileSync(f, 'utf8')))
    expect(users.map((f) => f.slice(src.length))).toEqual(['components/DataReset.tsx'])
    expect(CATASTROPHIC_ACTIONS).toEqual(['reset.everything'])
  })
})
