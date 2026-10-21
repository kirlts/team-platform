// HP-012 (docs/TEST.md): the generated OpenAPI is valid against the official OpenAPI 3.1 schema and no operation is
// left without a response schema, neither for the happy path (2xx) nor for errors (4xx). It protects MASTER-SPEC
// section 4.11: the API is the only door and another frontend reimplements only the views from this contract.
// Validator: @readme/openapi-parser (MIT; version 9.1.0, published 2026-10-06, the most recent of the two live
// options on npm: @apidevtools/swagger-parser 13.1.0 is from 2026-09-20).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validate } from '@readme/openapi-parser'
import { routePolicies } from './identity/index.js'
import { makeEnv } from './testing/helpers.js'

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']

/** Walks the operations of an OpenAPI document: { method, path, operation }. */
function operationsOf (doc) {
  const found = []
  for (const [routePath, item] of Object.entries(doc.paths)) {
    for (const method of METHODS) if (item[method]) found.push({ method, path: routePath, operation: item[method] })
  }
  return found
}

/** Response-schema problems of one operation; empty when it complies. */
function responseProblems ({ method, path, operation }) {
  const problems = []
  const label = `${method.toUpperCase()} ${path}`
  const entries = Object.entries(operation.responses ?? {})
  const successes = entries.filter(([code]) => /^2(\d\d|XX)$/i.test(code))
  const failures = entries.filter(([code]) => /^4(\d\d|XX)$/i.test(code))
  if (successes.length === 0) problems.push(`${label}: no 2xx response`)
  if (failures.length === 0) problems.push(`${label}: no 4xx response`)
  const hasSchema = (response) => Object.values(response.content ?? {}).some((media) => media.schema && Object.keys(media.schema).length > 0)
  for (const [code, response] of successes) {
    // A 204 has no body: the declared response is required, not a schema.
    if (code !== '204' && !hasSchema(response)) problems.push(`${label}: response ${code} declares no schema`)
  }
  for (const [code, response] of failures) {
    if (!hasSchema(response)) problems.push(`${label}: response ${code} declares no schema`)
  }
  return problems
}

async function generatedDocument ({ withRoutes = false } = {}) {
  const env = await makeEnv()
  try {
    const res = await env.app.inject({ url: '/api/openapi.json' })
    assert.equal(res.statusCode, 200)
    return withRoutes ? { doc: res.json(), routes: routePolicies.get(env.app) } : res.json()
  } finally {
    await env.close()
  }
}

test('HP-012: the document at GET /api/openapi.json is valid OpenAPI 3.1 (section 4.11)', async () => {
  const doc = await generatedDocument()
  assert.equal(doc.openapi, '3.1.0')
  const result = await validate(structuredClone(doc)) // the validator resolves references in place: give it a copy
  assert.equal(result.valid, true, JSON.stringify(result.errors ?? result))
  assert.deepEqual(result.warnings ?? [], [])
})

test('HP-012: every route registered in the API appears in the contract', async () => {
  const { doc, routes } = await generatedDocument({ withRoutes: true })
  const documented = new Set(operationsOf(doc).map((o) => `${o.method.toUpperCase()} ${o.path.replace(/\{(\w+)\}/g, ':$1')}`))
  // The contract does not describe itself, and the root /health is the same probe as /api/health.
  const checked = routes
    .filter((r) => !['HEAD', 'OPTIONS'].includes(r.method) && r.url.startsWith('/api/') && r.url !== '/api/openapi.json')
    .map((r) => `${r.method} ${r.url}`)
  assert.ok(checked.length > 0)
  assert.deepEqual(checked.filter((route) => !documented.has(route)), [])
})

test('HP-012: every operation has a response schema for 2xx and for 4xx (section 4.11)', async () => {
  const doc = await generatedDocument()
  const problems = operationsOf(doc).flatMap(responseProblems)
  assert.deepEqual(problems, [])
})

test('HP-012: the validator rejects a broken document and the response rule sees an operation without schema', async () => {
  const doc = await generatedDocument()
  // Prohibition of the prohibition: if the validator accepted anything, the tests above would prove nothing.
  const broken = structuredClone(doc)
  delete broken.info // `info` is mandatory in every OpenAPI document
  const verdict = await validate(broken).then((r) => r.valid, () => false)
  assert.equal(verdict, false)
  const bare = { method: 'get', path: '/x', operation: { responses: { 200: { description: 'no schema' } } } }
  assert.equal(responseProblems(bare).length, 2) // the 200 without schema and the missing 4xx
})
