// Language rule checks (UD-015, HP-008): code comments, test names and log messages are written in English; text a
// person sees in the panel is written in Spanish. `node src/testing/language.js` prints every violation found.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { lex } from './lex.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// Directories and files covered by the comment rule. Each entry is a path relative to the repository root.
export const CODE_ROOTS = ['src', 'bench', 'scripts', 'panel/src', 'panel/scripts', 'panel/dev-server.mjs', 'panel/vite.config.ts', 'Dockerfile', 'compose.yml', '.env.example']
const SKIP_DIRS = new Set(['node_modules', 'dist', 'cases', 'fonts', 'assets'])
const SKIP_FILES = new Set(['package-lock.json', 'fixtures.json'])
// This file lists Spanish words on purpose, as data.
const SELF = path.join(root, 'src', 'testing', 'language.js')

// Function words that exist in Spanish and not in English. A single hit in a comment is a violation.
// Matching is case-sensitive on lowercase words, so an identifier such as `listaDeCosas` or a constant such as `DEL` never matches.
export const SPANISH_WORDS = new Set(`que para con sin porque según segun también tambien los las del una por cuando donde cada pero desde hasta
  entre sobre esta este están esta además debe deben puede pueden tiene tienen nunca siempre sino cuyo cuya más muy sus mismo misma así aquí
  qué cómo cuál todos todas otro otra ningún ninguna algún alguna antes después durante mientras aunque pues cuyos
  como texto esto eso ese esos esas hay hace fue han sea solo sólo expone cadena contrato propuesta mensaje mensajes cuenta número`.split(/\s+/))

// Short Spanish words that also occur in English or in code (`de-dup`, `en-US`, `es` as in ES modules): two of them in the same
// comment are a violation, one is not.
export const AMBIGUOUS_SPANISH = new Set('de la el un se lo al y'.split(' '))

// Function words that exist in English and not in Spanish. A single hit in visible panel text is a violation.
export const ENGLISH_WORDS = new Set('the and with for you your are this that from have will was been which when where into then than'.split(' '))

function walk (p, found = []) {
  const stat = statSync(p)
  if (stat.isDirectory()) {
    for (const f of readdirSync(p).sort()) {
      if (SKIP_DIRS.has(f) && path.basename(p) !== 'scripts') { if (f !== 'cases') continue }
      if (SKIP_DIRS.has(f)) continue
      walk(path.join(p, f), found)
    }
  } else if (!SKIP_FILES.has(path.basename(p)) && p !== SELF) found.push(p)
  return found
}

export function codeFiles () {
  // Markdown outside `src` is project documentation (bench/README.md, panel/DISENO.md) and stays in Spanish.
  return CODE_ROOTS.flatMap((r) => walk(path.join(root, r)))
    .filter((f) => /(\.(m?js|jsx|tsx?|css|sh|sql|md|yml|html)|Dockerfile|\.env\.example)$/.test(f))
    .filter((f) => !f.endsWith('.md') || path.relative(root, f).startsWith(`src${path.sep}`))
}

