// A short map of the repository a session starts in (UD-295): what a light model needs to know what it is getting into, in about 800 tokens.
// It runs inside the session (a SessionStart hook calls `team map`), in the repository it works on, so it is the same on the local runner and on a machine.
//
//   structure   top-level folders with their file count, and where screens, API, migrations and tests live. Computed from the file list of `git ls-files`
//               and the folder NAMES (pages, routes, migrations, tests…); no file is read. It is cached in `<git dir>/team-map.json` under the hash of that
//               list's folders and their counts, so it is rebuilt only when the structure changes, never by hand.
//   hot files   the files most touched by commits of the last 30 days (`git log --since=30.days --name-only`), without lock files, builds or generated
//               files; with `paths` (TEAM_MAP_PATHS, comma-separated prefixes) only those of the area's folders.
//   notes       lines the host writes about its own repository (the file `.team/map-notes.txt` of the repository, or the one TEAM_MAP_NOTES names; one line per note): what the file list cannot say, such as the command that picks the tests
//               of a change or where the decisions are written. They go after the structure and are the last thing the budget cuts.
//   footer      the two commands that produced it.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
// outside-the-image: git — it runs inside the session (`team map`), on the machine or in the worktree where the session works, never in the worker
const git = async (cwd, args) => (await run('git', ['-c', 'core.quotepath=off', ...args], { cwd, maxBuffer: 64 * 1024 * 1024 })).stdout

export const MAP_DAYS = 30 // Martín's window: the files most touched in the last 30 days
export const MAP_TOP_FILES = 10
export const MAP_NOTES_FILE = '.team/map-notes.txt' // where a repository keeps its notes for the map unless TEAM_MAP_NOTES names another file; it travels with the code it describes
export const MAP_MAX_TOKENS = 800 // Martín's budget for the whole map
// A line of code or Spanish prose is about 3 characters per token with the current tokenizer; the measurement of UD-295 sets the real figure.
export const CHARS_PER_TOKEN = 3

const NOISE = /(^|\/)(node_modules|dist|build|coverage|\.next|vendor)\/|package-lock\.json$|pnpm-lock\.yaml$|yarn\.lock$|\.min\.(js|css)$|openapi\.json$|\/generated\/|\.(png|jpe?g|webp|gif|svg|ico|woff2?|webm|mp4)$/
const KINDS = [
  ['pantallas', /^(pages|screens|views|components|panel)$/i],
  ['api', /^(api|routes|handlers|controllers|endpoints)$/i],
  ['migraciones', /^(migrations|migrate)$/i],
  ['pruebas', /^(tests?|__tests__|e2e|spec|specs)$/i]
]

const topTwo = (file) => file.split('/').slice(0, 2).join('/')

/** Folders (depth 1 and 2) with their file count, from the tracked file list. */
export function structureOf (files) {
  const counts = new Map()
  for (const f of files) {
    if (NOISE.test(f)) continue
    const parts = f.split('/')
    if (parts.length === 1) { counts.set('.', (counts.get('.') ?? 0) + 1); continue }
    counts.set(parts[0], (counts.get(parts[0]) ?? 0) + 1)
    if (parts.length > 2) counts.set(topTwo(f), (counts.get(topTwo(f)) ?? 0) + 1)
  }
  return counts
}

