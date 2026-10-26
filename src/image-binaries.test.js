// Guard of the binaries (2026-10-26): production ran a binary that the image of the worker did not have, twice in one day. First `claude` (idea-guard.js and judge.js),
// then `git` (the deploy scripts of the host). Both were seen only in production. This test reads the code that runs in the worker (src/**, without tests, and the scripts the
// Dockerfile copies), takes every call that starts a process with the binary it names (a literal, or the one a config property carries) and compares it with what the
// Dockerfile installs in the image that ships: `apk add`, `npm -g`, binaries copied with COPY, node, and the busybox applets of the Alpine base.
// It fails naming each binary the image lacks. A binary that lives on purpose only on another machine takes a line next to the call, with its reason:
//     // fuera-de-la-imagen: <binary> — <reason>
// A call whose binary cannot be read (a variable) takes `// binario: <name>` next to it, and then <name> is compared like any other. There is no global list of exceptions.
// The same idea as infra/servidor-de-despliegue/chequeo-previo.py of the host repository, which derives the binaries a run needs from what its scripts invoke.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

// ---------------------------------------------------------------- what the image brings

/** Splits the Dockerfile in stages: { name, from, text } with the continuation lines joined. */
export function dockerStages (dockerfile) {
  const stages = []
  for (const line of dockerfile.replace(/\\\n/g, ' ').split('\n')) {
    const from = /^FROM\s+(?:--\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/i.exec(line)
    if (from) { stages.push({ from: from[1], name: from[2] ?? null, text: '' }); continue }
    if (stages.length) stages.at(-1).text += `${line}\n`
  }
  return stages
}

/** The binaries a stage installs by itself: apk packages (a package is named like its binary), `npm -g`, COPY into a bin directory, and the ones its base image has. */
function binariesOfStage (stage, busybox) {
  const found = new Set()
  for (const m of stage.text.matchAll(/apk add\s+([^&|;\n\\]+)/g)) for (const p of m[1].split(/\s+/)) if (p && !p.startsWith('-')) found.add(p)
  for (const m of stage.text.matchAll(/npm\s+(?:i|install)\s+([^&|;\n\\]*)/g)) {
    if (!/(^|\s)(-g|--global)(\s|$)/.test(m[1])) continue
    for (const p of m[1].split(/\s+/)) if (p && !p.startsWith('-')) found.add(p === '@anthropic-ai/claude-code' ? 'claude' : basename(p))
  }
  for (const m of stage.text.matchAll(/^COPY\s+(?:--\S+\s+)*(.+)$/gm)) {
    const parts = m[1].trim().split(/\s+/)
    const dest = parts.pop()
    if (!/(^|\/)(s?bin)\/?/.test(dest)) continue
    for (const src of parts) found.add(dest.endsWith('/') ? basename(src) : basename(dest))
  }
  if (/^alpine/.test(stage.from) || /-alpine/.test(stage.from)) for (const b of busybox) found.add(b)
  if (/^node:/.test(stage.from)) for (const b of ['node', 'npm', 'npx', 'yarn']) found.add(b)
  return found
}

/** Everything the shipped image has: the last stage and the chain of stages it is built FROM. Another target (the extract-test one) does not count. */
export function binariesOfImage (dockerfile, busybox) {
  const stages = dockerStages(dockerfile)
  const have = new Set()
  const chain = []
  let stage = stages.at(-1)
  while (stage) {
    chain.push(stage)
    for (const b of binariesOfStage(stage, busybox)) have.add(b)
    stage = stages.find((s) => s.name === stage.from)
  }
  return { have, chain }
}

// ---------------------------------------------------------------- what the code invokes

const SPAWNERS = new Set(['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync'])
const SHELL_STRING = new Set(['exec', 'execSync'])

/** The source with comments blanked out (same offsets), so that a `spawn(` inside a comment is not a call. Strings and regex literals are respected. */
export function maskComments (src) {
  const out = src.split('')
  let i = 0
  let prev = ''
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' ' }
  while (i < src.length) {
    const c = src[i]
    const n = src[i + 1]
    if (c === '/' && n === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? src.length : e; blank(i, end); i = end; continue }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? src.length : e + 2; blank(i, end); i = end; continue }
    if (c === '\'' || c === '"') {
      let j = i + 1
      while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1
      i = j + 1; prev = c; continue
    }
    if (c === '`') {
      let j = i + 1
      let depth = 0
      while (j < src.length && !(src[j] === '`' && depth === 0)) {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === '$' && src[j + 1] === '{') { depth++; j += 2; continue }
        if (src[j] === '}' && depth > 0) depth--
        j++
      }
      i = j + 1; prev = c; continue
    }
    if (c === '/' && /[(,=:[!&|?{};]|^$/.test(prev)) { // a regex literal
      let j = i + 1
      let inClass = false
      while (j < src.length && src[j] !== '\n' && (inClass || src[j] !== '/')) {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === '[') inClass = true
        else if (src[j] === ']') inClass = false
        j++
      }
      i = j + 1; prev = '/'; continue
    }
    if (!/\s/.test(c)) prev = c
    i++
  }
  return out.join('')
}

