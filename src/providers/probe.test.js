// Tests of the minimal provider call (UD-120): the nine causes, the model list and the guarantee that nothing the
// provider answers, nor the key, comes back in the result. Everything runs against the fake upstream: no real service.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createFakeUpstream } from './fake.js'
import { CHECK_CAUSES, classifyStatus, probeConnection } from './probe.js'

const BASE = 'https://api.example.test/v1'
const RESULT_KEYS = ['cause', 'checked_at', 'duration_ms', 'model', 'model_listed', 'models', 'ok', 'status']

function probe (spec, upstream = createFakeUpstream()) {
  return probeConnection({ kind: 'openai-compatible', baseUrl: BASE, apiKey: 'sk-plain-key-1234', model: 'fake-model-a', timeoutMs: 5000, fetchImpl: upstream.fetchImpl, ...spec })
}

test('CHECK_CAUSES lists the nine causes of the contract', () => {
  assert.deepEqual([...CHECK_CAUSES].sort(), ['bad_address', 'invalid_key', 'model_not_found', 'no_network', 'no_quota', 'provider_error', 'rate_limited', 'timeout', 'unknown'])
})

test('classifyStatus: authentication first, then quota against rate, then model, then server', () => {
  const cases = [
    [401, null, 'invalid_key'], [403, { error: { type: 'x' } }, 'invalid_key'],
    [402, null, 'no_quota'],
    [429, { error: { type: 'insufficient_quota' } }, 'no_quota'],
    [429, { error: { code: 'billing_hard_limit_reached' } }, 'no_quota'],
    [429, { error: { type: 'rate_limit_error' } }, 'rate_limited'], [429, null, 'rate_limited'],
    [404, { error: { code: 'model_not_found' } }, 'model_not_found'],
    [404, { error: { type: 'not_found_error' } }, 'model_not_found'],
    [404, { error: { message: 'not found' } }, 'bad_address'], [404, null, 'bad_address'],
    [400, { error: { message: 'Your credit balance is too low to access the API' } }, 'no_quota'],
    [400, { error: { message: 'You have reached your specified API usage limit' } }, 'no_quota'],
    [400, { error: { code: 'model_not_found' } }, 'model_not_found'],
    [400, { error: { message: 'The model xyz does not exist' } }, 'model_not_found'],
    [400, { error: { message: 'bad json' } }, 'unknown'], [400, null, 'unknown'],
    [500, null, 'provider_error'], [503, null, 'provider_error'], [529, null, 'provider_error'],
    [302, null, 'unknown'], [418, null, 'unknown']
  ]
  for (const [status, body, cause] of cases) assert.equal(classifyStatus(status, body), cause, `${status} ${JSON.stringify(body)}`)
  assert.ok(cases.every(([, , cause]) => CHECK_CAUSES.includes(cause)))
})

test('classifyStatus survives bodies of any shape', () => {
  for (const body of [undefined, 'text', 12, [], { error: 'string error' }, { error: null }, { error: 5 }]) {
    assert.ok(CHECK_CAUSES.includes(classifyStatus(400, body)))
    assert.ok(CHECK_CAUSES.includes(classifyStatus(429, body)))
  }
})

test('a working key returns ok, the model list and whether the model is in it, with the documented fields', async () => {
  const upstream = createFakeUpstream()
  const r = await probe({}, upstream)
  assert.deepEqual(Object.keys(r).sort(), RESULT_KEYS)
  assert.equal(r.ok, true)
  assert.equal(r.cause, null)
  assert.equal(r.status, 200)
  assert.deepEqual(r.models, ['fake-model-a', 'fake-model-b'])
  assert.equal(r.model, 'fake-model-a')
  assert.equal(r.model_listed, true)
  assert.ok(Number.isInteger(r.duration_ms) && r.duration_ms >= 0)
  assert.ok(!Number.isNaN(Date.parse(r.checked_at)))
  assert.deepEqual(upstream.requests.map((q) => `${q.method} ${q.url}`), [`POST ${BASE}/chat/completions`, `GET ${BASE}/models`])
})

test('a model the list does not contain is reported as model_listed false while the call itself worked', async () => {
  const r = await probe({ model: 'something-else' })
  assert.equal(r.ok, true)
  assert.equal(r.model_listed, false)
})

test('without a model only the list of models is requested, and model_listed is null', async () => {
  const upstream = createFakeUpstream()
  const r = await probe({ model: undefined }, upstream)
  assert.equal(r.ok, true)
  assert.equal(r.model, null)
  assert.equal(r.model_listed, null)
  assert.deepEqual(upstream.requests.map((q) => q.method), ['GET'])
})

