// Rule 10 of docs/RULES.md: versioned files do not name other projects of the author, clients or people.
// The list of forbidden names is private: bench/private/prohibited-names.txt (ignored by git), one
// name per line, blank lines and lines starting with # ignored. Without that file only the generic
// list below applies, which names nobody.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const EXEMPT = [/^docs\/investigaciones\//, /^bench\//, /^\.git\//]
const GENERIC = [] // no real names here: they would publish what this test protects

function privateListPaths() {
  const paths = [join(root, 'bench', 'private', 'prohibited-names.txt')]
  try {
    // In a linked worktree the ignored file lives in the main checkout.
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim()
    paths.push(join(dirname(common), 'bench', 'private', 'prohibited-names.txt'))
  } catch { /* not a git checkout */ }
  return paths
}

export function loadNames() {
  const file = privateListPaths().find((p) => existsSync(p))
  const names = file
    ? readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    : GENERIC
  return names
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function findMentions(files, names, read = (f) => readFileSync(join(root, f))) {
  if (!names.length) return []
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(${names.map(escape).join('|')})(?![\\p{L}\\p{N}])`, 'iu')
  const hits = []
  for (const f of files) {
    if (EXEMPT.some((r) => r.test(f))) continue
    let buf
    try { buf = read(f) } catch { continue }
    if (buf.includes(0)) continue
    buf.toString('utf8').split('\n').forEach((line, i) => {
      const m = re.exec(line)
      if (m) hits.push(`${f}:${i + 1}: ${m[1]}`)
    })
  }
  return hits
}

test('versioned files do not contain prohibited names', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 }).split('\0').filter(Boolean)
  const hits = findMentions(files, loadNames())
  assert.deepEqual(hits, [], `Names prohibited by rule 10 in versioned files:\n${hits.join('\n')}`)
})

test('the matcher finds a name and respects the exemptions', () => {
  const read = (f) => Buffer.from(f.includes('x') ? 'uno Zorro dos\n' : 'sin nada\n')
  assert.deepEqual(findMentions(['a/x.md'], ['zorro'], read), ['a/x.md:1: Zorro'])
  assert.deepEqual(findMentions(['docs/investigaciones/x.md', 'bench/x.js'], ['zorro'], read), [])
  assert.deepEqual(findMentions(['a/x.md'], ['zorr'], read), [])
  assert.deepEqual(findMentions(['a/x.md'], [], read), [])
})