const hashOf = (counts) => createHash('sha1').update([...counts].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}\t${v}`).join('\n')).digest('hex').slice(0, 16)

/** Where each kind of thing lives: every folder (any depth) whose last segment names it, the biggest first, at most two per kind. */
export function placesOf (files) {
  const dirs = new Map()
  for (const f of files) {
    if (NOISE.test(f)) continue
    const parts = f.split('/').slice(0, -1)
    for (let i = 0; i < parts.length; i++) { const dir = parts.slice(0, i + 1).join('/'); dirs.set(dir, (dirs.get(dir) ?? 0) + 1) }
  }
  return KINDS.map(([kind, pattern]) => {
    const found = [...dirs].filter(([dir]) => pattern.test(dir.split('/').at(-1))).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 2)
    if (!found.length) return null
    // The newest migration says which number comes next; the name sorts last because migrations are numbered or dated.
    const latest = kind === 'migraciones' ? files.filter((f) => !NOISE.test(f) && f.startsWith(`${found[0][0]}/`) && !f.slice(found[0][0].length + 1).includes('/')).sort().at(-1) : null
    return `${kind}: ${found.map(([dir, n]) => `${dir} (${n})`).join(', ')}${latest ? `; última ${latest.split('/').at(-1)}` : ''}`
  }).filter(Boolean)
}

/** The host's notes: the non-empty lines of the file `ref` (relative to `cwd`, or absolute). No file or no `ref` is no notes: the map is a help, never a reason for a session not to start. */
export async function readNotes (cwd, ref) {
  if (!ref) return []
  try { return (await readFile(isAbsolute(ref) ? ref : join(cwd, ref), 'utf8')).split('\n').map((l) => l.trim()).filter(Boolean) } catch { return [] }
}

/** The structure text; the cached copy when the hash of the folders is the same. */
async function structureText (cwd, files) {
  const counts = structureOf(files)
  const hash = hashOf(counts)
  const cacheFile = join((await git(cwd, ['rev-parse', '--absolute-git-dir'])).trim(), 'team-map.json')
  try {
    const cached = JSON.parse(await readFile(cacheFile, 'utf8'))
    if (cached.hash === hash) return { text: cached.text, hash, cached: true }
  } catch { /* no cache yet */ }
  const top = [...counts].filter(([k]) => !k.includes('/') && k !== '.').sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
  const text = [`Carpetas (archivos): ${top.map(([k, n]) => `${k} ${n}`).join(' · ')}`, ...placesOf(files)].join('\n')
  try { await mkdir(join(cacheFile, '..'), { recursive: true }); await writeFile(cacheFile, JSON.stringify({ hash, text })) } catch { /* a read-only git dir: it is rebuilt next time */ }
  return { text, hash, cached: false }
}

export async function hotFiles (cwd, { days = MAP_DAYS, top = MAP_TOP_FILES, paths = [] } = {}) {
  const out = await git(cwd, ['log', `--since=${days}.days`, '--name-only', '--pretty=format:'])
  const counts = new Map()
  for (const f of out.split('\n')) {
    if (!f || NOISE.test(f) || (paths.length && !paths.some((p) => f.startsWith(p)))) continue
    counts.set(f, (counts.get(f) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, top)
}

/** The map as text within `maxTokens`: the hot files are cut from the bottom first, then the structure lines. */
export async function buildRepoMap ({ cwd = process.cwd(), days = MAP_DAYS, top = MAP_TOP_FILES, maxTokens = MAP_MAX_TOKENS, charsPerToken = CHARS_PER_TOKEN, paths = [], brief = false, notes = [] } = {}) {
  const files = (await git(cwd, ['ls-files'])).split('\n').filter(Boolean)
  const structure = await structureText(cwd, files)
  const hot = await hotFiles(cwd, { days, top, paths })
  const source = `Fuente: git ls-files (carpetas y nombres, sin leer archivos) y git log --since=${days}.days --name-only${paths.length ? ` en ${paths.join(', ')}` : ''}.`
  const budget = maxTokens * charsPerToken
  let kept = [...notes]
  const build = (n, structureLines) => [
    '<repo_map>', ...structureLines, ...kept,
    hot.length && n > 0 ? `Más tocados en ${days} días: ${hot.slice(0, n).map(([f, c]) => `${f} (${c})`).join(', ')}` : null,
    source, '</repo_map>'
  ].filter(Boolean).join('\n')
  // `brief` (the light model, KAIROS-PARA-TEAM-PLATFORM.md of the host §6): only where things live and the paths most touched; no folder counts.
  let lines = brief ? structure.text.split('\n').slice(1) : structure.text.split('\n')
  let n = hot.length
  let text = build(n, lines)
  while (text.length > budget && n > 0) text = build(--n, lines)
  while (text.length > budget && lines.length > 1) { lines = lines.slice(0, -1); text = build(n, lines) }
  while (text.length > budget && kept.length > 0) { kept = kept.slice(0, -1); text = build(n, lines) }
  return { text, structureHash: structure.hash, cached: structure.cached, hotFiles: n, notes: kept.length, estimatedTokens: Math.ceil(text.length / charsPerToken) }
}