test('anthropic uses its messages and models endpoints and the key travels in x-api-key', async () => {
  const seen = []
  const upstream = createFakeUpstream()
  const fetchImpl = (url, init) => { seen.push({ url: String(url), headers: new Headers(init.headers) }); return upstream.fetchImpl(url, init) }
  const r = await probeConnection({ kind: 'anthropic', apiKey: 'sk-ant-plain-1234', model: 'fake-model-a', timeoutMs: 5000, fetchImpl })
  assert.equal(r.ok, true)
  assert.match(seen[0].url, /^https:\/\/api\.anthropic\.com\/v1\/messages$/)
  assert.match(seen[1].url, /\/v1\/models\?limit=\d+$/)
  assert.equal(seen[0].headers.get('x-api-key'), 'sk-ant-plain-1234')
  assert.ok(seen[0].headers.get('anthropic-version'))
  assert.equal(seen[0].headers.get('authorization'), null)
})

test('an openai-compatible address ending in /beta lists models one level up and tolerates trailing slashes', async () => {
  const upstream = createFakeUpstream()
  await probe({ baseUrl: 'https://api.deepseek.test/beta///' }, upstream)
  assert.deepEqual(upstream.requests.map((q) => q.url), ['https://api.deepseek.test/beta/chat/completions', 'https://api.deepseek.test/models'])
})

test('groq-speech only lists models: the key, the address and the model are proved without audio', async () => {
  const upstream = createFakeUpstream()
  const ok = await probeConnection({ kind: 'groq-speech', apiKey: 'gsk-plain-1234', model: 'fake-model-b', timeoutMs: 5000, fetchImpl: upstream.fetchImpl })
  assert.equal(ok.ok, true)
  assert.equal(ok.model_listed, true)
  assert.deepEqual(upstream.requests.map((q) => q.method), ['GET'])
  const missing = await probeConnection({ kind: 'groq-speech', apiKey: 'gsk-plain-1234', model: 'not-listed', timeoutMs: 5000, fetchImpl: upstream.fetchImpl })
  assert.equal(missing.ok, false)
  assert.equal(missing.cause, 'model_not_found')
  assert.deepEqual(missing.models, ['fake-model-a', 'fake-model-b'])
  assert.equal(missing.model_listed, false)
  const bad = await probeConnection({ kind: 'groq-speech', apiKey: 'gsk-fail-invalid_key-1', model: 'fake-model-a', timeoutMs: 5000, fetchImpl: upstream.fetchImpl })
  assert.equal(bad.cause, 'invalid_key')
})

const CAUSE_CASES = [
  ['invalid_key', 401], ['no_quota', 429], ['rate_limited', 429], ['provider_error', 503], ['bad_address', 404]
]
for (const [cause, status] of CAUSE_CASES) {
  test(`cause ${cause}: HTTP ${status} from the key text, with no model list`, async () => {
    for (const kind of ['openai-compatible', 'anthropic']) {
      const r = await probe({ kind, apiKey: `sk-fail-${cause}-0001`, baseUrl: kind === 'anthropic' ? undefined : BASE })
      assert.equal(r.ok, false, kind)
      assert.equal(r.cause, cause, kind)
      assert.equal(r.status, status, kind)
      assert.equal(r.models, null, kind)
      assert.equal(r.model_listed, null, kind)
    }
  })
}

test('cause model_not_found: the model is rejected and the list of what the provider does offer comes back', async () => {
  const r = await probe({ model: 'missing-model-x' })
  assert.equal(r.ok, false)
  assert.equal(r.cause, 'model_not_found')
  assert.equal(r.status, 404)
  assert.deepEqual(r.models, ['fake-model-a', 'fake-model-b'])
  assert.equal(r.model_listed, false)
})

test('cause no_network: a failed connection has no status', async () => {
  const r = await probe({ apiKey: 'sk-fail-no_network-0001' })
  assert.equal(r.ok, false)
  assert.equal(r.cause, 'no_network')
  assert.equal(r.status, null)
})

test('cause timeout: a request that never answers ends at the deadline', async () => {
  const started = performance.now()
  const r = await probe({ apiKey: 'sk-fail-timeout-0001', timeoutMs: 30 })
  assert.equal(r.ok, false)
  assert.equal(r.cause, 'timeout')
  assert.equal(r.status, null)
  assert.ok(performance.now() - started < 3000)
})

