// The host adapter of the capture tool: the one file where everything that belongs to the host lives (its address, its account, its routes, the keys
// that name its people). It is an ES module the host declares in `LOOK_HOST` (a path, relative to the working directory of the session). The tool names
// no address, account, route or screen of any host; without an adapter it looks at `LOOK_ORIGIN` as an anonymous visitor.
//
// export default {
//   origin: 'https://app.example',                  // optional when LOOK_ORIGIN is set
//   flags: ['clinic', 'role'],                      // options that take a value (`--clinic X`); they reach `session` as `options`
//   allowHosts: [],                                 // other hosts the browser may resolve (a CDN); the guard still cuts every request to them
//   playwrightDirs: [],                             // where Playwright may be installed, relative to the working directory
//   context: { locale: 'es-CL', timezoneId: '…' },   // options of the browser context (language and time zone of the screens)
//   guard: { browserPosts: [/…/], blockedGets: [/…/], sessionPosts: { login: /…/ } },
//   mask: { patterns: [/…/], personKey: /…/, genericKey: /…/, personContext: /…/, learnFrom: /…/ },
//   loadingText: /(^|\n)\s*Loading/,                // text of a page that has not settled yet
//   expiredText: /session (expired|ended)/i,        // text of a page whose session ended
//   loginPaths: /\/login$/,                         // a 401 on these is not an expired session
//   async session ({ options, api, log, fail, fresh }) { … return { as, init: { sessionStorage, localStorage, cookies, headers } } },
//   url ({ place, first, session, origin }) { … return 'https://…' },        // address of a route place
//   menuStart ({ first, session, origin }) { … return 'https://…' },        // where a menu place starts
//   effectMarks: [['name', /…/]]                    // extra marks for `get-effects.mjs`
// }
//
// `session` returns who the tool looks as (`as`, one line, goes into every capture) and what to put in the browser before the first page: storage,
// cookies, headers. `api(path, { method, body, token, permit, tolerate401 })` is a `fetch` under the read-only guard (`guard.js`): a POST it makes
// has to be in `permit` (the host's `sessionPosts`). `fail(message, code)` ends the run with that exit code (5 by default: could not sign in).
import { access } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { personRules } from './learn.js'

const regexList = (name, value) => {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every((v) => v instanceof RegExp)) throw new Error(`the adapter's ${name} has to be a list of RegExp`)
  return value
}
const stringList = (name, value) => {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) throw new Error(`the adapter's ${name} has to be a list of strings`)
  return value
}
const optionalRegex = (name, value, fallback) => {
  if (value === undefined) return fallback
  if (!(value instanceof RegExp)) throw new Error(`the adapter's ${name} has to be a RegExp`)
  return value
}
const optionalFunction = (name, value) => {
  if (value === undefined) return null
  if (typeof value !== 'function') throw new Error(`the adapter's ${name} has to be a function`)
  return value
}

/** The adapter as the tool uses it, with every omission filled in. Throws an error whose message names what is wrong in the adapter. */
export function normalizeHost (raw = {}) {
  if (raw === null || typeof raw !== 'object') throw new Error('the adapter has to export an object (the default export)')
  const guard = raw.guard ?? {}
  const mask = raw.mask ?? {}
  if (raw.origin !== undefined && typeof raw.origin !== 'string') throw new Error("the adapter's origin has to be a string")
  return {
    origin: raw.origin ?? null,
    flags: stringList('flags', raw.flags),
    allowHosts: stringList('allowHosts', raw.allowHosts),
    playwrightDirs: stringList('playwrightDirs', raw.playwrightDirs),
    context: raw.context && typeof raw.context === 'object' ? raw.context : {},
    guard: {
      browserPosts: regexList('guard.browserPosts', guard.browserPosts),
      blockedGets: regexList('guard.blockedGets', guard.blockedGets),
      sessionPosts: Object.fromEntries(Object.entries(guard.sessionPosts ?? {}).map(([k, v]) => { if (!(v instanceof RegExp)) throw new Error(`the adapter's guard.sessionPosts.${k} has to be a RegExp`); return [k, v] }))
    },
    mask: { patterns: regexList('mask.patterns', mask.patterns), rules: personRules(mask), learnFrom: optionalRegex('mask.learnFrom', mask.learnFrom, /./) },
    loadingText: optionalRegex('loadingText', raw.loadingText, /(^|\n)\s*Loading/i),
    expiredText: optionalRegex('expiredText', raw.expiredText, /session (expired|ended|timed out)/i),
    loginPaths: optionalRegex('loginPaths', raw.loginPaths, /\/login$/),
    session: optionalFunction('session', raw.session),
    url: optionalFunction('url', raw.url),
    menuStart: optionalFunction('menuStart', raw.menuStart),
    effectMarks: Array.isArray(raw.effectMarks) ? raw.effectMarks : []
  }
}

/** Loads the adapter named by `file` (relative to `cwd`). Without a file: the adapter with every omission. */
export async function loadHost (file, cwd = process.cwd()) {
  if (!file) return normalizeHost({})
  const full = isAbsolute(file) ? file : resolve(cwd, file)
  try { await access(full) } catch { throw new Error(`LOOK_HOST points at ${full} and there is no such file`) }
  let module
  try { module = await import(pathToFileURL(full).href) } catch (error) { throw new Error(`the adapter ${full} could not be loaded: ${String(error.message).split('\n')[0]}`) }
  return normalizeHost(module.default ?? module)
}
