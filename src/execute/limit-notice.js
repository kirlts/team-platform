// The warning of a limit that only a person lifts (V0.99 of the framework asks for the limit, the probable consequence and a third way before the decision is requested; third audit of the
// method, 2026-10-27, H-1). Until now the system wrote the name of the limit and the rest depended on the prose of the session, which nothing checked. It is the same filter as `decision_check`
// (decision-check.js): a session that ends `done` with a limit of a person open must fill `limit_notice` with the consequence if the limit is crossed and an alternative that does what was asked
// without crossing it. The platform checks the form, never the meaning (RULES 4): an output without them reaches no person, the job fails with `invalid_output`. The reply the person reads is
// built from the two fields, and the platform records that the notice was shown (`message.limit_notice`): a limit is lifted only after it was shown (`liftPersonGuards`).

const FIELD_TEXTS = {
  consequence: 'One line: what happens if the limit is crossed, in the words of the area.',
  alternative: 'One line: what the work does, or what the person can do, to get what was asked without crossing the limit.'
}
export const LIMIT_NOTICE_FIELDS = Object.keys(FIELD_TEXTS)

/** The `limit_notice` property. `validation` adds `minLength`, which the grammar of `--json-schema` does not take; the rule «a limit of a person is open» is checked after the run. */
export function limitNoticeSchema ({ validation = false } = {}) {
  const text = (name) => ({ type: 'string', ...(validation ? { minLength: 1 } : {}), description: FIELD_TEXTS[name] })
  return {
    type: 'object', additionalProperties: false, required: LIMIT_NOTICE_FIELDS,
    description: 'Required when the message touches a limit that only a person lifts and the work ends done: the warning the person reads before deciding.',
    properties: { consequence: text('consequence'), alternative: text('alternative') }
  }
}

/** `null` when the output may go on; else the reason it may not. Only a session that owes the notice (`owed`: a limit of a person is open) needs it. */
export function limitNoticeProblem (notice, owed) {
  if (!owed) return null
  if (!notice || typeof notice !== 'object') return 'un límite de una persona abierto exige limit_notice'
  for (const k of LIMIT_NOTICE_FIELDS) if (typeof notice[k] !== 'string' || !notice[k].trim()) return `limit_notice.${k} está vacío`
  return null
}

const LABELS = {
  'es-419': { consequence: 'Riesgo si se cruza', alternative: 'Alternativa que no lo cruza', lifts: 'Quien apruebe levanta el límite y queda registrado.' },
  en: { consequence: 'Risk if it is crossed', alternative: 'Alternative that does not cross it', lifts: 'Whoever approves lifts the limit and it is recorded.' }
}

/** The lines the person reads, the same in both ways an instance holds a limit (the delivery job and the refused delivery orders). Empty without a notice. */
export function limitNoticeLines (notice, language) {
  if (!notice || typeof notice !== 'object') return []
  const t = LABELS[language] ?? LABELS['es-419']
  return [`${t.consequence}: ${String(notice.consequence).trim()}`, `${t.alternative}: ${String(notice.alternative).trim()}`, t.lifts]
}
