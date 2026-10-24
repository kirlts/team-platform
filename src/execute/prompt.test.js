import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildExecuteParts, buildExecutePrompt, finalSchema } from './prompt.js'
import { loadConfig, otelPairs } from '../config.js'

const input = (n, extra = {}) => ({
  message: { id: n, title: `título ${n}`, body: `cuerpo ${n}`, fields: { a: n }, area: 'Errores', status: 'open' },
  template: { body_markdown: '# Plantilla\nCampos' },
  author: { name: `Autor ${n}`, profile: `Perfil ${n}`, language: n % 2 ? 'es-419' : 'en' },
  agent: { name: 'Claude', profile: 'Perfil del agente' }, project: { name: 'P', description: 'Descripción' },
  jobId: 100 + n, maxSubagents: 3, branch: `tp/${n}`, hostInstructions: 'Reglas del anfitrión', deliver: true, ...extra
})

describe('execute prompt order (docs/investigaciones/mediciones/2026-10-23-tokens-y-cache.md)', () => {
  it('two jobs share everything up to the sender; ids, branch, names and language come after', () => {
    const a = buildExecuteParts(input(1))
    const b = buildExecuteParts(input(2))
    assert.equal(a.stable, b.stable)
    for (const volatile of ['tp/1', 'Autor 1', 'título 1', 'job id: 101']) assert.ok(!a.stable.includes(volatile), volatile)
    assert.match(a.variable, /^<sender>/)
    assert.equal(buildExecutePrompt(input(1)), `${a.stable}\n\n${a.variable}`)
    assert.ok(a.stable.indexOf('<template>') > a.stable.indexOf('## Delivery'), 'the template closes the stable part')
  })

  it('a second pass after a failed delivery changes only the variable part', () => {
    const plain = buildExecuteParts(input(1))
    const second = buildExecuteParts(input(1, { deliverFailure: { output: 'FAIL' } }))
    assert.equal(plain.stable, second.stable)
    assert.match(second.variable, /pass: second/)
  })
})

describe('execute session configuration (docs/investigaciones/mediciones/2026-10-23-tokens-y-cache.md)', () => {
  it('EXECUTE_SESSION_ENV and EXECUTE_STABLE_AS_SYSTEM', () => {
    const d = loadConfig({ DATA_DIR: '/tmp/x' }).execute
    assert.deepEqual([d.sessionEnv, d.stableAsSystem], [{}, false])
    const c = loadConfig({ DATA_DIR: '/tmp/x', EXECUTE_SESSION_ENV: 'CLAUDE_CODE_PROMPT_CACHE_TTL=1h CLAUDE_CODE_DISABLE_CLAUDE_MDS=1', EXECUTE_STABLE_AS_SYSTEM: '1' }).execute
    assert.deepEqual(c.sessionEnv, { CLAUDE_CODE_PROMPT_CACHE_TTL: '1h', CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1' })
    assert.equal(c.stableAsSystem, true)
    assert.throws(() => otelPairs('TEAM_X=1', 'EXECUTE_SESSION_ENV'), /EXECUTE_SESSION_ENV/)
  })
})

describe('handoff contract in the prompt and the schema (UD-269)', () => {
  const declared = { type: 'object', additionalProperties: false, required: ['outcome'], properties: { outcome: { type: 'string' } } }
  it('the stable part asks to look first, end in not_mine without a first reply, and check five things before handing over', () => {
    const { stable } = buildExecuteParts(input(1))
    assert.match(stable, /Examine the situation first, changing nothing[^.]*before you read any code\. If the request is not yours/)
    assert.match(stable, /`not_mine`[^.]*send no reply/)
    assert.match(stable, /check in order: 1\) is the decision already recorded[\s\S]*5\) is a wrong guess cheap and reversible\?/)
    assert.match(stable, /`needs_decision` requires `decision_check`/)
  })
  it('the first reply comes after the look and carries the screenshot; the closing output asks for the «after» (UD-268)', () => {
    const { stable } = buildExecuteParts(input(1))
    assert.match(stable, /send the first reply after that look, not before/)
    assert.match(stable, /goes in this same reply with `--captures`/)
    assert.match(stable, /list it in `captures` \(the «after»\)/)
    assert.ok(!/Recibido/.test(stable), 'the example does not teach an acknowledgement sent before looking')
    assert.ok(stable.indexOf('Examine the situation first') < stable.indexOf('Rules of the host'), 'the order of the replies is declared before the rules of the host')
  })
  it('decision_check is optional in the grammar and demands a source in the validation schema', () => {
    const grammar = finalSchema(declared)
    assert.ok(!grammar.required.includes('decision_check'))
    assert.deepEqual(grammar.properties.decision_check.required, ['searched', 'why_not_covered', 'recommendation', 'if_wrong', 'question'])
    assert.equal(grammar.properties.decision_check.properties.searched.minItems, undefined)
    assert.equal(finalSchema(declared, { validation: true }).properties.decision_check.properties.searched.minItems, 1)
  })
})