/** The first argument of the call whose `(` is at `open`, as written in the original source, or null. */
function firstArgument (masked, src, open) {
  let depth = 0
  for (let i = open; i < masked.length; i++) {
    const c = masked[i]
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0) return src.slice(open + 1, i).trim() } else if (c === ',' && depth === 1) return src.slice(open + 1, i).trim()
    else if ((c === '\'' || c === '"' || c === '`') && depth >= 1) {
      let j = i + 1
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1
      i = j
    }
  }
  return null
}

/** Names of the `config.js` properties that carry a binary: `machineBin: textValue(env, 'EXECUTE_MACHINE_CLAUDE_BIN', 'claude')` gives machineBin -> claude. */
export function configBinaries (configSource) {
  const map = new Map()
  for (const m of configSource.matchAll(/\b(\w*[bB]in)\s*:\s*textValue\(\s*\w+\s*,\s*'([A-Z0-9_]+)'\s*,\s*'([^']*)'\s*\)/g)) map.set(m[1], { env: m[2], value: m[3] })
  return map
}

const runtimeFiles = (dir, out = []) => {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name)
    if (statSync(join(ROOT, rel)).isDirectory()) { if (!['test', 'testing', 'node_modules'].includes(name)) runtimeFiles(rel, out); continue }
    if (/\.(js|mjs)$/.test(name) && !/\.(test|bench)\.m?js$/.test(name)) out.push(rel)
  }
  return out
}

/** The files the worker runs: src/** without tests, plus the scripts the shipped image copies. */
export function workerFiles (dockerfile) {
  const files = new Set(runtimeFiles('src'))
  const { chain } = binariesOfImage(dockerfile, [])
  for (const stage of chain) for (const m of stage.text.matchAll(/^COPY\s+(?:--\S+\s+)*(\S+)\s+\S+\s*$/gm)) if (/^scripts\/.*\.mjs$/.test(m[1])) files.add(m[1])
  return [...files].sort()
}

/** The shell scripts that go into the shipped image: they would need their own reading, and this test does not read them. */
export function shellScriptsInImage (dockerfile) {
  const { chain } = binariesOfImage(dockerfile, [])
  return chain.flatMap((stage) => [...stage.text.matchAll(/^COPY\s+(?:--\S+\s+)*(\S+\.sh)\s/gm)].map((m) => m[1]))
}

/**
 * Every call that starts a process in the given files: { file, line, via, name, status }. status is `binary` (name is read), `declared` (a `// binario:` line), `exception` (a
 * `// fuera-de-la-imagen:` line with its reason) or `unreadable` (the binary comes from a variable and nothing says which).
 */
