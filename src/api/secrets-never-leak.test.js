// A provider key must exist in plain text only in the request that carries it and in the request to the provider.
// This file runs the whole journey of the connections with SENTINEL keys (long, recognizable) and looks for them, and for
// the marker they share, in every place a value could end up: responses (bodies and headers), log lines, spans, the
// interface telemetry, the audit log, every table, the bytes of the SQLite file and its WAL, the error of a failed job
// and the OpenAPI contract. A control test proves each scanner can see a leak, so a pass is not an empty search.
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { test } from 'node:test'
import { all, get } from '../db/index.js'
import { storeKey } from '../domain/connections.js'
import { createLogger } from '../log.js'
import { createAnthropicClient } from '../providers/index.js'
import { connectionsEnv } from '../testing/connections-env.js'
import { withSpan } from '../domain/tracing.js'

const MARKER = 'CENTINELA'
const tail = (tag) => `${tag}-Q7W3E9R2T5Y8U1I4O6P0A3S5D7F9G2H4J6K8`
const KEYS = {
  environment: `sk-${MARKER}-ENV-${tail('E')}L1Z3`, // the key the server starts with
  old: `sk-${MARKER}-OLD-${tail('O')}0A1B`, // stored first, replaced later
  added: `sk-${MARKER}-ADD-${tail('A')}2C3D`, // the preset added with success
  replaced: `sk-${MARKER}-NEW-${tail('N')}4E5F`, // replaces the old one with success
  custom: `sk-${MARKER}-CUS-${tail('C')}6G7H`, // the custom provider
  invalid: `sk-${MARKER}-fail-invalid_key-${tail('I')}8I9J`, // fails: the upstream answers 401 and repeats the key
  noQuota: `sk-${MARKER}-fail-no_quota-${tail('Q')}1K2L`,
  timeout: `sk-${MARKER}-fail-timeout-${tail('T')}3M4N`,
  noNetwork: `sk-${MARKER}-fail-no_network-${tail('W')}5O6P`,
  badEnvironment: `sk-${MARKER}-fail-invalid_key-${tail('B')}7Q8R` // an environment key that fails when a function moves to its provider
}
const LAST4 = { added: '2C3D', replaced: '4E5F', custom: '6G7H' }
const NEEDLES = [MARKER, ...Object.values(KEYS), ...Object.values(KEYS).map((k) => k.slice(0, -4))]

/** Surfaces collected for one run: where each needle may not appear. */
function leaksIn (surface, text) {
  return NEEDLES.filter((needle) => text.includes(needle)).map((needle) => `${surface}: «${needle.slice(0, 24)}…»`)
}

function capture () {
  const lines = []
  return { lines, logger: createLogger({ logLevel: 'trace' }, {}, { write: (line) => lines.push(line) }) }
}

