// The Guard of the idea for a message analyzed before it existed (UD-307). The analyzer judges «nothing changes permanently without the approval of a person when what is asked is
// to explore an idea» when it reads a message (`idea_guard`, with `idea` and `idea_reason`). A message analyzed earlier has no such field in its assessment, and its delivery would
// go to production without that judgement. So the worker asks for only that judgement, once, when the job of such a message starts, saves it in the assessment and only then
// decides. The model reads the spirit of the message and of who wrote it; the system reads the boolean it returns (invariant 11 of the host: no pattern over the words).
import { get, run as runSql } from '../db/index.js'
import { infra } from '../domain/errors.js'
import { spawnStreaming } from './runners.js'
import { costOfResult } from '../telemetry/pricing.js'

/** Whether the stored assessment of the message lacks the judgement: a boolean `idea_guard` is the only thing that says it was made. */
export function ideaGuardMissing (db, messageId) {
  const row = get(db, 'SELECT estimates_json FROM messages WHERE id = ? AND deleted_at IS NULL', messageId)
  if (!row) return false
  try { return typeof JSON.parse(row.estimates_json ?? 'null')?.idea_guard !== 'boolean' } catch { return true }
}

export const ideaGuardSchema = () => ({
  type: 'object',
  properties: { idea: { type: 'number' }, idea_guard: { type: 'boolean' }, idea_reason: { type: 'string' } },
  required: ['idea', 'idea_guard', 'idea_reason'],
  additionalProperties: false
})

/** The prompt of that one judgement: who wrote the message, the area, the message, and the Guard in the words the analyzer reads. */
export function ideaGuardPrompt ({ author, message, areaTitle, areaDescription }) {
  const fields = Object.entries(message.fields ?? {}).map(([k, v]) => `- ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n')
  return [
    'Eres el analizador de pedidos de un equipo. Un mensaje se analizó antes de que existiera una Guardia y hace falta solo ese juicio.',
    '',
    'La Guardia: «nada cambia de forma permanente sin el visto de una persona cuando lo pedido es explorar una idea».',
    'Entiende qué se está pidiendo y el espíritu del mensaje, con lo que sabes de quien lo escribe y de cómo habla de su trabajo: quien comparte una ocurrencia, una posibilidad o algo que le gustaría ver está aportando una idea aunque use el imperativo; quien describe con precisión algo que ya acordó o que falla pide un cambio decidido.',
    '',
    'Devuelve idea_guard (true si la Guardia aplica, false si no), idea (de 0 a 1, cuánto de lo pedido es una idea por explorar frente a un pedido decidido; es contexto y no decide nada) e idea_reason (una frase con la razón).',
    '',
    `<autor>\n${author?.name ?? ''}\n\n${author?.profile ?? ''}\n</autor>`,
    `<area>\n${areaTitle ?? ''}\n\n${areaDescription ?? ''}\n</area>`,
    `<mensaje>\n${message.title}\n\n${message.body}\n\n${fields}\n</mensaje>`
  ].join('\n')
}

/**
 * Makes the judgement when the message lacks it and saves it in `estimates_json` next to what is there (nothing else of the assessment changes). Returns the cost of the call, or 0
 * when nothing was needed. A judgement that cannot be made fails the job as a service failure (it is tried again): delivering an idea without it is what this exists to prevent.
 */
export async function ensureIdeaGuard ({ db, config, signal, messageId, run = (opts) => spawnStreaming(opts.bin, opts.args, { env: process.env, stdin: opts.prompt, keepStdout: true, timeoutMs: opts.timeoutMs, graceMs: opts.graceMs, signal: opts.signal }) }) {
  if (!ideaGuardMissing(db, messageId)) return 0
  const x = config.execute
  const row = get(db, `SELECT m.title, m.body, m.fields_json, m.estimates_json, a.title AS area_title, a.description AS area_description, u.name AS author_name, u.profile AS author_profile
                         FROM messages m JOIN areas a ON a.id = m.area_id JOIN members u ON u.id = m.author_id WHERE m.id = ?`, messageId)
  let fields = {}
  try { fields = JSON.parse(row.fields_json || '{}') } catch { /* no fields */ }
  const prompt = ideaGuardPrompt({ author: { name: row.author_name, profile: row.author_profile }, message: { title: row.title, body: row.body, fields }, areaTitle: row.area_title, areaDescription: row.area_description })
  const args = ['-p', '--model', x.judgeModel, '--output-format', 'json', '--json-schema', JSON.stringify(ideaGuardSchema()), '--tools', '', '--max-budget-usd', String(Math.min(1, x.maxBudgetUsd))]
  let out = null
  let cost = 0
  try {
    const r = await run({ bin: x.bin, args, prompt, timeoutMs: Math.min(x.timeoutMs, 300_000), graceMs: x.killGraceMs, signal }) // the same cheap model and bounds as the IMK judge
    if (r.code === 0 && !r.spawnError) {
      const result = JSON.parse(r.stdout ?? '')
      out = result.structured_output
      cost = costOfResult(result) ?? 0
    }
  } catch { out = null }
  if (!out || typeof out.idea_guard !== 'boolean') throw infra('No se pudo juzgar si el pedido es una idea; se reintenta.', 'idea_guard_unavailable')
  let stored = {}
  try { stored = JSON.parse(row.estimates_json ?? 'null') ?? {} } catch { stored = {} }
  const idea = typeof out.idea === 'number' && out.idea >= 0 && out.idea <= 1 ? out.idea : null
  const next = { ...stored, idea, idea_guard: out.idea_guard, idea_reason: String(out.idea_reason ?? '').trim() }
  runSql(db, 'UPDATE messages SET estimates_json = ? WHERE id = ?', JSON.stringify(next), messageId)
  return cost
}
