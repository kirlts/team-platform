import { useI18n, type MessageKey } from '@/i18n'

/** The class and detail of a tool call as the API sends them in `slowest` (`action`, `detail`); `summary` is the server's Spanish phrase and `name` the tool. */
export interface ToolCall {
  action?: string | null
  detail?: string | null
  summary?: string | null
  name: string
}

const ACTIONS = new Set(['read', 'edit', 'command', 'search', 'subagent', 'web', 'plan', 'other'])
/** The prefixes of `phraseForTool` (src/execute/stream.js) without accents (the phrase is compared folded): rows written before the classes existed carry only that phrase, and these are its own texts, not interpretation of what a person wrote. */
const OLD_PREFIX: [string, string][] = [
  ['Lectura: ', 'read'],
  ['Edicion: ', 'edit'],
  ['Orden: ', 'command'],
  ['Busqueda: ', 'search'],
  ['Subagente: ', 'subagent'],
  ['Herramienta: ', 'other'],
]
const OLD_WHOLE: Record<string, string> = { 'Consulta web': 'web', 'Plan de trabajo': 'plan' }

/** Class and detail of a call, from its fields or, for an old row, from its phrase. */
export function toolParts(call: ToolCall): { action: string; detail: string } | null {
  if (call.action && ACTIONS.has(call.action)) return { action: call.action, detail: call.detail ?? '' }
  const summary = (call.summary ?? '').normalize('NFD').replace(/\p{M}/gu, '')
  if (OLD_WHOLE[summary]) return { action: OLD_WHOLE[summary]!, detail: '' }
  const hit = OLD_PREFIX.find(([prefix]) => summary.startsWith(prefix))
  return hit ? { action: hit[1], detail: summary.slice(hit[0].length) } : null
}

/** The phrase of a tool call in the language of the account: «Read: Reservas.tsx», «Orden: npm test». A call the catalog cannot class shows its summary or its tool name. */
export function useToolPhrase() {
  const { t } = useI18n()
  return (call: ToolCall) => {
    const parts = toolParts(call)
    if (!parts) return call.summary ?? call.name
    return t(`tool.phrase.${parts.action}` as MessageKey, { detail: parts.detail })
  }
}
