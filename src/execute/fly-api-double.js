// A double of the Fly Machines API for the test of drivers/fly-machines (src/execute/drivers-fly-machines.test.js): an HTTP server on a local port that answers the
// calls of the driver and keeps each «machine» as a Docker container of the driver's own image, so that the scripts of the machine run for real and nothing is
// spent in Fly. It reproduces the behaviours of the API that the driver depends on and that were measured against the real one on 2026-10-27:
//   - the command of the machine is `config.init.exec`; with `auto_destroy` the machine disappears when that process ends (the container runs with --rm);
//   - an exec answers when its command ends, never before, with { stdout, stderr, exit_code }; it is cut with HTTP 408 when `timeout` seconds pass;
//   - the body of an exec above 16,384 bytes is refused by answering HTTP 200 with exit_code 0 and «Unhandled rejection» on stderr;
//   - `stdin` is not delivered to the command;
//   - an exec answer above 10,485,760 bytes is refused with HTTP 413;
//   - GET by machine name is a 404 (the API addresses machines by id);
//   - a list takes `metadata.<key>=<value>` filters.
// `inject(rule)` makes the next calls that match answer with a given status, to reach the answers a test cannot provoke (429, a capacity refusal).
import { execFile, spawn } from 'node:child_process'
import { createServer } from 'node:http'

export const TOKEN = 'test-token-not-a-secret'
const EXEC_BODY_LIMIT = 16384 // bytes, measured 2026-10-27 (between 16,072 accepted and 17,072 refused)
const EXEC_ANSWER_LIMIT = 10 * 1024 * 1024 // bytes after JSON encoding, measured 2026-10-27

const docker = (...args) => new Promise((resolve) => execFile('docker', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => resolve({ code: error ? (error.code ?? 1) : 0, stdout, stderr })))

export async function startFlyDouble ({ app = 'double-app' } = {}) {
  const machines = new Map() // id -> { id, name, container, metadata, config, createdAt }
  const calls = []
  const rules = []
  let counter = 0
  const prefix = `flydouble-${process.pid}`

  const alive = async (m) => (await docker('inspect', '-f', '{{.State.Running}}', m.container)).stdout.trim() === 'true'
  const view = (m, state) => ({ id: m.id, name: m.name, state, region: 'dbl', config: m.config, created_at: m.createdAt })

  async function route (req, body) {
    const url = new URL(req.url, 'http://double')
    const key = `${req.method} ${url.pathname}`
    calls.push({ method: req.method, path: url.pathname, query: url.search, body })
    const injected = rules.find((r) => r.times > 0 && (typeof r.match === 'function' ? r.match(key, body) : r.match.test(key)))
    if (injected) { injected.times -= 1; return { status: injected.status, body: injected.body, headers: injected.headers } }
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return { status: 403, body: { error: 'unauthorized' } }
    const m = new RegExp(`^/v1/apps/${app}/machines(?:/([^/]+)(?:/(wait|exec))?)?$`).exec(url.pathname)
    if (!m) return { status: 404, body: { error: 'not_found' } }
    const [, id, action] = m
    if (!id && req.method === 'GET') {
      const filters = [...url.searchParams].filter(([k]) => k.startsWith('metadata.')).map(([k, v]) => [k.slice(9), v])
      const out = []
      for (const machine of machines.values()) {
        if (!(await alive(machine))) { machines.delete(machine.id); continue }
        if (filters.every(([k, v]) => machine.metadata[k] === v)) out.push(view(machine, 'started'))
      }
      return { status: 200, body: out }
    }
    if (!id && req.method === 'POST') {
      const { name, config } = body
      if (!config?.image) return { status: 400, body: { error: 'invalid_argument: image is required' } }
      if ([...machines.values()].some((x) => x.name === name)) return { status: 409, body: { error: `already_exists: machine name ${name} is taken` } }
      const machine = { id: `d${(++counter).toString(16).padStart(13, '0')}`, name, metadata: config.metadata ?? {}, config, createdAt: new Date().toISOString() }
      machine.container = `${prefix}-${machine.id}`
      const run = await docker('run', '-d', '--rm', '--name', machine.container, '--label', `flydouble=${prefix}`, config.image, ...(config.init?.exec ?? []))
      if (run.code !== 0) return { status: 500, body: { error: `could not start the container: ${run.stderr.slice(0, 200)}` } }
      machines.set(machine.id, machine)
      return { status: 200, body: view(machine, 'started') }
    }
    const machine = machines.get(id)
    if (!machine || !(await alive(machine))) { machines.delete(id); return { status: 404, body: { error: 'machine not found' } } }
    if (action === 'wait' && req.method === 'GET') return { status: 200, body: { ok: true, state: 'started' } }
    if (!action && req.method === 'DELETE') {
      await docker('rm', '-f', machine.container)
      machines.delete(id)
      return { status: 200, body: { ok: true } }
    }
    if (action === 'exec' && req.method === 'POST') return exec(machine, body)
    return { status: 405, body: { error: 'method not allowed' } }
  }

  function exec (machine, body) {
    if (Buffer.byteLength(JSON.stringify(body)) > EXEC_BODY_LIMIT) {
      return { status: 200, body: { stdout: '', stderr: 'Unhandled rejection: Rejection([PayloadTooLarge, MethodNotAllowed])', exit_code: 0, exit_signal: 0 } }
    }
    return new Promise((resolve) => {
      // `stdin` is ignored: the command reads /dev/null, as on the real machine.
      const child = spawn('docker', ['exec', machine.container, ...body.command], { stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (c) => { stdout += c })
      child.stderr.on('data', (c) => { stderr += c })
      // 408 and its body: what the real API answers when an exec overruns (measurement 2026-10-27, drivers/fly-machines/lib/fly.mjs:39); 30 s: declared courtesy, the same default as exec() of drivers/fly-machines/lib/fly.mjs for a caller that sends no timeout
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve({ status: 408, body: { error: 'deadline_exceeded: Post "http://unix/v1/exec": context deadline exceeded' } }) }, (body.timeout ?? 30) * 1000)
      child.on('close', (code) => {
        clearTimeout(timer)
        const answer = { stdout, stderr, exit_code: code ?? -1, exit_signal: 0 }
        if (Buffer.byteLength(JSON.stringify(answer)) > EXEC_ANSWER_LIMIT) return resolve({ status: 413, body: { error: 'exec output exceeds the maximum allowed response size after JSON encoding (10485760 byte limit)' } })
        resolve({ status: 200, body: answer })
      })
    })
  }

  const server = createServer((req, res) => {
    const parts = []
    req.on('data', (c) => parts.push(c))
    req.on('end', async () => {
      let body
      try { body = parts.length ? JSON.parse(Buffer.concat(parts).toString('utf8')) : undefined } catch { body = undefined }
      const out = await route(req, body)
      res.writeHead(out.status, { 'content-type': 'application/json', ...(out.headers ?? {}) })
      res.end(JSON.stringify(out.body))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    app,
    machines,
    calls,
    /** The next `times` calls that match answer with this status. `match` is a regular expression on «METHOD path» or a function (key, body) => boolean. */
    inject (match, status, body = { error: 'injected' }, { times = 1, headers } = {}) { rules.push({ match, status, body, times, headers }) },
    /** Forgets the injected answers that were not used. */
    clearInjected () { rules.length = 0 },
    async close () {
      await new Promise((resolve) => server.close(resolve))
      const left = await docker('ps', '-aq', '--filter', `label=flydouble=${prefix}`)
      const ids = left.stdout.split('\n').filter(Boolean)
      if (ids.length) await docker('rm', '-f', ...ids)
    }
  }
}
