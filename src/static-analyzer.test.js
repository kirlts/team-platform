// HP-003 (docs/TEST.md), the part of src/analyze/: no code decides with the text a person wrote (MASTER-SPEC
// sections 1.2 and 4.2). src/static.test.js covers domain, api, identity, queue and events; the analyzer is not in
// that list because it segments the text by its structure, so it gets its own check with a short, explained
// allowlist. Anything new that calls a text-matching method on a human-text identifier fails here.

import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { lex } from './testing/lex.js'

const analyzeDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'analyze')
const HUMAN_TEXT = new Set(['text', 'body', 'title', 'message', 'description', 'profile', 'reply', 'extracted'])
const MATCHING = new Set(['test', 'match', 'matchAll', 'includes', 'startsWith', 'endsWith', 'search', 'indexOf', 'localeCompare'])

// file: reason. Only these files may use a matching method on human text, and only for the stated reason.
const ALLOWED = {
  'units.js': 'splits the extracted text into units by its structure (line breaks, list markers, timestamps); it never decides an area, a recipient or a state',
  'validate.js': 'orders the messages of a proposal by title (localeCompare); the order decides nothing'
}

function hits (file) {
  const tokens = lex(readFileSync(path.join(analyzeDir, file), 'utf8')).filter((t) => t.type !== 'comment')
  return tokens.flatMap((t, i) => (t.type === 'ident' && HUMAN_TEXT.has(t.value) && tokens[i + 1]?.value === '.' && MATCHING.has(tokens[i + 2]?.value) && tokens[i + 3]?.value === '('
    ? [`${file}: ${t.value}.${tokens[i + 2].value}(`]
    : []))
}

const productionFiles = readdirSync(analyzeDir).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))

test('HP-003: no file of src/analyze/ outside the explained allowlist matches human text', () => {
  const found = productionFiles.filter((f) => !(f in ALLOWED)).flatMap(hits)
  assert.deepEqual(found, [])
})

test('HP-003: every allowlist entry is still used, so the list cannot go stale', () => {
  for (const file of Object.keys(ALLOWED)) assert.ok(hits(file).length > 0, `${file} no longer needs its exemption: remove it from the allowlist`)
})
