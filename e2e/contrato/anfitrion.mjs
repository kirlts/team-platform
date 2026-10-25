// The configuration of the Team Platform worker of the host, read from the file that declares it (`services.team-platform-worker.environment` of the
// compose file of the host) and turned into the `execute` configuration by the product's own loader. Nothing is copied by hand: a value that the host
// changes there changes here. The file is the host's, and rule 10 keeps its name out of versioned files: TEAM_HOST_COMPOSE, or the path in the ignored
// bench/private/host-compose.txt (in this checkout or in the main one of a linked worktree).
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load, YAML11_SCHEMA } from 'js-yaml'
import { loadConfig } from '../../src/config.js'

const SERVICE = 'team-platform-worker'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

function declaredPath () {
  if (process.env.TEAM_HOST_COMPOSE) return process.env.TEAM_HOST_COMPOSE
  const candidates = [join(root, 'bench', 'private', 'host-compose.txt')]
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim()
    candidates.push(join(dirname(common), 'bench', 'private', 'host-compose.txt'))
  } catch { /* not a git checkout */ }
  const file = candidates.find((p) => existsSync(p))
  return file ? readFileSync(file, 'utf8').trim() : ''
}

export const COMPOSE = declaredPath()

/** `${NAME:-fallback}` and `${NAME-fallback}` resolve to their fallback: the file is read as the host runs it with no variable of its own. */
const interpolate = (v) => String(v).replace(/\$\{[A-Za-z_][A-Za-z0-9_]*:?-([^}]*)\}/g, '$1').replace(/\$\{[A-Za-z_][A-Za-z0-9_]*\}/g, '')

function environmentOf (text) {
  const service = load(text, { schema: YAML11_SCHEMA })?.services?.[SERVICE]
  const env = service?.environment
  if (!env) return null
  const entries = Array.isArray(env) ? env.map((l) => { const i = String(l).indexOf('='); return [String(l).slice(0, i), String(l).slice(i + 1)] }) : Object.entries(env)
  return Object.fromEntries(entries.filter(([k]) => k.startsWith('EXECUTE_')).map(([k, v]) => [k, interpolate(v ?? '')]))
}

/**
 * The EXECUTE_* variables of the worker of the host, with where they were read. The file is the checkout at COMPOSE. A checkout
 * that has not pulled yet may not declare them: the same file at `origin/main` of that repository is read then, and the source says so. Throws, with the reason, when the
 * file does not exist or no copy of it declares the worker.
 */
export function entornoDelTrabajador () {
  if (!COMPOSE) throw new Error('No se sabe dónde está el compose del anfitrión: el contrato es «Team Platform en el anfitrión» y la configuración de su trabajador vive en ese archivo. Declarar la ruta en TEAM_HOST_COMPOSE o en bench/private/host-compose.txt.')
  if (!existsSync(COMPOSE)) throw new Error(`No existe ${COMPOSE}: el contrato es «Team Platform en el anfitrión» y la configuración de su trabajador vive en ese archivo (TEAM_HOST_COMPOSE apunta a otra ruta).`)
  const here = environmentOf(readFileSync(COMPOSE, 'utf8'))
  if (here && 'EXECUTE_MAX_TURNS' in here) return { source: COMPOSE, env: here }
  try {
    const root = execFileSync('git', ['-C', dirname(COMPOSE), 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
    const text = execFileSync('git', ['-C', root, 'show', `origin/main:${relative(root, COMPOSE)}`], { encoding: 'utf8' })
    const there = environmentOf(text)
    if (there && 'EXECUTE_MAX_TURNS' in there) return { source: `origin/main:${relative(root, COMPOSE)}`, env: there }
  } catch { /* no repository or no origin/main: the error below says what is missing */ }
  throw new Error(`${COMPOSE} existe pero no declara EXECUTE_* en services.${SERVICE}.environment, ni su copia en origin/main: no hay configuración del trabajador del anfitrión que probar.`)
}

/** The `execute` configuration of the worker of the host, as the product's loader reads it; `keys` picks the parts a test runs with (the rest stays the suite's). */
export function configDelTrabajador (dataDir, keys) {
  const { source, env } = entornoDelTrabajador()
  const execute = loadConfig({ DATA_DIR: dataDir, LOG_LEVEL: 'silent', ...env }).execute
  return { source, execute: Object.fromEntries(keys.map((k) => [k, execute[k]])), env }
}
