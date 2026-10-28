// H-44: a person never reads a sentence written by the server. Every code the server can send has a line in
// both panel catalogs: `error.<code>` for a request that fails, `analysis.error.<code>` for an input whose job
// failed. Adding a code without its two translations fails here, so the panel cannot fall back to the
// server's message in the wrong language.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('.', import.meta.url))
const PANEL = join(SRC, '..', 'panel', 'src', 'i18n')

function sources (dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'testing' || name === 'test' ? [] : sources(path)
    return name.endsWith('.js') && !name.endsWith('.test.js') && !name.endsWith('.bench.mjs') ? [path] : []
  })
}

const text = sources(SRC).map((p) => readFileSync(p, 'utf8')).join('\n')
const grab = (re) => new Set([...text.matchAll(re)].map((m) => m[1]))

// Codes a request can fail with: the domain helpers, the upload helpers and the generic handlers.
const requestCodes = new Set([
  ...grab(/\b(?:badRequest|forbidden|conflict|unprocessable)\((?:[^()]|\([^()]*\))*?,\s*'([a-z_]+)'/g),
  ...grab(/\bemptyCode: '([a-z_]+)'/g),
  ...grab(/\.send\(\{ code: '([a-z_]+)'/g),
  ...grab(/invalidCredentials = .*new AppError\(401, '([a-z_]+)'/g),
])

// Codes a job can fail with: `permanent` and `infra`, the extractors, the providers and the analyzers.
const jobCodes = new Set([
  ...grab(/\b(?:permanent|infra)\((?:[^()]|\([^()]*\))*?,\s*'([a-z_]+)'/g),
  ...grab(/new ExtractError\(\s*'([a-z_0-9]+)'/g),
  ...grab(/this\.code = '([a-z_]+)'/g),
])
// A cancellation is not a failure a person reads.
jobCodes.delete('aborted')

function keysOf (file) {
  const source = readFileSync(join(PANEL, file), 'utf8')
  return new Set([...source.matchAll(/^\s*'([a-z_.0-9]+)':/gm)].map((m) => m[1]))
}

test('the scan finds the codes it is supposed to find', () => {
  for (const code of ['provider_invalid', 'email_taken', 'input_empty', 'reply_empty']) assert.ok(requestCodes.has(code), code)
  for (const code of ['document_too_large', 'attachment_missing', 'timeout', 'refusal']) assert.ok(jobCodes.has(code), code)
  assert.ok(requestCodes.size >= 40 && jobCodes.size >= 35, `${requestCodes.size} request codes, ${jobCodes.size} job codes`)
})

for (const file of ['es-419.ts', 'en.ts']) {
  test(`${file}: every request code and every job code has its line`, () => {
    const keys = keysOf(file)
    const missingRequest = [...requestCodes].filter((c) => !keys.has(`error.${c}`)).sort()
    const missingJob = [...jobCodes].filter((c) => !keys.has(`analysis.error.${c}`)).sort()
    assert.deepEqual(missingRequest, [], `missing error.<code>: ${missingRequest.join(', ')}`)
    assert.deepEqual(missingJob, [], `missing analysis.error.<code>: ${missingJob.join(', ')}`)
  })
}
