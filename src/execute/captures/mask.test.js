// The mask of people, run without a browser: `applyMask` takes the document from the globals, so a DOM implementation in Node (linkedom, already a
// dependency of the core) stands in for the page. What needs a real engine (innerText, layout) is in look.chromium.test.mjs.
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { parseHTML } from 'linkedom'
import { applyMask, DEFAULT_PATTERNS, maskPatterns, serializePattern } from './mask.js'

function page (html) {
  const { document, window } = parseHTML(`<!doctype html><html><body>${html}</body></html>`)
  globalThis.document = document
  globalThis.window = window
  return document
}
afterEach(() => { delete globalThis.document; delete globalThis.window })

const run = (args = {}) => applyMask({ values: [], learned: 0, patterns: maskPatterns(), ...args })

describe('applyMask', () => {
  it('covers an email and an international phone number by pattern, in text, fields and attributes', () => {
    const document = page('<p>Write to ana@example.org or call +56 9 1234 5678</p><input value="bob@example.org"><span title="carol@example.org">x</span><img alt="dave@example.org">')
    const result = run()
    assert.equal(result.residue, 0)
    assert.equal(result.hits, 5)
    assert.equal(document.querySelector('p').textContent, 'Write to █████ or call █████')
    assert.equal(document.querySelector('input').value, '█████')
    assert.equal(document.querySelector('span').getAttribute('title'), '█████')
    assert.equal(document.querySelector('img').getAttribute('alt'), '█████')
    assert.equal(result.masked, true)
  })

  it('covers the values the page learned, whole and by words, and not a word inside another word', () => {
    const document = page('<p>Patient: Maria Gonzalez Soto. Gonzalezes is a surname of other people</p><b>Maria</b>')
    const result = run({ values: ['Maria Gonzalez Soto'], learned: 1 })
    const text = document.querySelector('p').textContent
    assert.ok(!/Maria|Gonzalez Soto/.test(text.replace('Gonzalezes', '')), text)
    assert.ok(text.includes('Gonzalezes'), 'a word that merely contains a learned word stays')
    assert.equal(document.querySelector('b').textContent, '█████')
    assert.equal(result.masked, true)
  })

  it('covers a datum split across text nodes (an email with <wbr> after the at sign and the dots)', () => {
    const document = page('<td>dra.<wbr>meneses@<wbr>clinic.<wbr>example</td>')
    const result = run()
    assert.equal(document.querySelector('td').textContent, '█████')
    assert.equal(result.residue, 0)
  })

  it('leaves the residue and says masked false where the element holding the datum holds controls', () => {
    const document = page('<div>ana@<button>go</button>example.org</div>')
    const result = run()
    assert.equal(document.querySelector('button').textContent, 'go')
    assert.equal(result.masked, false)
  })

  it('says masked false when there was nothing to check against: no pattern matched and nothing was learned', () => {
    page('<p>Quarterly numbers, no people here</p>')
    const result = run()
    assert.deepEqual([result.hits, result.residue, result.sources, result.masked], [0, 0, 0, false])
  })

  it('counts the learned values as sources: with them a page without matches is masked', () => {
    page('<p>Nothing to cover</p>')
    assert.equal(run({ learned: 3 }).masked, true)
  })

  it('empties a password field and leaves script and style text alone', () => {
    const document = page('<input type="password" value="secret"><script>var e = "ana@example.org"</script>')
    run()
    assert.equal(document.querySelector('input').value, '')
    assert.equal(document.querySelector('script').textContent, 'var e = "ana@example.org"')
  })

  it('adds the patterns of the host to the defaults', () => {
    const document = page('<p>id 12.345.678-5 and ana@example.org</p>')
    const result = applyMask({ values: [], learned: 0, patterns: maskPatterns([/\b\d{1,2}\.\d{3}\.\d{3}-[\dkK]\b/]) })
    assert.equal(document.querySelector('p').textContent, 'id █████ and █████')
    assert.equal(result.masked, true)
  })
})

describe('patterns', () => {
  it('serializePattern always carries the global flag, from a RegExp or from an object', () => {
    assert.deepEqual(serializePattern(/a/i), { source: 'a', flags: 'ig' })
    assert.deepEqual(serializePattern({ source: 'b' }), { source: 'b', flags: 'g' })
    assert.deepEqual(serializePattern(/c/g), { source: 'c', flags: 'g' })
  })
  it('the defaults are an email and an international phone number, and the host adds to them', () => {
    assert.equal(DEFAULT_PATTERNS.length, 2)
    assert.equal(maskPatterns([/x/]).length, 3)
  })
})
