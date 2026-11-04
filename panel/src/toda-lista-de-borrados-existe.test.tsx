// @vitest-environment node
// Soft-lock class 2 (issue 8, TP-01, TP-07, TP-08): everything the server restores has a control in the panel that restores it, and what is
// deleted or discarded is listed there, so the way back does not depend on the 8 s of a notice or on the screen still being mounted.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const hooks = readFileSync(`${ROOT}packages/client/src/react/hooks.ts`, 'utf8')
const resources = readFileSync(`${ROOT}packages/client/src/resources.ts`, 'utf8')

function panelSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'assets' ? [] : panelSources(path)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [readFileSync(path, 'utf8')] : []
  })
}
const panel = panelSources(fileURLToPath(new URL('.', import.meta.url))).join('\n')

describe('every restore has a control and every trash has a list', () => {
  const restoreHooks = [...hooks.matchAll(/export function (useRestore\w+)\(/g)].map((m) => m[1]!)

  it('the client has restore hooks to check', () => {
    expect(restoreHooks.length).toBeGreaterThan(6)
  })

  it('each restore hook is used by the panel', () => {
    expect(restoreHooks.filter((name) => !new RegExp(`\\b${name}\\b`).test(panel))).toEqual([])
  })

  it('the sends and the replies have their list of deleted ones in the client and the panel', () => {
    for (const name of ['useDeletedInputs', 'useDeletedReplies']) {
      expect(hooks, `${name} in the client`).toMatch(new RegExp(`export function ${name}\\(`))
      expect(panel, `${name} in the panel`).toMatch(new RegExp(`\\b${name}\\b`))
    }
  })

  it('a discarded send is listed in Inicio with its restore', () => {
    expect(resources).toMatch(/listDiscarded:/)
    expect(panel).toMatch(/useDiscardedInputs/)
  })
})