export function invokedBinaries (files, readSource = read, config = configBinaries(read('src/config.js'))) {
  const sources = new Map(files.map((f) => [f, readSource(f)]))
  const masks = new Map([...sources].map(([f, s]) => [f, maskComments(s)]))
  // Wrappers: a function whose first parameter goes straight to a spawner (`function run (binary, args) { spawn(binary, …) }`) delegates the binary to its callers.
  const spawnerNames = new Map() // file -> Set of local names that start a process
  const wrappers = new Map() // file -> Set of function names that delegate
  for (const f of sources.keys()) {
    const mask = masks.get(f)
    const names = new Set()
    for (const m of mask.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]node:child_process['"]/g)) {
      for (const part of m[1].split(',')) { const [orig, alias] = part.trim().split(/\s+as\s+/); if (SPAWNERS.has(orig)) names.add(alias ?? orig) }
    }
    for (const m of mask.matchAll(/(?:const|let)\s+(\w+)\s*=\s*promisify\(\s*(\w+)\s*\)/g)) if (names.has(m[2])) names.add(m[1])
    spawnerNames.set(f, names)
    wrappers.set(f, new Set())
    for (const m of mask.matchAll(/function\s+(\w+)\s*\(\s*(\w+)/g)) {
      const body = mask.slice(m.index, m.index + 1500)
      for (const n of names) if (new RegExp(`(?<![\\w.])${n}\\(\\s*${m[2]}\\s*[,)]`).test(body)) wrappers.get(f).add(m[1])
    }
  }
  const exported = new Map() // file -> wrapper names importable from it
  for (const [f, w] of wrappers) exported.set(f, w)
  const calls = []
  for (const f of sources.keys()) {
    const src = sources.get(f)
    const mask = masks.get(f)
    const names = new Map() // local name -> how it starts a process
    for (const n of spawnerNames.get(f)) names.set(n, n)
    for (const w of wrappers.get(f)) names.set(w, `${w} (wrapper)`)
    for (const m of mask.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"](\.[^'"]+)['"]/g)) {
      const target = relative(ROOT, resolve(ROOT, dirname(f), m[2]))
      for (const part of m[1].split(',')) {
        const [orig, alias] = part.trim().split(/\s+as\s+/)
        if (exported.get(target)?.has(orig)) names.set(alias ?? orig, `${orig} (wrapper)`)
      }
    }
    const lines = src.split('\n')
    for (const [local, via] of names) {
      const re = new RegExp(`(?<![\\w.$])${local}\\s*\\(`, 'g')
      for (const m of mask.matchAll(re)) {
        const before = mask.slice(Math.max(0, m.index - 20), m.index)
        if (/function\s*\*?\s*$/.test(before)) continue // the definition, not a call
        const open = m.index + m[0].length - 1
        const arg = firstArgument(mask, src, open)
        const line = src.slice(0, m.index).split('\n').length
        const wrapperItself = wrappers.get(f).has(local) === false && /^\w+$/.test(arg ?? '') && enclosingParams(mask, m.index).includes(arg)
        if (wrapperItself) continue // the call inside the wrapper: its callers are the ones that name the binary
        const above = (lines[line - 2] ?? '').trim().startsWith('//') ? lines[line - 2] : '' // a comment line right above counts; a comment at the end of the previous call does not
        const note = `${lines[line - 1]}\n${above}`
        const exception = /\/\/\s*fuera-de-la-imagen:\s*([\w.-]+)\s*[—-]\s*(\S.*)$/m.exec(note)
        const declared = /\/\/\s*binario:\s*([\w.-]+)/.exec(note)
        let name = null
        let status = 'unreadable'
        if (/^(['"])[^'"]*\1$/.test(arg ?? '')) { name = arg.slice(1, -1); status = 'binary' } else if (arg === 'process.execPath') { name = 'node'; status = 'binary' } else if (/^[\w.]+\.(\w*[bB]in)$/.test(arg ?? '') && config.has(arg.split('.').at(-1))) { name = config.get(arg.split('.').at(-1)).value; status = 'binary' }
        if (name !== null && SHELL_STRING.has(via)) name = name.trim().split(/\s+/)[0]
        if (name !== null) name = basename(name)
        if (exception) { status = 'exception'; name = exception[1] } else if (declared && status === 'unreadable') { status = 'declared'; name = declared[1] }
        calls.push({ file: f, line, via, name, status, arg, reason: exception?.[2] ?? null })
      }
    }
  }
  return calls.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
}

/** The parameter names of the function that encloses `index` (nearest `function name (a, b)` before it). */
function enclosingParams (mask, index) {
  const found = [...mask.slice(0, index).matchAll(/function\s+\w+\s*\(([^)]*)\)/g)].at(-1)
  return found ? found[1].split(',').map((p) => p.trim().split(/[\s=]/)[0]).filter(Boolean) : []
}

/** What fails: the binaries the image lacks and the calls nothing says which binary they start. */
export function problems (calls, have) {
  const out = []
  for (const c of calls) {
    const where = `${c.file}:${c.line}`
    if (c.status === 'unreadable') out.push(`${where}: ${c.via}(${c.arg}) starts a binary that cannot be read; put \`// binario: <name>\` next to it`)
    else if (c.status === 'exception') { if (!c.reason?.trim()) out.push(`${where}: the exception for «${c.name}» has no reason`) } else if (!have.has(c.name)) out.push(`${where}: invokes «${c.name}», which the image of the worker does not install (Dockerfile); install it there, or, if it lives on another machine on purpose, put \`// fuera-de-la-imagen: ${c.name} — <reason>\` next to the call`)
  }
  return out
}

const busybox = () => read('src/image-binaries.busybox.txt').split('\n').filter((l) => l && !l.startsWith('#'))

// ---------------------------------------------------------------- the guard

test('every binary the worker starts is installed in its image, or its absence is declared next to the call', () => {
  const dockerfile = read('Dockerfile')
  const { have } = binariesOfImage(dockerfile, busybox())
  const calls = invokedBinaries(workerFiles(dockerfile))
  assert.ok(calls.length >= 5, `the reader found ${calls.length} calls that start a process; it must read at least the ffmpeg, ffprobe, claude and git ones`)
  assert.deepEqual(problems(calls, have), [])
})

test('the image of the worker brings what the code that is certain to run needs: node, ffmpeg and ffprobe, and no claude or git', () => {
  const { have } = binariesOfImage(read('Dockerfile'), busybox())
  for (const b of ['node', 'ffmpeg', 'ffprobe', 'sh']) assert.ok(have.has(b), `the reader of the Dockerfile does not see «${b}»`)
  for (const b of ['claude', 'git']) assert.ok(!have.has(b), `«${b}» is now in the image: delete the exceptions that name it`)
})

test('no shell script goes into the image without this test reading it', () => {
  assert.deepEqual(shellScriptsInImage(read('Dockerfile')), [])
})

test('the reader: a binary the image lacks fails, a literal and a config binary are read, an exception needs its reason', () => {
  const files = {
    'a.js': [
      "import { spawn } from 'node:child_process'",
      "import { run } from './b.js'",
      "spawn('ffmpeg', [])",
      'spawn(x.bin, [])',
      "run('git', [])",
      '// spawn(\'nothing\', [])',
      'spawn(v, []) // fuera-de-la-imagen: tool — another machine',
      'spawn(w, [])'
    ].join('\n'),
    'b.js': "import { spawn } from 'node:child_process'\nexport function run (binary, args) {\n  return spawn(binary, args)\n}\n"
  }
  const calls = invokedBinaries(Object.keys(files), (f) => files[f], new Map([['bin', { env: 'X', value: 'claude' }]]))
  assert.deepEqual(calls.map((c) => [c.name, c.status]), [['ffmpeg', 'binary'], ['claude', 'binary'], ['git', 'binary'], ['tool', 'exception'], [null, 'unreadable']])
  const found = problems(calls, new Set(['ffmpeg']))
  assert.equal(found.length, 3)
  assert.match(found[0], /«claude»/)
  assert.match(found[1], /«git»/)
  assert.match(found[2], /cannot be read/)
})
