// A text tree of what is seen: headings, texts, buttons, links, fields, tabs and tables (one row per line, cells separated by « | »).
// Runs inside the browser (`page.evaluate(pageTree)`) and replaces Playwright's accessibility tree, which took 30 s on a heavy screen and 1 s on a light one
// (the first host's measurement). Self-contained: it cannot import anything.
export function pageTree () {
  const out = []
  const visible = (el) => {
    if (el.hidden || el.getAttribute('aria-hidden') === 'true') return false
    const s = getComputedStyle(el)
    return s.display !== 'none' && s.visibility !== 'hidden'
  }
  const text = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()
  const nameOf = (el) => (el.getAttribute('aria-label') || text(el) || el.getAttribute('title') || el.getAttribute('placeholder') || '').trim()
  const labelOf = (el) => {
    const byFor = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
    return (el.getAttribute('aria-label') || (byFor && text(byFor)) || (el.closest('label') && text(el.closest('label'))) || el.getAttribute('placeholder') || el.name || '').slice(0, 80)
  }
  const stateOf = (el) => [el.getAttribute('aria-selected') === 'true' && 'selected', (el.getAttribute('aria-checked') === 'true' || el.checked) && 'checked',
    (el.disabled || el.getAttribute('aria-disabled') === 'true') && 'disabled', el.getAttribute('aria-expanded') && `expanded=${el.getAttribute('aria-expanded')}`].filter(Boolean).join(', ')
  const line = (level, s) => { if (s) out.push('  '.repeat(Math.min(level, 6)) + s) }
  function walk (el, level) {
    if (el.nodeType === 3) { const t = el.nodeValue.replace(/\s+/g, ' ').trim(); if (t) line(level, t); return }
    if (el.nodeType !== 1 || !visible(el)) return
    const tag = el.tagName.toLowerCase(); const role = el.getAttribute('role')
    if (['script', 'style', 'svg', 'noscript', 'template'].includes(tag)) return
    if (/^h[1-6]$/.test(tag) || role === 'heading') return line(level, `${'#'.repeat(+tag[1] || 2)} ${text(el)}`)
    if (tag === 'table') {
      const caption = el.querySelector('caption'); line(level, `[table${caption ? ' ' + text(caption) : ''}]`)
      for (const tr of el.querySelectorAll('tr')) {
        if (!visible(tr)) continue
        const cells = [...tr.children].map((c) => { const b = [...c.querySelectorAll('button,a')].map(nameOf).filter(Boolean); return text(c) || b.join('/') })
        if (cells.some(Boolean)) line(level + 1, cells.join(' | '))
      }
      return
    }
    if (tag === 'select') return line(level, `[list ${labelOf(el)}] ${[...el.options].map((o) => (o.selected ? '*' : '') + text(o)).join(' / ')}`)
    if (tag === 'input' || tag === 'textarea') {
      if (el.type === 'hidden') return
      const v = el.type === 'password' ? '' : el.value; const s = stateOf(el)
      return line(level, `[${el.type === 'checkbox' ? 'checkbox' : el.type === 'radio' ? 'radio' : 'field'} ${labelOf(el)}]${v ? ' = ' + v : ''}${s ? ' (' + s + ')' : ''}`)
    }
    if (tag === 'button' || role === 'button' || role === 'tab' || role === 'menuitem') {
      const s = stateOf(el); return line(level, `[${role === 'tab' ? 'tab' : 'button'} ${nameOf(el)}]${s ? ' (' + s + ')' : ''}`)
    }
    if (tag === 'a') { const h = el.getAttribute('href'); return line(level, `[link ${nameOf(el)}]${h && !h.startsWith('#') ? ' → ' + h : ''}`) }
    if (tag === 'img') { const a = el.getAttribute('alt'); return a && line(level, `[image ${a}]`) }
    const hasBlockChild = [...el.children].some((c) => /^(div|section|nav|main|header|footer|ul|ol|form|aside|article|p|li|fieldset|dl)$/i.test(c.tagName))
    const label = el.getAttribute('aria-label') && /^(nav|main|section|aside|form|header|footer)$/.test(tag) ? el.getAttribute('aria-label') : null
    if (label) line(level, `<${tag} ${label}>`)
    for (const child of el.childNodes) walk(child, level + (hasBlockChild && ['nav', 'main', 'aside', 'form', 'section', 'header'].includes(tag) ? 1 : 0))
  }
  walk(document.body, 0)
  return out.join('\n')
}
