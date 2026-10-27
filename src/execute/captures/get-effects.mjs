#!/usr/bin/env node
// Lists the GET routes of a server whose handler holds a mark of a write. A reading of the code (it executes nothing): it says which GET to review to
// fill the host's `guard.blockedGets`, not that the rest write nothing. Marks: SQL writes, cookies, queues, file writes, functions named `mark…`/`record…`.
// The host adds its own marks in `effectMarks` of its adapter (LOOK_HOST).
//
//   node get-effects.mjs <folder>        (the folder with the routes of the server)
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadHost } from './host.js'

export const DEFAULT_MARKS = [
  ['sql-write', /\b(INSERT\s+INTO|UPDATE\s+[a-z_."]+\s+SET|DELETE\s+FROM)\b/i],
  ['audit', /\b(logAudit|auditLog|writeAudit)\b/],
  ['cookie', /\b(setCookie|clearCookie|set-cookie)/i],
  ['queue', /\b(boss\.(send|publish)|\.enqueue\(|queue\.add\()/],
  ['file', /\b(writeFile|appendFile|unlink|mkdirSync)\b/],
  ['mark', /\b(markRead|mark[A-Z]\w*|record[A-Z]\w*)\(/]
]

const ROUTE = /\b(app|fastify|server|r|router)\.(get|post|put|patch|delete)\(/

function * sourceFiles (dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { if (name !== 'node_modules') yield * sourceFiles(p) } else if (/\.m?js$/.test(name) && !/\.test\.m?js$/.test(name)) yield p
  }
}

/** The routes of a file's text: where each starts and whether it is a GET. A handler is the text up to the next route. */
export function scanText (text, marks = DEFAULT_MARKS) {
  const lines = text.split('\n')
  const starts = []
  lines.forEach((l, i) => { const m = ROUTE.exec(l); if (m) starts.push({ line: i, get: m[2] === 'get' }) })
  const found = []
  let gets = 0
  starts.forEach((s, k) => {
    if (!s.get) return
    gets++
    const end = k + 1 < starts.length ? starts[k + 1].line : lines.length
    const block = lines.slice(s.line, end).join('\n')
    const hit = marks.filter(([, re]) => re.test(block)).map(([name]) => name)
    if (hit.length) found.push({ line: s.line + 1, route: (lines[s.line].match(/\.get\(\s*[`'"]([^`'"]+)/) || [])[1] || '?', marks: hit })
  })
  return { gets, found }
}

export function scanFolder (base, marks = DEFAULT_MARKS) {
  let gets = 0
  const found = []
  for (const file of sourceFiles(base)) {
    const r = scanText(readFileSync(file, 'utf8'), marks)
    gets += r.gets
    for (const f of r.found) found.push({ file: relative(base, file), ...f })
  }
  return { gets, found }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const folder = process.argv[2]
  if (!folder) { console.error('usage: node get-effects.mjs <folder>'); process.exit(2) }
  const host = await loadHost(process.env.LOOK_HOST)
  const { gets, found } = scanFolder(resolve(folder), [...DEFAULT_MARKS, ...host.effectMarks])
  console.log(`GET reviewed: ${gets}; with some mark of a write: ${found.length}`)
  for (const f of found) console.log(`${f.file}:${f.line}  GET ${f.route}  [${f.marks.join(', ')}]`)
}
