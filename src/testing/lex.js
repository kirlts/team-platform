// Minimal JavaScript lexer for the static tests: it separates identifiers, strings, templates, regular
// expressions and comments, so that a rule about the code is not confused by the text of a comment or of
// a message. It is not a parser: it is enough to walk identifiers and comments.

const REGEX_PRECEDERS = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^', '=>'])
const KEYWORDS_BEFORE_REGEX = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'await', 'yield', 'else', 'do'])
const IDENT_START = /[\p{L}_$]/u
const IDENT_PART = /[\p{L}\p{N}_$]/u

/**
 * Returns tokens { type: 'ident' | 'string' | 'template' | 'regex' | 'comment' | 'number' | 'punct', value, start, end }.
 * With `jsx: true` it tolerates TSX: `</` and `/>` are punctuation (never a regular expression) and an unclosed string ends at the
 * line break (an apostrophe inside an element's text does not open a string).
 */
export function lex (src, { jsx = false } = {}) {
  const tokens = []
  const tpls = [] // brace depth inside each open ${ … }
  let i = 0
  const n = src.length
  let previous = null

  const push = (type, start, end) => {
    const t = { type, value: src.slice(start, end), start, end }
    tokens.push(t)
    if (type !== 'comment') previous = t
  }

  const readTemplateChunk = () => { // from inside a template up to `${` or the closing
    const startFlow = i
    while (i < n) {
      if (src[i] === '\\') { i += 2; continue }
      if (src[i] === '`') { i++; push('template', startFlow, i); return }
      if (src[i] === '$' && src[i + 1] === '{') { i += 2; push('template', startFlow, i); tpls.push(0); return }
      i++
    }
    push('template', startFlow, i)
  }

  while (i < n) {
    const c = src[i]
    if (/\s/.test(c)) { i++; continue }
    if (c === '/' && src[i + 1] === '/') { const s = i; while (i < n && src[i] !== '\n') i++; push('comment', s, i); continue }
    if (c === '/' && src[i + 1] === '*') { const s = i; i = src.indexOf('*/', i + 2); i = i < 0 ? n : i + 2; push('comment', s, i); continue }
    if (c === '"' || c === "'") {
      const s = i; i++
      while (i < n && src[i] !== c && !(jsx && src[i] === '\n')) i += src[i] === '\\' ? 2 : 1
      i++; push('string', s, i); continue
    }
    if (c === '`') { const s = i; i++; const before = tokens.length; readTemplateChunk(); tokens[before].start = s; tokens[before].value = src.slice(s, tokens[before].end); continue }
    if (c === '}' && tpls.length > 0 && tpls.at(-1) === 0) {
      tpls.pop(); const s = i; i++
      const before = tokens.length
      readTemplateChunk()
      tokens[before].start = s; tokens[before].value = src.slice(s, tokens[before].end)
      continue
    }
    if (c === '/' && jsx && (src[i + 1] === '>' || previous?.value === '<')) { push('punct', i, i + 1); i++; continue }
    if (c === '/') {
      const regexAllowed = previous === null || (previous.type === 'punct' && REGEX_PRECEDERS.has(previous.value)) || (previous.type === 'ident' && KEYWORDS_BEFORE_REGEX.has(previous.value))
      if (regexAllowed) {
        const s = i; i++
        let kindInfo = false
        while (i < n) {
          if (src[i] === '\\') { i += 2; continue }
          if (src[i] === '[') kindInfo = true
          else if (src[i] === ']') kindInfo = false
          else if (src[i] === '/' && !kindInfo) break
          i++
        }
        i++
        while (i < n && /[a-z]/.test(src[i])) i++
        push('regex', s, i); continue
      }
    }
    if (IDENT_START.test(c)) { const s = i; while (i < n && IDENT_PART.test(src[i])) i++; push('ident', s, i); continue }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) { const s = i; i++; while (i < n && /[0-9a-zA-Z_.]/.test(src[i])) i++; push('number', s, i); continue }
    if (c === '{' && tpls.length > 0) tpls[tpls.length - 1]++
    if (c === '}' && tpls.length > 0) tpls[tpls.length - 1]--
    if (c === '=' && src[i + 1] === '>') { push('punct', i, i + 2); i += 2; continue }
    push('punct', i, i + 1); i++
  }
  return tokens
}

/** Rewrites the identifiers of the code (never strings, templates or comments) using `table`. */
export function renameIdentifiers (src, table) {
  let outText = ''
  let cursor = 0
  for (const t of lex(src)) {
    if (t.type === 'ident' && table.has(t.value)) {
      outText += src.slice(cursor, t.start) + table.get(t.value)
      cursor = t.end
    }
  }
  return outText + src.slice(cursor)
}
