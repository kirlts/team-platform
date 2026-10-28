import type { MessageKey } from '@/i18n'
import { TeamApiError, type Cause, type Check, type Connection, type ConnectionKind, type ProviderSlot, CAUSES } from '@team-platform/client'

/** Connections whose label the server sends in its own language: the panel names them from its catalog by their stable `name`. Brand names (Anthropic, DeepSeek...) are the same in every language and come as sent. */
const CATALOG_NAMES: Record<string, 'providers.name.groq-speech' | 'providers.name.openai-compatible'> = {
  'groq-speech': 'providers.name.groq-speech',
  'openai-compatible': 'providers.name.openai-compatible',
}

/** The name of a connection in the account's language. A custom connection keeps the label its owner wrote. */
export function connectionLabel(t: (key: MessageKey) => string, c: { name: string; label: string; custom?: boolean }): string {
  const key = c.custom ? undefined : CATALOG_NAMES[c.name]
  return key ? t(key) : c.label
}

/** The functions in the order the screen lists them. */
export const SLOTS: readonly ProviderSlot[] = ['text', 'vision', 'speech']

/** Kinds of connection each function accepts: Transcripción only takes the transcription connection (src/providers/index.js). */
const KINDS_BY_SLOT: Record<ProviderSlot, readonly ConnectionKind[]> = {
  text: ['anthropic', 'openai-compatible'],
  vision: ['anthropic', 'openai-compatible'],
  speech: ['groq-speech'],
}

/** Connections a function can use: compatible with it and with a key (stored or from the server environment). */
export function compatible(slot: ProviderSlot, connections: readonly Connection[], exclude?: string): Connection[] {
  return connections.filter((c) => KINDS_BY_SLOT[slot].includes(c.kind) && c.key.source !== null && c.name !== exclude)
}

/** Models shown at once in a result; more than this and the list gets a filter field. */
export const MODELS_SHOWN = 40

/** What a failed test carries, read from the 422 `provider_check_failed` body. */
export interface CheckFailure {
  cause: Cause
  status: number | null
  durationMs: number | null
}

export function failureOf(err: unknown): CheckFailure | null {
  if (!(err instanceof TeamApiError) || err.code !== 'provider_check_failed') return null
  const d = err.details
  const cause = typeof d.cause === 'string' && (CAUSES as readonly string[]).includes(d.cause) ? (d.cause as Cause) : 'unknown'
  return {
    cause,
    status: typeof d.status_code === 'number' ? d.status_code : null,
    durationMs: typeof d.duration_ms === 'number' ? d.duration_ms : null,
  }
}

/** The functions that block a retirement, from the 409 `provider_in_use` body. */
export function usedByOf(err: unknown): ProviderSlot[] | null {
  if (!(err instanceof TeamApiError) || err.code !== 'provider_in_use') return null
  const list = err.details.used_by
  return Array.isArray(list) ? (list.filter((s) => SLOTS.includes(s as ProviderSlot)) as ProviderSlot[]) : []
}

/** A test result as the screen keeps it until the next one: whom it belongs to and what came back. */
export interface Shown {
  subject: string
  check: Check
}
