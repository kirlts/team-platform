// The real API of this repository, built in process and listening on a port of the range reserved for tests (8750-8759), with
// a client logged in as each member. The client under test talks to it over HTTP with a cookie jar standing in for the browser.
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { createTeamClient, type TeamClient, type TeamClientOptions } from '../src/index.js'

/** Waits until `fn` returns a truthy value (the same helper as the server's tests, without importing its modules in a DOM environment). */
export async function until<T>(fn: () => Promise<T> | T, { timeoutMs = 8000, everyMs = 10 } = {}): Promise<NonNullable<T>> {
  const cap = Date.now() + timeoutMs
  for (;;) {
    const v = await fn()
    if (v) return v as NonNullable<T>
    if (Date.now() > cap) throw new Error('until: timed out waiting for the condition')
    await new Promise((r) => setTimeout(r, everyMs))
  }
}

export interface TestServer {
  env: any // eslint-disable-line @typescript-eslint/no-explicit-any
  baseUrl: string
  /** A client with no session. */
  anonymous(options?: TeamClientOptions): TeamClient
  /** A client with the session of the member (logged in the first time it is asked for). */
  as(email: string, options?: TeamClientOptions): Promise<TeamClient>
  ids: Record<string, string>
  close(): Promise<void>
}

/** `fetch` that keeps the cookies the server sets, as a browser does for one origin. */
export function jarFetch(): typeof fetch {
  const jar = new Map<string, string>()
  return async (input, init = {}) => {
    const headers = new Headers(init.headers)
    if (jar.size) headers.set('cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '))
    const res = await fetch(input, { ...init, headers })
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';')
      const eq = pair.indexOf('=')
      const name = pair.slice(0, eq)
      const value = pair.slice(eq + 1)
      if (value) jar.set(name, value)
      else jar.delete(name)
    }
    return res
  }
}

const PASSWORD = 'una clave larga de prueba 1'
const MEMBERS = [
  { email: 'ed@x.org', name: 'Ed', role: 'editor' },
  { email: 'ana@x.org', name: 'Ana', role: 'member' },
  { email: 'beto@x.org', name: 'Beto', role: 'member' },
]

const POOL_PORT = () => 8750 + ((Number(process.env.VITEST_POOL_ID ?? 1) - 1) % 10)

function clients(baseUrl: string, ids: Record<string, string>, env: TestServer['env'], close: () => Promise<void>): TestServer {
  const anonymous = (o: TeamClientOptions = {}) => createTeamClient({ baseUrl, fetch: jarFetch(), requestMarker: 'test', ...o })
  return {
    env,
    baseUrl,
    ids,
    anonymous,
    async as(email, o = {}) {
      const client = anonymous(o)
      await client.auth.login({ email, password: PASSWORD })
      return client
    },
    close,
  }
}

/** The API in this process (Node environment). */
export async function startServer(options: { worker?: boolean; autoPublish?: boolean } = {}): Promise<TestServer> {
  const { addMember, makeEnv } = await import('../../../src/testing/helpers.js')
  const env = await makeEnv({ config: { identity: { login: { ipMax: 10_000 } } }, worker: options.worker ?? true, autoPublish: options.autoPublish ?? true })
  const ids: Record<string, string> = {}
  for (const m of MEMBERS) ids[m.email.split('@')[0]] = String(await addMember(env, m))
  const port = POOL_PORT()
  await env.app.listen({ host: '127.0.0.1', port })
  return clients(`http://127.0.0.1:${port}`, ids, env, () => env.close())
}

/** The API in a child process, for the DOM environment, where the server cannot run in the test's own process. */
export async function startServerProcess(): Promise<TestServer> {
  const port = POOL_PORT()
  const child = spawn(process.execPath, [join(process.cwd(), 'test', 'serve.mjs'), String(port), JSON.stringify(MEMBERS)], { stdio: ['ignore', 'pipe', 'inherit'] })
  const ready = await new Promise<{ ids: Record<string, string> }>((resolve, reject) => {
    let out = ''
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString()
      const line = out.split('\n').find((l) => l.startsWith('{'))
      if (line) resolve(JSON.parse(line))
    })
    child.on('exit', (code) => reject(new Error(`the test server exited with ${code}`)))
  })
  return clients(`http://127.0.0.1:${port}`, ready.ids, null, async () => {
    child.removeAllListeners('exit')
    child.kill('SIGTERM')
    await new Promise((r) => child.once('exit', r))
  })
}

/** Sends a text through the API and waits for the worker to publish it (automatic publication); returns the id of the first message. */
export async function publishedMessage(client: TeamClient, text = 'algo que pasó'): Promise<string> {
  // JSON, not multipart: a DOM environment replaces FormData with one Node's fetch cannot send.
  const { input_id } = await client.request<{ input_id: string }>('/inputs', { method: 'POST', body: { text, links: [] } })
  const input = await until(async () => {
    const v = await client.inputs.get(input_id)
    if (v.status === 'failed') throw new Error(String(v.error))
    return v.status === 'published' ? v : null
  })
  return String(input.message_ids?.[0] ?? input.messages?.[0]?.id)
}

