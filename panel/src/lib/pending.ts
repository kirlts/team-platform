// Reads GET /messages/summary into the counts the priority badges draw (UD-028, UD-029).
import { serializeQuery } from './filters'
import type { ToneCounts } from './priority'
import type { MessageSummary } from './types'

/** What affects me, by priority. */
export function mineCounts(summary: MessageSummary | undefined): ToneCounts {
  return summary ? { red: summary.mine.red, yellow: summary.mine.yellow, blue: summary.mine.blue } : {}
}

/**
 * The open messages of an area as one count: red when at least one is assigned to me and still open, yellow
 * otherwise. An area with nothing open has no count.
 */
export function areaPendingCounts(summary: MessageSummary | undefined, areaId: string): ToneCounts {
  const row = summary?.areas.find((a) => a.area_id === areaId)
  if (!row || row.open === 0) return {}
  return row.mine_open > 0 ? { red: row.open } : { yellow: row.open }
}

/** Mensajes filtered by one area and by open: where a pending count leads. */
export function areaMessagesPath(areaId: string): string {
  return `/messages?${serializeQuery({ filters: [{ prop: 'area', op: 'eq', value: areaId }, { prop: 'status', op: 'eq', value: 'open' }], q: '' }).toString()}`
}
