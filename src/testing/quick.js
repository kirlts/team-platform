// Logic of `npm run test:rapido` (scripts/test-quick.mjs): run only the tests a change can affect.
//
// How it decides:
//   1. A mark in `.cache/test-quick.json` records the commit of the last green run and the fingerprint (sha-256) of
//      every file that was already modified, or untracked, at that moment.
//   2. A file counts as changed when it differs from the marked commit (`git diff --name-only <commit>`, plus the
//      untracked files) and its fingerprint is not the one recorded in the mark. Changing it back also counts.
//   3. A test is affected when it, or a module it imports (transitively), changed. Imports are found by reading
//      every relative string that points to an existing file (`from './x.js'`, `import('./x.js')`,
//      `new URL('./x.js', import.meta.url)`), so dynamic and generated-script imports count too. A changed file that
//      is not code (SQL, JSON, YAML, env example) affects the tests whose closure mentions its name in a string.
//   4. A change to package.json or package-lock.json affects every test.
// In doubt the test runs: a missing mark, an unreadable mark or an unresolvable change all run everything.

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { lex } from './lex.js'

export const MARK_FILE = path.join('.cache', 'test-quick.json')
const EVERYTHING = new Set(['package.json', 'package-lock.json'])
const CODE = /\.(m?js)$/

const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

/** Every `*.test.js` under `src/`, relative to `root`, sorted: the same set `npm test` runs. */
export function allTests (root) {
  const found = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name)
      if (name === 'node_modules') continue
      if (statSync(full).isDirectory()) walk(full)
      else if (name.endsWith('.test.js')) found.push(path.relative(root, full))
    }
  }
  walk(path.join(root, 'src'))
  return found.sort()
}

/** Local files a source file refers to: relative strings that resolve to an existing file. */
export function referencesOf (root, file) {
  const full = path.join(root, file)
  const refs = new Set()
  for (const token of lex(readFileSync(full, 'utf8'))) {
    if (token.type !== 'string') continue
    const text = token.value.slice(1, -1)
    if (!/^\.\.?\//.test(text)) continue
    for (const base of [path.dirname(full), path.join(root, 'src')]) {
      const candidate = path.resolve(base, text.split(/[?#]/)[0])
      if (candidate.startsWith(root) && existsSync(candidate) && statSync(candidate).isFile()) { refs.add(path.relative(root, candidate)); break }
    }
  }
  return refs
}

/** The text of every string and template literal of a code file (comments do not count as a reference). */
function stringsOf (root, file) {
  const full = path.join(root, file)
  if (!existsSync(full)) return []
  return lex(readFileSync(full, 'utf8')).filter((t) => t.type === 'string' || t.type === 'template').map((t) => t.value)
}

/** Files that `file` reaches by following references, itself included. */
export function closureOf (root, file, cache = new Map()) {
  if (cache.has(file)) return cache.get(file)
  const seen = new Set([file])
  const pending = [file]
  while (pending.length > 0) {
    const current = pending.pop()
    if (!CODE.test(current)) continue
    for (const ref of referencesOf(root, current)) if (!seen.has(ref)) { seen.add(ref); pending.push(ref) }
  }
  cache.set(file, seen)
  return seen
}

/** The tests affected by `changed` (paths relative to `root`). */
export function affectedTests (root, changed, tests = allTests(root)) {
  if (changed.some((file) => EVERYTHING.has(file))) return tests
  const cache = new Map()
  return tests.filter((test) => {
    const closure = closureOf(root, test, cache)
    return changed.some((file) => {
      if (closure.has(file)) return true
      if (CODE.test(file) && existsSync(path.join(root, file))) return false
      // Not code, or deleted. It affects a test when, in its closure: (a) a string names the file, (b) a code file
      // lives in a directory above the file, below `src` (a migration affects whoever reaches `src/db/`), or (c) a
      // string names the file's top-level directory (`templates/` for the template files).
      const name = path.basename(file)
      const topDirectory = file.split('/')[0]
      const strings = [...closure].flatMap((member) => (CODE.test(member) ? stringsOf(root, member) : []))
      const above = [...closure].some((member) => CODE.test(member) && path.dirname(member) !== 'src' && path.dirname(member) !== '.' && path.dirname(file).startsWith(`${path.dirname(member)}/`))
      return above || strings.some((text) => text.includes(name)) || (file.includes('/') && strings.some((text) => text.split(/[\\/'"`]/).includes(topDirectory)))
    })
  })
}

export function readMark (root) {
  try {
    const mark = JSON.parse(readFileSync(path.join(root, MARK_FILE), 'utf8'))
    return typeof mark.commit === 'string' && mark.dirty && typeof mark.dirty === 'object' ? mark : null
  } catch {
    return null
  }
}

/** Paths that differ from `commit` in the work tree or are untracked, without `.cache/` itself. */
function modifiedSince (root, commit) {
  const tracked = git(root, 'diff', '--name-only', commit).split('\n')
  const untracked = git(root, 'ls-files', '--others', '--exclude-standard').split('\n')
  return [...new Set([...tracked, ...untracked])].filter((f) => f && !f.startsWith('.cache/'))
}

/** Files changed since the mark, or null when there is no usable mark (then everything runs). */
export function changedSinceMark (root, mark = readMark(root)) {
  if (!mark) return null
  try {
    return modifiedSince(root, mark.commit).filter((file) => {
      const full = path.join(root, file)
      return !(existsSync(full) && mark.dirty[file] === sha256(full))
    })
  } catch {
    return null // the marked commit no longer exists, for example
  }
}

/** Records the current state as the last green run. */
export function writeMark (root) {
  const commit = git(root, 'rev-parse', 'HEAD').trim()
  const dirty = {}
  for (const file of modifiedSince(root, commit)) {
    const full = path.join(root, file)
    if (existsSync(full) && statSync(full).isFile()) dirty[file] = sha256(full)
  }
  mkdirSync(path.join(root, '.cache'), { recursive: true })
  writeFileSync(path.join(root, MARK_FILE), `${JSON.stringify({ commit, dirty, at: new Date().toISOString() }, null, 2)}\n`)
  return { commit, dirty }
}
