// @vitest-environment node
// TP-13 (soft-locks 2026-11-04). Every resource of the browser is released when the component that took it unmounts: a module that starts a recording
// (`startRecording(` opens the microphone) must stop it in the cleanup of an effect of the same module. Leaving the screen mid-recording left the
// microphone open, with the browser's indicator lit and no button to stop it.
// Fails on the tree before the change: `lib/useMediaDraft.ts` called `startRecording(` and its only cleanup revoked object URLs.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('.', import.meta.url))

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'assets' ? [] : files(path)
    return /\.(tsx?|mjs)$/.test(name) && !/\.test\.(tsx?|mjs)$/.test(name) ? [path] : []
  })
}

/** A cleanup that cancels: `useEffect(() => () => x.cancel(), [])` or `return () => { … x.cancel() … }`. */
const CANCELS_ON_CLEANUP = /useEffect\(\s*\(\)\s*=>\s*\(\)\s*=>[^)]*\.cancel\(\)|return\s*\(\)\s*=>\s*\{[^}]*\.cancel\(\)/

describe('a module that opens the microphone closes it when it unmounts', () => {
  it('every caller of startRecording( cancels in the cleanup of an effect', () => {
    const offenders = files(SRC)
      .filter((f) => !f.endsWith('lib/recorder.ts'))
      .filter((f) => /\bstartRecording\(/.test(readFileSync(f, 'utf8')))
      .filter((f) => !CANCELS_ON_CLEANUP.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f))
    expect(offenders).toEqual([])
  })

  it('there is at least one caller, so the check is not empty', () => {
    const callers = files(SRC).filter((f) => /\bstartRecording\(/.test(readFileSync(f, 'utf8')) && !f.endsWith('lib/recorder.ts'))
    expect(callers.length).toBeGreaterThan(0)
  })
})
