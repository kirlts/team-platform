// Criterion of HP-010 (docs/TEST.md, "Criterio de HP-010"): finds the numeric literals that govern operation and do
// not cite their source. Test support: nothing here is imported from production code.
//
// Only literals reaching one of these destinations are reviewed:
//   1. a `setTimeout` or `setInterval` (directly or through a constant of the same file),
//   2. the `limits` of `@fastify/multipart`,
//   3. a value whose name contains limit, max, timeout, retry/retries, lease or concurrency, or the default of a
//      knob read with `intVar(...)` or `decimal(...)` (only in the files of the "knobs" scope: config.js,
//      extract/config.js, analyze/config.js, queue/ and api/).
// Exempt: 0, 1 and -1; the unit conversions 1000, 60 and 1024; HTTP status codes (names that start with FST_, the
// Fastify error codes) and indexes (they reach none of the destinations); every literal inside tests.
// A reviewed literal complies when its line or the previous one has a comment, or a `source:` string, with a
// recognizable source.

import { lex } from './lex.js'

export const NEUTRAL = new Set([0, 1, -1, 1000, 60, 1024])
export const SOURCE_PATTERN = /\binforme\s*\d{1,2}\b|\bI\d{2}\b|\bMASTER-SPEC\s*§|\bMS\s*§|\bmedici[oó]n\s+\d{4}-\d{2}-\d{2}|\bcortes[ií]a declarada\b|\bUD-\d{3}\b|\bRFC\s?\d{3,4}\b|\bdecisi[oó]n de Martín\s+\d{4}-\d{2}-\d{2}/i
export const KEY_PATTERN = /limit|max|timeout|retr(?:y|ies)|lease|concurrency/i
const SINKS = new Set(['setTimeout', 'setInterval'])
const KNOB_READERS = new Set(['intVar', 'decimal'])
const OPEN = new Set(['(', '[', '{'])
const CLOSE = new Set([')', ']', '}'])
const CONTINUES = new Set(['+', '-', '*', '/', '%', '=', '<', '>', '&', '|', '?', ':', ',', '.', '(', '[', '{', '!', '~', '^', '=>'])

const toNumber = (text) => Number(text.replace(/_/g, ''))
const lineOf = (src, offset) => src.slice(0, offset).split('\n').length

/** Index of the closer that balances the paren, bracket or brace opened at `from`. */
function closeOf (code, from) {
  let depth = 0
  for (let i = from; i < code.length; i++) {
    if (OPEN.has(code[i].value)) depth++
    else if (CLOSE.has(code[i].value) && --depth === 0) return i
  }
  return code.length - 1
}

/**
 * End of the expression that starts at `from`: a comma or semicolon at the base level, the closer that contains it
 * or, in code without semicolons, a line break where the expression cannot continue.
 */
function expressionEnd (code, from, src) {
  let depth = 0
  for (let i = from; i < code.length; i++) {
    const v = code[i].value
    if (depth === 0 && i > from && lineOf(src, code[i].start) > lineOf(src, code[i - 1].end - 1) && !CONTINUES.has(code[i - 1].value) && !CONTINUES.has(v)) return i
    if (OPEN.has(v)) depth++
    else if (CLOSE.has(v)) { if (depth === 0) return i; depth-- } else if (depth === 0 && (v === ',' || v === ';')) return i
  }
  return code.length
}

/** File constants with a numeric value: `const NAME = 2 ** 31 - 1`. */
function numericConstants (code, src) {
  const consts = new Map()
  code.forEach((t, i) => {
    if (t.type !== 'ident' || code[i - 1]?.value !== 'const' || code[i + 1]?.value !== '=') return
    const end = expressionEnd(code, i + 2, src)
    const numbers = code.slice(i + 2, end).filter((x) => x.type === 'number')
    if (numbers.length > 0) consts.set(t.value, numbers)
  })
  return consts
}

/**
 * Literals without a source in `src`. `knobs`: also applies the by-name criterion (3). Returns
 * [{ line, value, context }] without repeats.
 */
export function findUncitedNumbers (src, { knobs = false } = {}) {
  const all = lex(src)
  const code = all.filter((t) => t.type !== 'comment')
  const comments = all.filter((t) => t.type === 'comment')
  const constants = numericConstants(code, src)
  const reviewed = [] // { token, context }

  const take = (from, to, context) => {
    for (let i = from; i < to; i++) {
      const t = code[i]
      if (t.type === 'number') {
        // `{ min: 8 }` is a validation floor of the knob, not a value that governs operation.
        if (!(code[i - 1]?.value === ':' && code[i - 2]?.value === 'min')) reviewed.push({ token: t, context })
      }
      // A numeric constant of the file that reaches the destination is reviewed at its declaration.
      else if (t.type === 'ident' && constants.has(t.value) && code[i - 1]?.value !== '.') constants.get(t.value).forEach((n) => reviewed.push({ token: n, context: `${context} (via ${t.value})` }))
    }
  }

  code.forEach((t, i) => {
    if (t.type !== 'ident' && t.type !== 'string') return
    const name = t.type === 'string' ? t.value.slice(1, -1) : t.value
    const next = code[i + 1]?.value
    if (SINKS.has(name) && next === '(') take(i + 2, closeOf(code, i + 1), name)
    else if (knobs && KNOB_READERS.has(name) && next === '(' && code[i - 1]?.value !== 'function') take(i + 2, closeOf(code, i + 1), name)
    else if (name === 'limits' && next === ':' && code[i + 2]?.value === '{') take(i + 3, closeOf(code, i + 2), 'multipart limits')
    else if (knobs && !name.startsWith('FST_') && KEY_PATTERN.test(name) && (next === ':' || (next === '=' && code[i + 2]?.value !== '=' && code[i + 2]?.value !== '>')) && code[i - 1]?.value !== '.') {
      take(i + 2, expressionEnd(code, i + 2, src), name)
    }
  })

  // line -> text of the comments and `source:` strings touching that line
  const evidence = new Map()
  const note = (line, text) => evidence.set(line, `${evidence.get(line) ?? ''} ${text}`)
  for (const c of comments) {
    for (let line = lineOf(src, c.start); line <= lineOf(src, c.end); line++) note(line, c.value)
  }
  code.forEach((t, i) => {
    if (t.type === 'ident' && t.value === 'source' && code[i + 1]?.value === ':' && code[i + 2]?.type === 'string') note(lineOf(src, t.start), code[i + 2].value)
  })

  const seen = new Set()
  const found = []
  for (const { token, context } of reviewed) {
    const value = toNumber(token.value)
    if (NEUTRAL.has(value)) continue
    const line = lineOf(src, token.start)
    const cited = SOURCE_PATTERN.test(`${evidence.get(line) ?? ''} ${evidence.get(line - 1) ?? ''}`)
    if (cited || seen.has(token.start)) continue
    seen.add(token.start)
    found.push({ line, value: token.value, context })
  }
  return found
}
