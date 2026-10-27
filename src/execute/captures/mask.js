// Hides the data of people on a page before it is captured (UD-268: a capture declares `masked`, and `masked: true` has to be true).
// `applyMask` runs INSIDE the browser (`page.evaluate(applyMask, { values, learned, patterns })`), so it cannot import anything: it is self-contained.
// Covers text, values of fields and the attributes aria-label, title, alt and placeholder.
// What it hides: whatever matches a pattern (by default emails and international phone numbers; the host adds its own, such as national ids) and every
// value the page itself received from the server under a key that names a person (`learn.js`), whole and by words.
// `masked` is true only when nothing detectable is left AND there was something to check against (patterns that matched, or learned values). With no
// sources there is no proof that no person is on screen: false.
// Declared limit: it does not read pixels. A name drawn in an image or a canvas stays.

/** Patterns every host gets. The host adds its own in `mask.patterns` of its adapter (national ids, local phone formats). */
export const DEFAULT_PATTERNS = [
  { source: '[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+', flags: 'g' }, // email
  { source: '(?<!\\d)\\+\\d{1,3}[\\s-]?\\d[\\d\\s-]{7,12}\\d(?!\\d)', flags: 'g' } // international phone
]

/** A pattern as the page receives it: `{ source, flags }` with the global flag, from a RegExp or from an object already in that shape. */
export function serializePattern (pattern) {
  const source = pattern instanceof RegExp ? pattern.source : pattern.source
  const flags = pattern instanceof RegExp ? pattern.flags : (pattern.flags ?? '')
  return { source, flags: flags.includes('g') ? flags : `${flags}g` }
}

/** The patterns to send to the page: the defaults plus the host's. */
export const maskPatterns = (hostPatterns = []) => [...DEFAULT_PATTERNS, ...hostPatterns].map(serializePattern)

export function applyMask ({ values, learned, patterns }) {
  const MASK = '█████'
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const words = new Set()
  for (const v of values) {
    words.add(v)
    // A full name also hides by its words (4 letters or more, not numbers); an email or a phone does not split.
    if (/\s/.test(v) && !/@|\d{3}/.test(v)) for (const p of v.split(/\s+/)) if (p.length >= 4 && !/^\d+$/.test(p)) words.add(p)
  }
  const list = [...words].sort((a, b) => b.length - a.length).map(escape)
  const byValue = list.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${list.join('|')})(?![\\p{L}\\p{N}])`, 'giu') : null
  const rules = patterns.map((p) => new RegExp(p.source, p.flags))
  let hits = 0
  const cover = (s) => {
    let t = s
    for (const p of rules) t = t.replace(p, () => { hits++; return MASK })
    if (byValue) t = t.replace(byValue, () => { hits++; return MASK })
    return t
  }
  const matches = (s) => rules.some((p) => { p.lastIndex = 0; return p.test(s) }) || (byValue ? (byValue.lastIndex = 0, byValue.test(s)) : false)
  const sweep = () => {
    // A datum split across several text nodes (an email with <wbr> after the at sign and after each dot) matches in no node but does in the joined
    // text that a person reads. The smallest element that contains it whole is covered first, before the node-by-node pass. If that element holds
    // controls or images it is left alone: the residue stays and `masked` comes out false, which is the safe side.
    for (const el of document.body.querySelectorAll('*')) {
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue
      const t = el.textContent
      if (!t || !matches(t)) continue
      if ([...el.children].some((c) => matches(c.textContent || ''))) continue
      if (el.querySelector('button, a, input, textarea, select, svg, img, canvas')) continue
      const next = cover(t)
      if (next !== t) el.textContent = next
    }
    // Then, node by node, what is left (second: covering a loose name inside a split email first left it half done and the joined email no longer matched).
    const walker = document.createTreeWalker(document.body, 4 /* NodeFilter.SHOW_TEXT */)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const p = n.parentElement?.tagName
      if (p === 'SCRIPT' || p === 'STYLE') continue
      const next = cover(n.nodeValue)
      if (next !== n.nodeValue) n.nodeValue = next
    }
    for (const el of document.querySelectorAll('input, textarea')) {
      if (el.type === 'password') { el.value = ''; continue }
      if (el.value) { const next = cover(el.value); if (next !== el.value) el.value = next }
    }
    for (const el of document.querySelectorAll('[aria-label],[title],[alt],[placeholder]')) {
      for (const a of ['aria-label', 'title', 'alt', 'placeholder']) {
        const v = el.getAttribute(a)
        if (v) { const next = cover(v); if (next !== v) el.setAttribute(a, next) }
      }
    }
  }
  sweep()
  // What the page draws later (a list that loads, a dialog that opens) is covered as it appears.
  if (!window.__lookMaskObserver && typeof MutationObserver === 'function') {
    window.__lookMaskObserver = new MutationObserver(() => { window.__lookMaskObserver.disconnect(); sweep(); window.__lookMaskObserver.observe(document.body, { childList: true, subtree: true, characterData: true }) })
    window.__lookMaskObserver.observe(document.body, { childList: true, subtree: true, characterData: true })
  }
  // The check: what is read now, does it still hold anything that had to be covered?
  const visible = (document.body.innerText ?? document.body.textContent) + '\n' + [...document.querySelectorAll('input,textarea')].map((e) => e.value).join('\n')
  let residue = 0
  for (const p of rules) residue += (visible.match(p) || []).length
  if (byValue) residue += (visible.match(byValue) || []).length
  const sources = hits + learned
  return { hits, residue, sources, masked: residue === 0 && sources > 0 }
}
