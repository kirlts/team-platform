// The job judge (UD-295): the anchors of each level reach it, its evidence includes the description of the area and of the project, and its answer is validated before it is a judgement:
// every KPI once, every quote a piece of the evidence it was given, and a KPI whose evidence the job does not carry is never scored (audit of the distribution method, 2026-10-26).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { KPIS, LEVEL_SCORES, axisScores, buildJudgePrompt, judgeBlocks, judgeEvidence, runJudge, validateJudgment } from './judge.js'

const job = (over = {}) => ({
  message: { title: 'Cambiar el rótulo', body: 'El botón dice Enviar y debe decir Guardar.' },
  expectation: 'Cambiar el texto del botón.',
  guards: [{ id: 2, text: 'Nada toca pagos', mechanism: 'credencial de solo lectura' }],
  output: { summary: 'Cambié el rótulo del botón.\n\nYa dice Guardar.' },
  detail: [['archivos', 'panel/src/i18n/es-419.ts']],
  captures: [{ alt: 'Antes y después del botón' }],
  stats: { modelo: 'claude-haiku-5-5', turnos: 4 },
  area: { title: 'Interfaz', description: 'Pantallas del panel y sus textos.' },
  project: { name: 'Agenda', description: 'Agenda de clínicas.' },
  ...over
})

const answer = (evidence, over = {}) => ({
  quadrant: 'execute',
  kpis: KPIS.map((k) => ({ id: k.id, applies: k.id === '2.1', score: k.id === '2.1' ? 1 : 0, quote: k.id === '2.1' ? 'Ya dice Guardar.' : '', claim: 'c', reasoning: 'r' })),
  summary: 'Adecuado.',
  ...over
})

describe('the anchors of the levels', () => {
  it('every KPI carries five anchors in the order of the scale, none empty', () => {
    assert.deepEqual([...LEVEL_SCORES], [2, 1, 0, -1, -2])
    assert.equal(KPIS.length, 12)
    for (const k of KPIS) {
      assert.equal(k.levels.length, 5, k.id)
      assert.ok(k.levels.every((l) => typeof l === 'string' && l.trim().length > 20), k.id)
      assert.equal(new Set(k.levels).size, 5, `${k.id}: the five anchors differ`)
    }
  })

  it('the prompt lists each KPI with its five levels, from +2 to -2', () => {
    const prompt = buildJudgePrompt(job())
    for (const k of KPIS) {
      assert.ok(prompt.includes(`- ${k.id} ${k.name}: ${k.asks}`), k.id)
      const block = prompt.slice(prompt.indexOf(`- ${k.id} `))
      const positions = k.levels.map((text) => block.indexOf(text))
      assert.ok(positions.every((p) => p >= 0) && positions.every((p, i) => i === 0 || p > positions[i - 1]), `${k.id}: levels in order`)
    }
    assert.match(prompt, /\n {4}\+2: /)
    assert.match(prompt, /\n {4}-2: /)
  })

  it('3.2, 4.2 and 4.3 say what they measure in an unattended job', () => {
    const by = Object.fromEntries(KPIS.map((k) => [k.id, k]))
    assert.equal(by['3.2'].name, 'Comprensibilidad del resultado')
    assert.match(by['4.2'].asks, /no hay transcripción/)
    assert.deepEqual(by['4.3'].requires, ['primera_propuesta'])
    assert.ok(KPIS.filter((k) => k.requires).length === 1, 'only 4.3 needs evidence the platform does not hand over yet')
  })
})

describe('the evidence', () => {
  it('includes the description of the area and of the project, delimited as data', () => {
    const prompt = buildJudgePrompt(job())
    assert.match(prompt, /<descripcion_del_area>\nInterfaz\nPantallas del panel y sus textos\.\n<\/descripcion_del_area>/)
    assert.match(prompt, /<descripcion_del_proyecto>\nAgenda\nAgenda de clínicas\.\n<\/descripcion_del_proyecto>/)
    assert.ok(prompt.indexOf('Lo que sigue es evidencia') < prompt.indexOf('<descripcion_del_area>'))
  })

  it('knows which blocks hold something and leaves the rubric out of what a quote is checked against', () => {
    const e = judgeEvidence(job())
    assert.ok(e.present.includes('descripcion_del_area') && e.present.includes('respuesta_final'))
    assert.ok(!e.present.includes('primera_propuesta'), 'nothing hands over a first proposal')
    assert.ok(!e.text.includes(KPIS[0].levels[0]), 'an anchor is not evidence')
    assert.ok(e.text.includes('Ya dice Guardar.'))
    assert.ok(judgeEvidence(job({ firstProposal: 'Primera versión del cambio.' })).present.includes('primera_propuesta'))
    assert.equal(judgeBlocks(job({ area: null, project: null })).filter(([t]) => t.startsWith('descripcion')).every(([, text]) => text === ''), true)
  })
})

