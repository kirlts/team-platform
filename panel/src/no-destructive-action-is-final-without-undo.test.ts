// @vitest-environment node
// Soft-lock class 3 (issue 8, TP-01 to TP-03, TP-10): no action of the client that deletes, empties, resets or retires is final without a way back.
// Each such method of `packages/client/src/resources.ts` has a `restore` beside it in its resource, or a row in `docs/ACCIONES-DESTRUCTIVAS.md`
// that declares which confirmation the panel asks for. A reversible action asks for none (it runs and offers Deshacer, kit T53), so a row
// for a method whose resource has a `restore` fails. A row for a method that does not exist is stale and fails too.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const resources = readFileSync(`${ROOT}packages/client/src/resources.ts`, 'utf8')
const register = (() => {
  try {
    return readFileSync(`${ROOT}docs/ACCIONES-DESTRUCTIVAS.md`, 'utf8')
  } catch {
    return ''
  }
})()

const DESTRUCTIVE = /^(delete|remove|reset|retire)/
const CONFIRMATIONS = ['nombre de la persona', 'nombre del proveedor', 'nombre del proyecto', 'un paso']

/** `resource.method` for every key of the resources object, found by its indentation (4 spaces the resource, 6 the method). */
function methods(): { resource: string; method: string }[] {
  const found: { resource: string; method: string }[] = []
  let resource = ''
  for (const line of resources.split('\n')) {
    const r = /^ {4}(\w+): \{/.exec(line)
    if (r) resource = r[1]!
    const m = /^ {6}(\w+):/.exec(line)
    if (m && resource) found.push({ resource, method: m[1]! })
  }
  return found
}

/** The rows of the register: `| resource.method | confirmation | what it asks |`. */
function rows(): { key: string; confirmation: string }[] {
  return register
    .split('\n')
    .map((line) => /^\|\s*`(\w+\.\w+)`\s*\|\s*([^|]+?)\s*\|/.exec(line))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ key: m[1]!, confirmation: m[2]! }))
}

describe('a destructive action has a way back', () => {
  const all = methods()
  const destructive = all.filter((x) => DESTRUCTIVE.test(x.method))
  const declared = new Map(rows().map((r) => [r.key, r.confirmation]))

  it('the client has destructive methods to check', () => {
    expect(destructive.length).toBeGreaterThan(8)
  })

  it('each one has a restore in its resource or a declared confirmation', () => {
    const naked = destructive.filter((x) => !all.some((y) => y.resource === x.resource && /^restore/.test(y.method)) && !declared.has(`${x.resource}.${x.method}`))
    expect(naked.map((x) => `${x.resource}.${x.method}`)).toEqual([])
  })

  it('a confirmation is asked only where there is no way back (kit T53: the dialog is for what cannot be undone)', () => {
    const withRestore = [...declared.keys()].filter((key) => {
      const resource = key.split('.')[0]
      return all.some((y) => y.resource === resource && /^restore/.test(y.method))
    })
    expect(withRestore).toEqual([])
  })

  it('a declared confirmation is one of the known kinds', () => {
    expect([...declared.values()].filter((c) => !CONFIRMATIONS.includes(c))).toEqual([])
  })

  it('the register names no method that does not exist', () => {
    const existing = new Set(all.map((x) => `${x.resource}.${x.method}`))
    expect([...declared.keys()].filter((k) => !existing.has(k))).toEqual([])
  })
})
