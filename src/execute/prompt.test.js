import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildExecuteParts, buildExecutePrompt, finalSchema } from './prompt.js'
import Ajv from 'ajv'
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

describe('a forwarded message in the prompt and the schema (UD-272)', () => {
  const declared = { type: 'object', additionalProperties: false, required: ['outcome'], properties: { outcome: { type: 'string' } } }
  const forward = { by: 'Martín', reason: 'Investiga y recomiéndame.' }
  it('the forward is a block after the message and before the job; without it nothing of the variable part changes', () => {
    const plain = buildExecuteParts(input(1))
    const sent = buildExecuteParts(input(1, { forward }))
    assert.equal(plain.stable, sent.stable, 'the instructions are the same for every job: the cache is not broken')
    assert.match(sent.variable, /<message>[\s\S]*<\/message>\n\n<forwarded>\nforwarded by: Martín\n\nreason:\nInvestiga y recomiéndame\.\n<\/forwarded>\n\n<job>/)
    assert.ok(!plain.variable.includes('<forwarded>'))
  })
  it('the stable part says that the session chooses `mode`, that investigate changes and delivers nothing, and where the PDF goes', () => {
    const { stable } = buildExecuteParts(input(1))
    assert.match(stable, /`mode` of your final output: `resolve`[^.]*`investigate`/)
    assert.match(stable, /With `mode` `investigate` you change no code, create no branch and push nothing: the system delivers nothing and does not close the message/)
    assert.match(stable, /what you found, a concrete recommendation, and the alternatives you discarded/)
    assert.match(stable, /\$TEAM_ATTACHMENTS_DIR[^.]*`attachments`/)
  })
  it('needs_decision arrives with the investigation: analysis, a concrete recommendation and the alternatives discarded', () => {
    const { stable } = buildExecuteParts(input(1))
    assert.match(stable, /it arrives with your analysis: before you end with `needs_decision`, take the investigation as far as it goes without deciding/)
    assert.match(stable, /your concrete recommendation and the alternatives you discarded, each with why/)
    assert.ok(!stable.includes('cut down to their part; `needs_decision`'), 'the old instruction is gone')
  })
  it('`mode` and `attachments` are in the grammar only when the job is forwarded; the validation always accepts them and rejects a mode that does not exist', () => {
    assert.equal(finalSchema(declared).properties.mode, undefined)
    assert.equal(finalSchema(declared).properties.attachments, undefined)
    const grammar = finalSchema(declared, { forwarded: true })
    assert.deepEqual(grammar.properties.mode.enum, ['resolve', 'investigate'])
    assert.deepEqual(grammar.properties.attachments.items.required, ['path', 'name'])
    assert.ok(!grammar.required.includes('mode'), 'optional: a forward may ask for the work to be done')
    assert.deepEqual(finalSchema(declared, { validation: true }).properties.mode.enum, ['resolve', 'investigate'])
    const check = new Ajv({ strict: false }).compile(finalSchema(declared, { validation: true }))
    assert.equal(check({ outcome: 'done', summary: 'x', mode: 'investigate', attachments: [{ path: 'a.pdf', name: 'A' }] }), true)
    assert.equal(check({ outcome: 'done', summary: 'x', mode: 'decide' }), false)
    assert.deepEqual(Object.keys(finalSchema(null, { forwarded: true }).properties).sort(), ['approved', 'approved_reply', 'attachments', 'captures', 'close', 'close_reason', 'mode', 'summary'])
  })
})
