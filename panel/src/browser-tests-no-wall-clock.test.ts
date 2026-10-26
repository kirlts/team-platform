// The browser tests of the pool wait for events, never for the wall clock, and the runner never runs a file again (hard rule 14 of the deploying
// repository: a race is not fixed with a retry or a pause). 2026-10-26, deploy server (4 cores, three files at a time next to image builds): a
// different file failed in each run and each one passed alone. The causes were a sample-data tie broken by the millisecond of the seeding, a
// keep-alive socket closed by the server at the moment the client reused it, and a video judged by 800 ms of wall clock.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const read = (file: string) => readFileSync(join(__dirname, '..', file), 'utf8')

/** The files that failed under load, and the shared helper they use. */
const WATCHED = [
  'src/flows-revision.browser.test.mjs',
  'src/gallery.browser.test.mjs',
  'src/flows-ronda5-listas.browser.test.mjs',
  'src/flows-tarjetas-vistazo.browser.test.mjs',
  'src/fits-one-screen.browser.test.mjs',
  'src/browser-support.mjs',
]

/** A wait or an observation window counted in wall-clock time. A line that has one on purpose says so: `wall-clock-ok: <why>` on it or on the line above. */
const WALL_CLOCK = [/waitForTimeout\(/, /\bsetTimeout\(/, /\bsetInterval\(/, /\bsleep\(/, /performance\.now\(\)\s*-/, /Date\.now\(\)\s*-/]

describe('browser tests without waits on the wall clock', () => {
  for (const file of WATCHED) {
    test(`${file} has no wait counted in milliseconds`, () => {
      const lines = read(file).split('\n')
      const found = lines
        .map((text, i) => ({ text, i }))
        .filter(({ text, i }) => WALL_CLOCK.some((p) => p.test(text)) && !/wall-clock-ok:/.test(`${lines[i - 1] ?? ''}\n${text}`) && !/^\s*(\/\/|\*|\/\*)/.test(text))
        .map(({ text, i }) => `${file}:${i + 1}: ${text.trim().slice(0, 100)}`)
      expect(found, 'wait for an event or a state (expect.poll, waitFor, control.hold/release, a frame clock), or declare the line with «wall-clock-ok: why»').toEqual([])
    })
  }

  test('the pool runner does not run a failed file again', () => {
    const runner = read('scripts/browser-tests.mjs')
    expect(runner).not.toMatch(/PANEL_BROWSER_RETRY|rerun|reintento/)
  })

  test('the example server never closes an idle keep-alive connection by itself', () => {
    // Node closes them after 5 s; a client that reuses one at that moment gets ECONNRESET (page.route + route.fetch under load).
    expect(read('dev-server.mjs')).toMatch(/server\.keepAliveTimeout\s*=\s*0/)
  })

  test('the sample dates of the example server hang from one instant', () => {
    const server = read('dev-server.mjs')
    expect(server).toMatch(/const ago = \(minutes\) => new Date\(BORN - /)
    expect(server).not.toMatch(/Date\.now\(\) - minutes/)
  })
})