// Text inside backticks, «», or double quotes is a quotation (a literal, a path, a user-facing string) and is not judged.
function stripQuoted (text) {
  return text.replace(/`[^`]*`/g, ' ').replace(/«[^»]*»/g, ' ').replace(/"[^"\n]*"/g, ' ')
}

export function spanishIn (text) {
  const clean = stripQuoted(text)
  const hits = []
  const tokens = clean.match(/[A-Za-zÀ-ÿ]+/g) ?? []
  for (const w of tokens) if (SPANISH_WORDS.has(w)) hits.push(w)
  const ambiguous = tokens.filter((w) => AMBIGUOUS_SPANISH.has(w))
  if (ambiguous.length >= 2) hits.push(...new Set(ambiguous))
  // An accent inside a lowercase word is Spanish; a capitalized name (Martín) is not judged.
  const accent = (clean.match(/[A-Za-zÀ-ÿ]*[áéíóúñ][A-Za-zÀ-ÿ]*/g) ?? []).find((w) => /^[a-zà-ÿ]/.test(w)) ?? clean.match(/[¿¡]/)?.[0]
  if (accent) hits.push(accent)
  return hits
}

/** Comments of a file as { line, text }, by file kind. */
export function commentsOf (file) {
  const text = readFileSync(file, 'utf8')
  const base = path.basename(file)
  const out = []
  const lineOf = (offset) => text.slice(0, offset).split('\n').length
  if (/\.(m?js|jsx|tsx?)$/.test(file)) {
    for (const t of lex(text, { jsx: /\.(tsx|jsx)$/.test(file) })) if (t.type === 'comment') out.push({ line: lineOf(t.start), text: t.value })
  } else if (/\.css$/.test(file)) {
    for (const m of text.matchAll(/\/\*[\s\S]*?\*\//g)) out.push({ line: lineOf(m.index), text: m[0] })
  } else if (/\.sql$/.test(file)) {
    for (const m of text.matchAll(/--.*$/gm)) out.push({ line: lineOf(m.index), text: m[0] })
  } else if (/\.html$/.test(file)) {
    for (const m of text.matchAll(/<!--[\s\S]*?-->/g)) out.push({ line: lineOf(m.index), text: m[0] })
  } else if (/\.md$/.test(file)) {
    // Documentation that lives next to the code is prose in full.
    text.split('\n').forEach((l, i) => out.push({ line: i + 1, text: l }))
  } else if (/\.sh$|\.ya?ml$|^Dockerfile$|^\.env\.example$/.test(base)) {
    text.split('\n').forEach((l, i) => {
      if (i === 0 && l.startsWith('#!')) return
      const m = /(^|\s)#(?!!)\s?(.*)$/.exec(l)
      if (m) out.push({ line: i + 1, text: m[2] })
    })
  }
  return out
}

/** Comments written in Spanish: [{ file, line, words }]. */
export function spanishComments () {
  const bad = []
  for (const f of codeFiles()) {
    for (const c of commentsOf(f)) {
      const hits = spanishIn(c.text)
      if (hits.length) bad.push({ file: path.relative(root, f), line: c.line, words: [...new Set(hits)].join(',') })
    }
  }
  return bad
}

const CALLS = new Set(['test', 'describe', 'it', 'suite'])
const LOG_LEVELS = new Set(['info', 'warn', 'error', 'debug', 'trace', 'fatal'])

/** Test names and log messages written in Spanish: first string argument of test/describe/it and of log.<level>(. */
export function spanishNamesAndLogs () {
  const bad = []
  for (const f of codeFiles().filter((x) => /\.(m?js|tsx?)$/.test(x))) {
    const text = readFileSync(f, 'utf8')
    const tokens = lex(text, { jsx: /\.tsx$/.test(f) }).filter((t) => t.type !== 'comment')
    tokens.forEach((t, i) => {
      if (t.type !== 'ident') return
      let arg
      if (CALLS.has(t.value) && tokens[i + 1]?.value === '(') arg = tokens[i + 2]
      else if (/^(log|logger)$/.test(t.value) && tokens[i + 1]?.value === '.' && LOG_LEVELS.has(tokens[i + 2]?.value) && tokens[i + 3]?.value === '(') {
        // log.info('message') or log.info({ ... }, 'message'): judge the first string literal inside the call.
        let depth = 0
        for (let j = i + 3; j < tokens.length; j++) {
          if (tokens[j].value === '(') depth++
          else if (tokens[j].value === ')') { depth--; if (depth === 0) break }
          else if (tokens[j].type === 'string' || tokens[j].type === 'template') { arg = tokens[j]; break }
        }
      }
      if (!arg || (arg.type !== 'string' && arg.type !== 'template')) return
      const hits = spanishIn(arg.value.slice(1, -1).replace(/\$\{[^}]*\}/g, ' '))
      if (hits.length) bad.push({ file: path.relative(root, f), line: text.slice(0, arg.start).split('\n').length, words: [...new Set(hits)].join(',') })
    })
  }
  return bad
}

/** English function words found in a piece of panel text. */
export function englishIn (text) {
  return [...new Set((text.match(/[A-Za-zÀ-ÿ]+/g) ?? []).map((w) => w.toLowerCase()).filter((w) => ENGLISH_WORDS.has(w)))]
}

/** Visible panel text (JSX text and label attributes) written in English. */
export function englishInPanel () {
  const bad = []
  for (const f of codeFiles().filter((x) => /panel[\\/]src[\\/].*\.tsx$/.test(x) && !/\.test\.tsx$/.test(x))) {
    const text = readFileSync(f, 'utf8')
    let code = ''
    let cursor = 0
    for (const t of lex(text, { jsx: true })) if (t.type === 'comment') { code += text.slice(cursor, t.start) + ' '.repeat(t.value.length); cursor = t.end }
    code += text.slice(cursor)
    const visible = []
    for (const m of code.matchAll(/(?<![=-])>([^<>{}=;()&|`]*[A-Za-z][^<>{}=;()&|`]*)</g)) visible.push({ at: m.index, text: m[1] })
    for (const m of code.matchAll(/\b(?:title|placeholder|aria-label|alt|label)="([^"]*)"/g)) visible.push({ at: m.index, text: m[1] })
    for (const v of visible) {
      const hits = englishIn(v.text)
      if (hits.length) bad.push({ file: path.relative(root, f), line: code.slice(0, v.at).split('\n').length, words: [...new Set(hits)].join(',') })
    }
  }
  return bad
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sections = { 'Spanish comments': spanishComments(), 'Spanish test names and log messages': spanishNamesAndLogs(), 'English visible panel text': englishInPanel() }
  let total = 0
  for (const [name, list] of Object.entries(sections)) {
    total += list.length
    console.log(`${name}: ${list.length}`)
    for (const b of list) console.log(`  ${b.file}:${b.line}  ${b.words}`)
  }
  process.exit(total ? 1 : 0)
}
