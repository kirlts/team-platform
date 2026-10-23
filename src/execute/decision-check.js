// The filter before handing a message to a person (UD-269). A session that ends with `needs_decision` must fill `decision_check`: what it
// searched, why that did not cover it, one recommendation, what happens if the answer is wrong and a question that stands alone. The
// platform checks the form, never the meaning (RULES 4): an output without a valid block does not reach a person, the job fails with
// `invalid_output`. The reply the person sees is built from `question`, `recommendation` and `if_wrong`, the sources under them.

const FIELD_TEXTS = {
  searched: 'Sources checked, each with its path or identifier (host decisions, rules, spec, CLAUDE.md, template, the message itself).',
  why_not_covered: 'One line: why none of them settles it.',
  recommendation: 'One option, not a menu.',
  if_wrong: 'What happens if the answer is the wrong one, in each direction.',
  question: 'One line a person can answer without knowing the context.'
}
export const DECISION_CHECK_FIELDS = Object.keys(FIELD_TEXTS)

/**
 * The `decision_check` property. `validation` adds what the grammar of `--json-schema` does not take (`minItems`, `minLength`); the
 * rule «needs_decision requires it» is checked after the run, in `decisionCheckProblem`.
 */
export function decisionCheckSchema ({ validation = false } = {}) {
  const text = (name) => ({ type: 'string', ...(validation ? { minLength: 1 } : {}), description: FIELD_TEXTS[name] })
  return {
    type: 'object', additionalProperties: false, required: DECISION_CHECK_FIELDS,
    description: 'Required with outcome needs_decision.',
    properties: {
      searched: { type: 'array', ...(validation ? { minItems: 1 } : {}), items: { type: 'string', ...(validation ? { minLength: 1 } : {}) }, description: FIELD_TEXTS.searched },
      why_not_covered: text('why_not_covered'), recommendation: text('recommendation'), if_wrong: text('if_wrong'), question: text('question')
    }
  }
}

/** `null` when the output may go on; else the reason it may not. Only `needs_decision` needs the block. */
export function decisionCheckProblem (output) {
  if (output?.outcome !== 'needs_decision') return null
  const c = output.decision_check
  if (!c || typeof c !== 'object') return 'needs_decision exige decision_check'
  if (!Array.isArray(c.searched) || c.searched.filter((s) => typeof s === 'string' && s.trim()).length === 0) return 'decision_check.searched está vacío'
  for (const k of DECISION_CHECK_FIELDS.filter((f) => f !== 'searched')) if (typeof c[k] !== 'string' || !c[k].trim()) return `decision_check.${k} está vacío`
  return null
}

const LABELS = {
  'es-419': { question: 'Pregunta', recommendation: 'Recomendación', if_wrong: 'Si la respuesta es la equivocada', searched: 'Revisado' },
  en: { question: 'Question', recommendation: 'Recommendation', if_wrong: 'If the answer is the wrong one', searched: 'Checked' }
}

/** The part of the reply the person reads: the question first, then the recommendation and the cost of being wrong, the sources last. */
export function decisionLines (check, language) {
  if (!check) return []
  const t = LABELS[language] ?? LABELS['es-419']
  return [
    `**${t.question}**: ${String(check.question).trim()}`,
    `**${t.recommendation}**: ${String(check.recommendation).trim()}`,
    `**${t.if_wrong}**: ${String(check.if_wrong).trim()}`,
    `**${t.searched}**:\n${check.searched.map((s) => `- ${String(s).trim()}`).join('\n')}`
  ]
}