describe('the profile of who asked (third audit, H-8)', () => {
  it('reaches the judge as evidence a quote may come from, and is an empty block when the person wrote none', () => {
    const author = { name: 'Ana', profile: 'Soy médica: leo resultados, no código.' }
    assert.equal(judgeBlocks(job({ author })).find(([t]) => t === 'perfil_de_quien_pidio')[1], 'Ana\nSoy médica: leo resultados, no código.')
    assert.match(buildJudgePrompt(job({ author })), /<perfil_de_quien_pidio>\nAna\nSoy médica/)
    assert.ok(judgeEvidence(job({ author })).present.includes('perfil_de_quien_pidio'))
    assert.ok(judgeEvidence(job({ author })).text.includes('leo resultados'))
    assert.equal(judgeBlocks(job({ author: { name: 'Ana', profile: '' } })).find(([t]) => t === 'perfil_de_quien_pidio')[1], '')
    assert.ok(!judgeEvidence(job()).present.includes('perfil_de_quien_pidio'))
  })
})

describe('the idea of the request', () => {
  it('reaches the judge as context when the analyzer judged it, and is an empty block when nobody did (UD-307)', () => {
    const idea = { idea: 0.9, idea_guard: true, idea_reason: 'lo dijo como una posibilidad' }
    const block = (input) => judgeBlocks(input).find(([title]) => title === 'idea_del_pedido')[1]
    assert.equal(block(job({ idea })), 'idea: 0.90 de 1\nel límite de la idea aplica: sí\nrazón: lo dijo como una posibilidad')
    assert.equal(block(job({ idea: { idea: null, idea_guard: false } })), 'idea: sin dato\nel límite de la idea aplica: no')
    assert.equal(block(job()), '')
    assert.equal(block(job({ idea: { understand_vs_create: 0.2 } })), '', 'an assessment from before the Guard says nothing about it')
    assert.match(buildJudgePrompt(job({ idea })), /<idea_del_pedido>\nidea: 0\.90 de 1/)
    assert.deepEqual(judgeEvidence(job({ idea })).present.includes('idea_del_pedido'), true)
  })
})

describe('the validation of the answer', () => {
  const evidence = judgeEvidence(job())

  it('accepts one entry per KPI with the quote in the evidence, whitespace aside', () => {
    const out = answer(evidence)
    out.kpis.find((k) => k.id === '2.1').quote = 'Ya   dice\nGuardar.'
    const v = validateJudgment(out, evidence)
    assert.equal(v.ok, true)
    assert.equal(v.kpis.length, 12)
  })

  it('refuses a repeated id, a missing one and an unknown one, naming them', () => {
    const dup = answer(evidence)
    dup.kpis.push({ ...dup.kpis[0] })
    assert.match(validateJudgment(dup, evidence).reason, /duplicate_id: 1\.1/)
    const short = answer(evidence)
    short.kpis = short.kpis.filter((k) => k.id !== '3.3' && k.id !== '1.3')
    assert.match(validateJudgment(short, evidence).reason, /missing_ids: 1\.3, 3\.3/)
    const unknown = answer(evidence)
    unknown.kpis[0].id = '9.9'
    const v = validateJudgment(unknown, evidence)
    assert.equal(v.ok, false)
    assert.match(v.reason, /unknown_id: 9\.9/)
  })

  it('refuses a quote that is not in the evidence, an empty one on a KPI that applies, and one taken from the rubric', () => {
    const invented = answer(evidence)
    invented.kpis.find((k) => k.id === '2.1').quote = 'Una cita inventada'
    assert.match(validateJudgment(invented, evidence).reason, /quote_not_in_evidence: 2\.1/)
    const empty = answer(evidence)
    empty.kpis.find((k) => k.id === '2.1').quote = '  '
    assert.match(validateJudgment(empty, evidence).reason, /quote_missing: 2\.1/)
    const rubric = answer(evidence)
    rubric.kpis.find((k) => k.id === '2.1').quote = KPIS[0].levels[0]
    assert.match(validateJudgment(rubric, evidence).reason, /quote_not_in_evidence/)
  })

  it('does not ask a quote of a KPI that does not apply, and refuses a score out of range or a bad quadrant', () => {
    assert.equal(validateJudgment(answer(evidence), evidence).ok, true)
    const range = answer(evidence)
    range.kpis[0].score = 3
    assert.match(validateJudgment(range, evidence).reason, /shape: 1\.1/)
    assert.match(validateJudgment(answer(evidence, { quadrant: 'otro' }), evidence).reason, /quadrant/)
    assert.equal(validateJudgment(null, evidence).ok, false)
    assert.equal(validateJudgment({ quadrant: 'execute', kpis: 'x' }, evidence).ok, false)
  })

  it('a KPI whose required evidence is empty is never scored, whatever the model said', () => {
    const out = answer(evidence)
    Object.assign(out.kpis.find((k) => k.id === '4.3'), { applies: true, score: 2, quote: 'Ya dice Guardar.' })
    const v = validateJudgment(out, evidence)
    assert.equal(v.ok, true)
    assert.deepEqual(v.kpis.find((k) => k.id === '4.3'), { id: '4.3', applies: false, score: 0, quote: '', claim: 'c', reasoning: 'r' })
    const withProposal = judgeEvidence(job({ firstProposal: 'Primera versión: cambiaba el texto en un solo lugar.' }))
    const kept = validateJudgment(out, withProposal)
    assert.equal(kept.kpis.find((k) => k.id === '4.3').applies, true, 'with the first proposal as evidence it is scored')
  })

  it('reports at most a few problems and counts the rest', () => {
    const out = answer(evidence)
    out.kpis = out.kpis.map((k) => ({ ...k, applies: true, quote: 'nada de esto' }))
    const v = validateJudgment(out, evidence)
    assert.equal(v.ok, false)
    assert.match(v.reason, /; and \d+ more$/)
  })
})