const tableNames = (db) => all(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").map((t) => t.name)

/** Everything the database holds, as text, one entry per table (every column of every row). */
function dumpTables (db) {
  const out = {}
  for (const name of tableNames(db)) {
    // Every column as text: the span timestamps are 64-bit integers that do not fit a JavaScript number.
    const columns = all(db, `PRAGMA table_info("${name}")`).map((c) => `CAST("${c.name}" AS TEXT) AS "${c.name}"`)
    out[name] = JSON.stringify(all(db, `SELECT ${columns.join(', ')} FROM "${name}"`))
  }
  return out
}

/** The bytes of the database file and of its WAL, as text that keeps every byte searchable. */
function fileBytes (env) {
  const files = [env.config.dbFile, `${env.config.dbFile}-wal`].filter((f) => existsSync(f))
  return files.map((f) => ({ file: f, text: readFileSync(f).toString('latin1') }))
}

/** All leaks found in logs, tables and files. Responses are checked as they are received. */
function scan (env, logs) {
  const found = []
  found.push(...leaksIn('log', logs.join('\n')))
  for (const [name, text] of Object.entries(dumpTables(env.db))) found.push(...leaksIn(`table ${name}`, text))
  for (const { file, text } of fileBytes(env)) found.push(...leaksIn(`file ${file.split('/').pop()}`, text))
  return found
}

const MALFORMED = [
  ['invalid JSON with a key inside', '{"api_key":"' + KEYS.replaced + '"', 'application/json'],
  ['plain text', KEYS.replaced, 'text/plain'],
  ['a key as the whole body', JSON.stringify(KEYS.replaced), 'application/json'],
  ['an array', JSON.stringify([KEYS.replaced]), 'application/json'],
  ['an extra field', JSON.stringify({ preset: 'gemini', api_key: KEYS.replaced, extra: KEYS.old }), 'application/json'],
  ['a key beyond the limit', JSON.stringify({ preset: 'gemini', api_key: KEYS.replaced.repeat(20) }), 'application/json'],
  ['a key as the provider name', JSON.stringify({ name: KEYS.replaced, base_url: 'https://llm.example.test/v1', api_key: KEYS.custom }), 'application/json'],
  ['a key as the address', JSON.stringify({ name: 'otro-nombre', base_url: KEYS.replaced, api_key: KEYS.custom }), 'application/json']
]

test('the whole journey of the keys leaves the sentinels in no response, log, span, table, file or job', async () => {
  const { lines, logger } = capture()
  const env = await connectionsEnv({
    envVars: { ANTHROPIC_API_KEY: KEYS.environment, DEEPSEEK_API_KEY: KEYS.badEnvironment },
    config: { providers: { probe: { timeoutMs: 60 } } }, // the key that hangs ends at this deadline
    logger,
    telemetry: true
  })
  const responses = []
  const call = async (method, url, payload, cookie = env.c.ed, headers) => {
    const res = await env.api(method, url, cookie, payload, headers)
    responses.push({ label: `${method} ${url} → ${res.statusCode}`, text: `${res.body}\n${JSON.stringify(res.headers)}`, status: res.statusCode })
    return res
  }
  try {
    // Read, with a key in the environment.
    assert.equal((await call('GET', '/settings/connections')).statusCode, 200)
    assert.equal((await call('GET', '/settings/providers')).statusCode, 200)

    // Add: a preset that works, one that fails in each way, a custom one that works and one that fails.
    const added = await call('POST', '/settings/connections', { preset: 'gemini', api_key: KEYS.added })
    assert.equal(added.statusCode, 201)
    assert.equal(added.json().connection.key.last4, LAST4.added)
    for (const key of [KEYS.invalid, KEYS.noQuota, KEYS.timeout, KEYS.noNetwork]) {
      const failed = await call('POST', '/settings/connections', { preset: 'openrouter', api_key: key })
      assert.equal(failed.statusCode, 422)
      assert.equal(failed.json().code, 'provider_check_failed')
    }
    assert.equal((await call('POST', '/settings/connections', { name: 'mi-proveedor', base_url: 'https://llm.example.test/v1', api_key: KEYS.custom, model: 'fake-model-a' })).statusCode, 201)
    assert.equal((await call('POST', '/settings/connections', { name: 'otro-proveedor', base_url: 'https://llm.example.test/v1', api_key: KEYS.invalid })).statusCode, 422)
    assert.equal((await call('POST', '/settings/connections', { preset: 'gemini', api_key: KEYS.old })).statusCode, 409)

    // Replace: success, then failures that must leave the working key in place.
    assert.equal((await call('PUT', '/settings/connections/anthropic/key', { api_key: KEYS.old })).statusCode, 200)
    const replaced = await call('PUT', '/settings/connections/anthropic/key', { api_key: KEYS.replaced })
    assert.equal(replaced.statusCode, 200)
    assert.equal(replaced.json().connection.key.last4, LAST4.replaced)
    for (const key of [KEYS.invalid, KEYS.noQuota, KEYS.timeout, KEYS.noNetwork]) assert.equal((await call('PUT', '/settings/connections/anthropic/key', { api_key: key })).statusCode, 422)
    assert.equal(env.connectionsNow().anthropic.apiKey, KEYS.replaced)

    // Diagnose: working, then revoked (the upstream answers 401 and repeats the key), connection and functions.
    assert.equal((await call('POST', '/settings/connections/anthropic/check', {})).json().check.ok, true)
    assert.equal((await call('POST', '/settings/providers/text/check', {})).statusCode, 200)
    env.upstream.revoked.add(KEYS.replaced)
    assert.equal((await call('POST', '/settings/connections/anthropic/check', {})).json().check.cause, 'invalid_key')
    assert.equal((await call('POST', '/settings/providers/vision/check', {})).json().check.cause, 'invalid_key')
    env.upstream.revoked.delete(KEYS.replaced)
    assert.equal((await call('POST', '/settings/connections/gemini/check', { model: 'missing-model' })).statusCode, 200)

    // Change a function: to a provider that works, to one whose environment key fails, to one that does not exist, with a bad body.
    assert.equal((await call('PATCH', '/settings/providers', { slot: 'text', provider: 'gemini', model: 'fake-model-a' })).statusCode, 200)
    const badEnvironment = await call('PATCH', '/settings/providers', { slot: 'vision', provider: 'deepseek', model: 'deepseek-flash' })
    assert.equal(badEnvironment.statusCode, 422)
    assert.equal(badEnvironment.json().cause, 'invalid_key')
    assert.equal((await call('PATCH', '/settings/providers', { slot: 'vision', provider: 'inexistente', model: 'x' })).statusCode, 422)
    assert.equal((await call('PATCH', '/settings/providers', { slot: 'text', provider: 'gemini', model: 'missing-model' })).statusCode, 422)
    assert.equal((await call('PATCH', '/settings/providers', { slot: 'text', extra: KEYS.old })).statusCode, 400)
    assert.equal((await call('PATCH', '/settings/providers', { analyzer: 'harness' })).statusCode, 200)

    // Retire and delete, blocked and allowed.
    assert.equal((await call('DELETE', '/settings/connections/gemini/key')).statusCode, 409) // the text function uses it
    assert.equal((await call('DELETE', '/settings/connections/anthropic/key')).statusCode, 200) // the environment key remains
    assert.equal((await call('DELETE', '/settings/connections/mi-proveedor')).statusCode, 200)
    assert.equal((await call('PATCH', '/settings/providers', { slot: 'text', provider: 'anthropic', model: 'claude-haiku-5-5' })).statusCode, 200)
    assert.equal((await call('DELETE', '/settings/connections/gemini/key')).statusCode, 200)

    // Malformed requests: authenticated editor, a member and an anonymous caller.
    for (const [label, body, type] of MALFORMED) {
      const res = await call('POST', '/settings/connections', body, env.c.ed, { 'content-type': type })
      assert.ok(res.statusCode >= 400 && res.statusCode < 500, `${label}: ${res.statusCode}`)
      assert.equal((await call('PUT', '/settings/connections/anthropic/key', body, env.c.ed, { 'content-type': type })).statusCode >= 400, true, label)
      assert.equal((await call('POST', '/settings/connections', body, env.c.ana, { 'content-type': type })).statusCode, 403, label)
      assert.equal((await call('POST', '/settings/connections', body, null, { 'content-type': type })).statusCode, 401, label)
    }

    // Interface telemetry: a valid batch about the keys screen, and one that tries to carry a key in a field.
    const batch = (endpoint) => ({ session: '0123456789abcdef', events: [{ type: 'error', age_ms: 10, kind: 'http', screen: 'settings', status: 422, endpoint }] })
    assert.equal((await call('POST', '/telemetry/ui', batch('/settings/connections/:id/key'), env.c.ana)).statusCode, 204)
    assert.equal((await call('POST', '/telemetry/ui', batch(`/${KEYS.replaced}`), env.c.ana)).statusCode, 400)
    await env.telemetry.flush()
    assert.equal((await call('GET', '/telemetry/ui-summary')).statusCode, 200)

    // Everything that reads state back.
    for (const url of ['/audit?limit=100', '/jobs', '/settings/connections', '/settings/providers', '/members']) await call('GET', url)
    const contract = await env.app.inject({ method: 'GET', url: '/api/openapi.json' })
    assert.equal(contract.statusCode, 200)
    responses.push({ label: 'openapi.json', text: `${contract.body}\n${JSON.stringify(contract.headers)}`, status: 200 })

    // A failed job: a real client called with a key whose provider repeats it in the error, stored as the error of a job.
    const client = createAnthropicClient({ apiKey: KEYS.invalid, fetchImpl: env.upstream.fetchImpl, baseUrl: 'https://api.anthropic.com', timeoutMs: 1000 })
    const failure = await client.complete({ messages: [{ role: 'user', content: 'ping' }] }).then(() => null, (error) => error)
    assert.ok(failure, 'the provider call had to fail')
    const jobId = env.queue.enqueue('analyze', {})
    const job = env.queue.claim('worker-leak-test')
    assert.equal(job.id, jobId)
    env.queue.fail(job, failure, { permanent: true })
    assert.equal(get(env.db, 'SELECT status FROM jobs WHERE id = ?', jobId).status, 'failed')
    await env.telemetry.flush()

    // The scan.
    const leaks = [
      ...responses.flatMap((r) => leaksIn(`response ${r.label}`, r.text)),
      ...scan(env, lines)
    ]
    assert.deepEqual(leaks, [])

    // The scan looked at something: logs were captured, spans exist, and the legitimate traces of a key are where they belong.
    assert.ok(lines.length > 20, `log lines captured: ${lines.length}`)
    assert.ok(all(env.db, 'SELECT name FROM spans').length > 0)
    const rows = all(env.db, 'SELECT * FROM provider_connections')
    assert.ok(rows.length >= 3)
    for (const row of rows) {
      if (row.sealed_value) assert.match(row.sealed_value, /^v1:[0-9a-f]{8}:[\w-]+:[\w-]+:[\w-]+$/)
      assert.ok(row.sealed_value === null || row.last4.length === 4)
    }
    const list = (await env.ed('GET', '/settings/connections')).json().items
    assert.equal(list.find((c) => c.name === 'gemini').key.last4, null) // retired above
    assert.equal(rows.find((r) => r.name === 'mi-proveedor'), undefined)
    assert.ok(fileBytes(env).some((f) => f.text.includes(LAST4.custom) || f.text.includes('last4')))
  } finally {
    await env.close()
  }
})

test('a stored key shows only its last four in the list, the providers view and the table', async () => {
  const env = await connectionsEnv({ envVars: {} })
  try {
    assert.equal((await env.ed('POST', '/settings/connections', { preset: 'gemini', api_key: KEYS.added })).statusCode, 201)
    const list = (await env.ed('GET', '/settings/connections')).json().items.find((c) => c.name === 'gemini')
    assert.equal(list.key.last4, LAST4.added)
    const row = get(env.db, "SELECT * FROM provider_connections WHERE name = 'gemini'")
    assert.equal(row.last4, LAST4.added)
    assert.ok(row.sealed_value.startsWith('v1:'))
    assert.deepEqual(leaksIn('row', JSON.stringify(row)), [])
    assert.ok(fileBytes(env).some((f) => f.text.includes('v1:')), 'the sealed text is in the file or its WAL, the key is not')
    assert.deepEqual(scan(env, []), [])
  } finally {
    await env.close()
  }
})

test('control: each scanner sees a sentinel that really leaks, so the journey above cannot pass for lack of looking', async () => {
  const { lines, logger } = capture()
  const env = await connectionsEnv({ logger })
  try {
    assert.deepEqual(scan(env, lines), [], 'the control starts clean')

    // Log: a function that interpolates the key in a log line.
    const leakyFunction = (key) => env.app.log.info(`calling the provider with ${key}`)
    leakyFunction(KEYS.added)
    assert.ok(scan(env, lines).some((l) => l.startsWith('log:')), 'the log scanner must see an interpolated key')

    // Response: the same scanner applied to a response body that carries the key.
    assert.ok(leaksIn('response', JSON.stringify({ message: `bad key ${KEYS.added}` })).length > 0)
    assert.ok(leaksIn('response', JSON.stringify({ message: `bad key ${KEYS.added.slice(0, -4)}` })).length > 0) // all but the last four
    assert.deepEqual(leaksIn('response', JSON.stringify({ last4: LAST4.added })), []) // the last four alone is allowed

    // Tables: an audit row, a job error and a span with the key.
    env.db.prepare("INSERT INTO audit_log (at, member_id, action, entity, entity_id, detail_json) VALUES (1, NULL, 'x', 'connection', 'x', ?)").run(JSON.stringify({ key: KEYS.old }))
    assert.ok(scan(env, []).some((l) => l.startsWith('table audit_log')))
    env.db.prepare("DELETE FROM audit_log WHERE action = 'x'").run()
    assert.deepEqual(scan(env, []).filter((l) => l.startsWith('table')), [])
    const jobId = env.queue.enqueue('analyze', {})
    env.queue.fail(env.queue.claim('worker-control'), new Error(`provider said: bad key ${KEYS.custom}`), { permanent: true })
    assert.ok(scan(env, []).some((l) => l.startsWith('table jobs')), `job ${jobId}`)

    // File: a value written to any table is found in the bytes of the file or of its WAL.
    env.db.prepare("INSERT INTO settings (key, value_json, updated_at) VALUES ('control.leak', ?, 1)").run(JSON.stringify(KEYS.replaced))
    assert.ok(scan(env, []).some((l) => l.startsWith('file ')), 'the byte scanner must see a key written to the database')

    // Spans: the scanner reads the `spans` table, which holds what the SDK exports.
    assert.ok(tableNames(env.db).includes('spans'))
  } finally {
    await env.close()
  }
})

test('control: the vault is what keeps a stored key out of the file, and a plain value would not be', async () => {
  const env = await connectionsEnv()
  try {
    storeKey(env.db, env.vault, 'deepseek', KEYS.added)
    assert.deepEqual(scan(env, []), [])
    const plainVault = { seal: (plain) => plain } // a vault that does not encrypt
    storeKey(env.db, plainVault, 'gemini', KEYS.old)
    assert.ok(scan(env, []).some((l) => l.startsWith('table provider_connections')))
  } finally {
    await env.close()
  }
})
