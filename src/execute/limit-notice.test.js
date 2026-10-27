// The warning of a limit of a person (third audit of the method, H-1): the form is checked like `decision_check`, the reply shows the same lines in both ways an instance holds a limit,
// and a limit is lifted only after its warning was shown.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { LIMIT_NOTICE_FIELDS, limitNoticeLines, limitNoticeProblem, limitNoticeSchema } from './limit-notice.js'
import { heldBody } from './deliver.js'

const NOTICE = { consequence: 'Se cobra un monto equivocado.', alternative: 'Dejar el cambio en la rama.' }

describe('the form of the warning', () => {
  it('is owed only while a limit of a person is open, and then both fields must be there and not empty', () => {
    assert.equal(limitNoticeProblem(undefined, false), null)
    assert.match(limitNoticeProblem(undefined, true), /exige limit_notice/)
    assert.match(limitNoticeProblem({ consequence: 'x' }, true), /limit_notice\.alternative está vacío/)
    assert.match(limitNoticeProblem({ consequence: '  ', alternative: 'y' }, true), /limit_notice\.consequence está vacío/)
    assert.equal(limitNoticeProblem(NOTICE, true), null)
  })
  it('the schema requires the two fields, and asks for a minimum length only in the validation', () => {
    assert.deepEqual(limitNoticeSchema().required, LIMIT_NOTICE_FIELDS)
    assert.equal(limitNoticeSchema().properties.consequence.minLength, undefined)
    assert.equal(limitNoticeSchema({ validation: true }).properties.alternative.minLength, 1)
  })
})

describe('what the person reads', () => {
  it('is the risk, the alternative and who lifts the limit, in the language of the author', () => {
    assert.deepEqual(limitNoticeLines(NOTICE, 'es-419'), ['Riesgo si se cruza: Se cobra un monto equivocado.', 'Alternativa que no lo cruza: Dejar el cambio en la rama.', 'Quien apruebe levanta el límite y queda registrado.'])
    assert.match(limitNoticeLines(NOTICE, 'en')[0], /^Risk if it is crossed/)
    assert.deepEqual(limitNoticeLines(undefined, 'es-419'), [])
  })
  it('the held reply of the delivery job carries the same lines as the one without a delivery job', () => {
    const body = heldBody({ output: { summary: 'Listo.', limit_notice: NOTICE }, reason: 'toca un límite', language: 'es-419' })
    for (const line of limitNoticeLines(NOTICE, 'es-419')) assert.ok(body.includes(line), line)
  })
})