test('cause bad_address: an address that is not a URL fails before any request is made', async () => {
  const upstream = createFakeUpstream()
  for (const baseUrl of ['not a url', '', '://x']) {
    const r = await probe({ baseUrl }, upstream)
    assert.equal(r.ok, false)
    assert.equal(r.cause, 'bad_address')
    assert.equal(r.duration_ms, 0)
  }
  assert.equal(upstream.requests.length, 0)
})

test('cause unknown: a status outside every rule', async () => {
  const fetchImpl = async () => new Response('teapot', { status: 418 })
  const r = await probe({ fetchImpl })
  assert.equal(r.ok, false)
  assert.equal(r.cause, 'unknown')
  assert.equal(r.status, 418)
})

test('a success whose body is not JSON is still ok, with no model list', async () => {
  const fetchImpl = async () => new Response('<html>ok</html>', { status: 200 })
  const r = await probe({ fetchImpl })
  assert.equal(r.ok, true)
  assert.equal(r.models, null)
  assert.equal(r.model_listed, null)
})

test('the model list is capped and holds identifiers only', async () => {
  const fetchImpl = async (url, init) => init.method === 'POST'
    ? new Response('{}', { status: 200 })
    : new Response(JSON.stringify({ data: [...Array.from({ length: 800 }, (_, i) => ({ id: `m-${i}`, owned_by: 'secret-org' })), { id: '' }, null] }), { status: 200 })
  const r = await probe({ fetchImpl })
  assert.equal(r.models.length, 500)
  assert.ok(r.models.every((m) => /^m-\d+$/.test(m)))
})

/** An upstream whose error bodies repeat the key, as some providers do ("Incorrect API key provided: <key>"). */
function echoingUpstream (key) {
  const inner = createFakeUpstream()
  const fetchImpl = async (url, init) => {
    const response = await inner.fetchImpl(url, init)
    if (response.ok) return response
    const body = await response.json()
    const echoed = { error: { ...body.error, type: body.error.type ?? 'invalid_request_error', code: body.error.code, message: `Incorrect API key provided: ${key}. Details: ${key}` }, key_echo: key, detail: `request with ${key} failed` }
    return new Response(JSON.stringify(echoed), { status: response.status, headers: { 'content-type': 'application/json' } })
  }
  return { fetchImpl, requests: inner.requests }
}

test('the result never contains the key nor any text of the provider error body, for every cause', async () => {
  const causes = ['invalid_key', 'no_quota', 'rate_limited', 'provider_error', 'bad_address', 'no_network', 'timeout']
  for (const cause of causes) {
    for (const kind of ['openai-compatible', 'anthropic', 'groq-speech']) {
      const key = `sk-LEAK-CHECK-${cause}-fail-${cause}-ZZZ9`
      const r = await probeConnection({ kind, apiKey: key, baseUrl: kind === 'anthropic' ? undefined : BASE, model: 'fake-model-a', timeoutMs: 40, fetchImpl: echoingUpstream(key).fetchImpl })
      const text = JSON.stringify(r)
      assert.ok(!text.includes(key), `${kind} ${cause}: key in result`)
      assert.ok(!text.includes('Incorrect API key'), `${kind} ${cause}: provider text in result`)
      assert.ok(!text.includes('LEAK-CHECK'), `${kind} ${cause}`)
      assert.equal(r.cause, cause, `${kind} ${cause}`)
      assert.deepEqual(Object.keys(r).sort(), RESULT_KEYS)
    }
  }
})

test('the result of a success does not contain the key, and a thrown network error text is not returned', async () => {
  const key = 'sk-LEAK-CHECK-success-0001'
  const ok = await probe({ apiKey: key })
  assert.ok(!JSON.stringify(ok).includes(key))
  const throwing = async () => { throw new TypeError(`fetch failed for key ${key}`) }
  const failed = await probe({ apiKey: key, fetchImpl: throwing })
  assert.equal(failed.cause, 'no_network')
  assert.ok(!JSON.stringify(failed).includes(key))
})

test('a model rejected with an echoing body still returns the list but no provider text', async () => {
  const key = 'sk-LEAK-CHECK-model-0001'
  const inner = createFakeUpstream()
  const fetchImpl = async (url, init) => {
    const response = await inner.fetchImpl(url, init)
    if (response.ok) return response
    return new Response(JSON.stringify({ error: { type: 'not_found_error', code: 'model_not_found', message: `model missing-model for ${key}` } }), { status: 404 })
  }
  const r = await probe({ apiKey: key, model: 'missing-model', fetchImpl })
  assert.equal(r.cause, 'model_not_found')
  assert.ok(!JSON.stringify(r).includes(key))
  assert.ok(r.models.length > 0)
})
