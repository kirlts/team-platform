// H-83: the default caps of the provider limiter come from a measurement, not from a guess. The line of the default
// cites the file of the measurement, the file exists and it states the value chosen for each knob.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { loadConfig } from '../config.js'
import { limitsFromEnv } from './index.js'
import { PROVIDER_LIMIT_DEFAULTS } from './limiter.js'

const MEASUREMENT = 'docs/investigaciones/mediciones/2026-10-21-concurrencia-de-la-cola.md'
const root = new URL('../../', import.meta.url)
const measurement = () => readFileSync(new URL(MEASUREMENT, root), 'utf8')

test('the defaults of the limiter cite the measurement and the measurement states each value', () => {
  const source = readFileSync(new URL('src/providers/limiter.js', root), 'utf8')
  assert.ok(source.includes(MEASUREMENT), 'src/providers/limiter.js must cite the measurement file')
  assert.ok(existsSync(new URL(MEASUREMENT, root)), 'the measurement file must exist')
  const knobs = { anthropic: 'PROVIDER_MAX_INFLIGHT_ANTHROPIC', groq: 'PROVIDER_MAX_INFLIGHT_GROQ', openaiCompatible: 'PROVIDER_MAX_INFLIGHT_OPENAI_COMPATIBLE' }
  for (const [key, name] of Object.entries(knobs)) {
    assert.ok(PROVIDER_LIMIT_DEFAULTS[key] > 0, `${name}: a cap of 0 would turn the limiter off by default`)
    assert.match(measurement(), new RegExp(`${name}\\W+${PROVIDER_LIMIT_DEFAULTS[key]}\\b`), `the measurement must state ${name} = ${PROVIDER_LIMIT_DEFAULTS[key]}`)
  }
  for (const [key, name] of [['cooldownMs', 'PROVIDER_BACKOFF_COOLDOWN_MS'], ['restoreStepMs', 'PROVIDER_BACKOFF_RESTORE_STEP_MS']]) {
    assert.match(measurement(), new RegExp(`${name}\\W+${PROVIDER_LIMIT_DEFAULTS[key]}\\b`), `the measurement must state ${name} = ${PROVIDER_LIMIT_DEFAULTS[key]}`)
  }
})

test('config.js and createProviders read the same knobs, with the same defaults, and reject a bad value', () => {
  const config = loadConfig({ DATA_DIR: '/tmp/x' })
  assert.deepEqual(config.providers.maxInflight, { anthropic: PROVIDER_LIMIT_DEFAULTS.anthropic, groq: PROVIDER_LIMIT_DEFAULTS.groq, openaiCompatible: PROVIDER_LIMIT_DEFAULTS.openaiCompatible })
  const env = { DATA_DIR: '/tmp/x', PROVIDER_MAX_INFLIGHT_ANTHROPIC: '3', PROVIDER_MAX_INFLIGHT_GROQ: '0', PROVIDER_MAX_INFLIGHT_OPENAI_COMPATIBLE: '2' }
  assert.deepEqual(loadConfig(env).providers.maxInflight, { anthropic: 3, groq: 0, openaiCompatible: 2 })
  assert.deepEqual(limitsFromEnv(env), { anthropic: 3, groq: 0, openaiCompatible: 2, cooldownMs: PROVIDER_LIMIT_DEFAULTS.cooldownMs, restoreStepMs: PROVIDER_LIMIT_DEFAULTS.restoreStepMs })
  assert.throws(() => loadConfig({ DATA_DIR: '/tmp/x', PROVIDER_MAX_INFLIGHT_ANTHROPIC: '-1' }), /PROVIDER_MAX_INFLIGHT_ANTHROPIC/)
  assert.throws(() => limitsFromEnv({ PROVIDER_MAX_INFLIGHT_GROQ: 'x' }), /PROVIDER_MAX_INFLIGHT_GROQ/)
})