describe('runJudge', () => {
  const provider = (json) => ({ text: { name: 'fake', model: 'claude-haiku-5-5', complete: async () => ({ json, usage: { input_tokens: 10, output_tokens: 10 }, provider: 'fake', model: 'claude-haiku-5-5' }) } })
  const evidence = judgeEvidence(job())
  const prompt = buildJudgePrompt(job())

  it('returns the judgement when the answer validates, with the axes against the quadrant', async () => {
    const j = await runJudge({ providers: provider(answer(evidence)), prompt, evidence })
    assert.equal(j.rejected, undefined)
    assert.equal(j.quadrant, 'execute')
    assert.equal(j.kpis.length, 12)
    assert.deepEqual(j.axes.map((a) => [a.axis, a.score, a.kpis]), [[1, null, 0], [2, 1, 1], [3, null, 0], [4, null, 0]])
  })

  it('returns the reason and the cost when the answer does not validate, and gives no judgement to save', async () => {
    const bad = answer(evidence)
    bad.kpis.find((k) => k.id === '2.1').quote = 'Una cita inventada'
    const j = await runJudge({ providers: provider(bad), prompt, evidence })
    assert.match(j.rejected, /quote_not_in_evidence: 2\.1/)
    assert.equal(j.model, 'claude-haiku-5-5')
    assert.equal(j.kpis, undefined)
    assert.ok('cost' in j, 'the cost travels with the rejection, null when the provider has no price')
  })

  it('without the evidence nothing can be quoted: an answer that quotes is rejected, never accepted blind', async () => {
    const j = await runJudge({ providers: provider(answer(evidence)), prompt })
    assert.match(j.rejected, /quote_not_in_evidence: 2\.1/)
  })

  it('returns null when it cannot run: no provider, an aborted signal, a service failure', async () => {
    assert.equal(await runJudge({ providers: {}, prompt, evidence }), null)
    const ac = new AbortController(); ac.abort()
    assert.equal(await runJudge({ providers: provider(answer(evidence)), prompt, evidence, signal: ac.signal }), null)
    assert.equal(await runJudge({ providers: { text: { complete: async () => { throw new Error('sin clave') } } }, prompt, evidence }), null)
  })
})

describe('the target of an axis', () => {
  const scored = (scores) => Object.entries(scores).map(([id, score]) => ({ id, applies: true, score, quote: 'q', claim: 'c', reasoning: 'r' }))
  it('is met when the mean, rounded to the nearest level, reaches it: a mean of 1.5 is exceptional', () => {
    // Execute asks +2 of the axis 2. Two +2 and one +1 (mean 1.67) is an exceptional axis; before, only three +2 met it.
    const axis = (kpis) => axisScores(scored(kpis), 'execute').find((a) => a.axis === 2)
    assert.equal(axis({ '2.1': 2, '2.2': 2, '2.3': 1 }).meets, true)
    assert.equal(axis({ "2.1": 2, "2.2": 1, "2.3": 1 }).meets, false) // 1.33 rounds to +1
  })
  it('a mean under 1.5 does not meet an exceptional target, and one under -0.5 does not meet the expected minimum', () => {
    const axisOf = (kpis, quadrant, n) => axisScores(scored(kpis), quadrant).find((a) => a.axis === n)
    assert.equal(axisOf({ '2.1': 2, '2.2': 1, '2.3': 1 }, 'execute', 2).meets, false)
    assert.equal(axisOf({ '2.1': 2, '2.2': 1, '2.3': 1 }, 'generate', 2).meets, true)
    assert.equal(axisOf({ '2.1': 0, '2.2': -1, '2.3': 0 }, 'generate', 2).meets, true) // -0.33 rounds to 0: expected
    assert.equal(axisOf({ '2.1': -1, '2.2': -1, '2.3': 0 }, 'generate', 2).meets, false) // -0.67 rounds to -1
    assert.equal(axisOf({ '2.1': 2, '2.2': 2, '2.3': 2 }, 'execute', 2).meets, true)
  })
})
