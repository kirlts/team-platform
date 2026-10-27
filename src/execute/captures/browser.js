// The browser of the tool: where Playwright comes from, which Chromium it starts, and how everything it started is stopped.
// Playwright is never a dependency of this code: the host has its own (the session copies this folder next to `team`, with no repository around it).
import { createRequire } from 'node:module'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

/**
 * Playwright from the host, wherever the tool runs from. Looked up in `LOOK_PLAYWRIGHT_DIR`, `TEAM_PLAYWRIGHT_DIR` (the same one `team walkthrough` reads),
 * the directories the host's adapter names (`playwrightDirs`, relative to the working directory), the working directory and `~/.tp-playwright`
 * (where a work machine installs its copy). null when none has it. Same search as `loadPlaywright` in scripts/walkthrough.mjs, which travels alone and
 * cannot be imported from here.
 */
export function loadPlaywright ({ env = process.env, cwd = process.cwd(), hostDirs = [] } = {}) {
  const absolute = (p) => (isAbsolute(p) ? p : resolve(cwd, p))
  const bases = [env.LOOK_PLAYWRIGHT_DIR, env.TEAM_PLAYWRIGHT_DIR, ...hostDirs, cwd, join(env.HOME ?? homedir(), '.tp-playwright')].filter(Boolean).map(absolute)
  for (const base of bases) {
    try { return createRequire(join(base, 'package.json'))('playwright') } catch { /* next base */ }
  }
  return null
}

/** The executable to start: `LOOK_CHROMIUM`, else Playwright's own when it is on disk (undefined: let Playwright choose), else a system Chromium or Chrome. */
export function chromiumExecutable (chromium, env = process.env, exists = existsSync) {
  if (env.LOOK_CHROMIUM) return env.LOOK_CHROMIUM
  try { if (exists(chromium.executablePath())) return undefined } catch { /* next */ }
  for (const candidate of ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) if (exists(candidate)) return candidate
  return undefined
}

/** The browser resolves no name but the origin's, `localhost` and what the host allows: the second layer under the guard (a page cannot reach a destination it has no name for). */
export const hostResolverRules = (origin, allowHosts = []) => `MAP * ~NOTFOUND, ${[new URL(origin).host, 'localhost', '127.0.0.1', ...allowHosts].map((h) => `EXCLUDE ${h}`).join(', ')}`

export async function launchBrowser (chromium, { origin, allowHosts = [], executable }) {
  return chromium.launch({ headless: true, executablePath: executable, args: [`--host-resolver-rules=${hostResolverRules(origin, allowHosts)}`, '--disable-background-networking', '--no-first-run'] })
}

/** The processes this one started (the browser and its helpers), read from /proc: Linux. */
export function descendants (pid = process.pid, proc = '/proc') {
  const children = new Map()
  for (const d of readdirSync(proc)) {
    if (!/^\d+$/.test(d)) continue
    try {
      const stat = readFileSync(`${proc}/${d}/stat`, 'utf8')
      const ppid = Number(stat.slice(stat.lastIndexOf(') ') + 2).split(' ')[1])
      ;(children.get(ppid) ?? children.set(ppid, []).get(ppid)).push(Number(d))
    } catch { /* it ended while it was read */ }
  }
  const found = []; const pending = [pid]
  while (pending.length) for (const child of children.get(pending.pop()) ?? []) { found.push(child); pending.push(child) }
  return found
}

/** Kills only what this process started. A signal never goes to a parent or to the system. */
export function killDescendants () {
  for (const p of descendants()) { try { process.kill(p, 'SIGKILL') } catch { /* already gone */ } }
}
