// HP-012 (docs/TEST.md): el OpenAPI generado es válido contra el esquema oficial de OpenAPI 3.1 y ninguna
// operación queda sin esquema de respuesta, ni para el caso feliz (2xx) ni para el error (4xx). Protege MASTER-SPEC
// §4.11: la API es la única puerta y otro frontend la reimplementa sólo desde este contrato.
// El validador es @readme/openapi-parser (MIT; versión 9.1.0, publicada el 2026-10-06, la más reciente de las dos
// opciones vivas en npm: @apidevtools/swagger-parser 13.1.0 es del 2026-09-20).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validate } from '@readme/openapi-parser'
import { routePolicies } from './identity/index.js'
import { makeEnv } from './testing/helpers.js'

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']

/** Recorre las operaciones de un documento OpenAPI: { method, path, operation }. */
function operationsOf (doc) {
  const found = []
  for (const [routePath, item] of Object.entries(doc.paths)) {
    for (const method of METHODS) if (item[method]) found.push({ method, path: routePath, operation: item[method] })
  }
  return found
}

/** Problemas de esquema de respuesta de una operación; vacío si cumple. */
function responseProblems ({ method, path, operation }) {
  const problems = []
  const label = `${method.toUpperCase()} ${path}`
  const entries = Object.entries(operation.responses ?? {})
  const successes = entries.filter(([code]) => /^2(\d\d|XX)$/i.test(code))
  const failures = entries.filter(([code]) => /^4(\d\d|XX)$/i.test(code))
  if (successes.length === 0) problems.push(`${label}: sin respuesta 2xx`)
  if (failures.length === 0) problems.push(`${label}: sin respuesta 4xx`)
  const hasSchema = (response) => Object.values(response.content ?? {}).some((media) => media.schema && Object.keys(media.schema).length > 0)
  for (const [code, response] of successes) {
    // Un 204 no lleva cuerpo: se exige la respuesta declarada, no un esquema.
    if (code !== '204' && !hasSchema(response)) problems.push(`${label}: la respuesta ${code} no declara esquema`)
  }
  for (const [code, response] of failures) {
    if (!hasSchema(response)) problems.push(`${label}: la respuesta ${code} no declara esquema`)
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

test('HP-012 · el documento de GET /api/openapi.json es OpenAPI 3.1 válido (§4.11)', async () => {
  const doc = await generatedDocument()
  assert.equal(doc.openapi, '3.1.0')
  const result = await validate(structuredClone(doc)) // el validador resuelve referencias in situ: se le pasa una copia
  assert.equal(result.valid, true, JSON.stringify(result.errors ?? result))
  assert.deepEqual(result.warnings ?? [], [])
})

test('HP-012 · cada ruta registrada en la API aparece en el contrato', async () => {
  const { doc, routes } = await generatedDocument({ withRoutes: true })
  const documented = new Set(operationsOf(doc).map((o) => `${o.method.toUpperCase()} ${o.path.replace(/\{(\w+)\}/g, ':$1')}`))
  // El contrato no se describe a sí mismo y /health de la raíz es el mismo sondeo que /api/health.
  const checked = routes
    .filter((r) => !['HEAD', 'OPTIONS'].includes(r.method) && r.url.startsWith('/api/') && r.url !== '/api/openapi.json')
    .map((r) => `${r.method} ${r.url}`)
  assert.ok(checked.length > 0)
  assert.deepEqual(checked.filter((route) => !documented.has(route)), [])
})

test('HP-012 · toda operación tiene esquema de respuesta para 2xx y para 4xx (§4.11)', async () => {
  const doc = await generatedDocument()
  const problems = operationsOf(doc).flatMap(responseProblems)
  assert.deepEqual(problems, [])
})

test('HP-012 · el validador rechaza un documento roto y la regla de respuestas ve una operación sin esquema', async () => {
  const doc = await generatedDocument()
  // Prohibición de la prohibición: si el validador aceptara cualquier cosa, la prueba de arriba no probaría nada.
  const broken = structuredClone(doc)
  delete broken.info // `info` es obligatorio en todo documento OpenAPI
  const verdict = await validate(broken).then((r) => r.valid, () => false)
  assert.equal(verdict, false)
  const bare = { method: 'get', path: '/x', operation: { responses: { 200: { description: 'sin esquema' } } } }
  assert.equal(responseProblems(bare).length, 2) // el 200 sin esquema y la ausencia de un 4xx
})
