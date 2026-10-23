// Reads GET /messages/summary into the counts the state badges draw (UD-028, UD-041).
import { serializeQuery, type MessageStatus, type MessageSummary } from '@team-platform/client'
import type { StateCounts } from './states'

/** What affects me, by state. */
export function mineCounts(summary: MessageSummary | undefined): StateCounts {
  return summary ? { open: summary.mine.open, answered: summary.mine.answered } : {}
}

/** The messages of an area, one count per state; the states with nothing are absent. */
export function areaCounts(summary: MessageSummary | undefined, areaId: string): Record<MessageStatus, number> {
  const row = summary?.areas.find((a) => a.area_id === areaId)
  return { open: row?.open ?? 0, answered: row?.answered ?? 0, closed: row?.closed ?? 0 }
}

/** Mensajes filtered by one area and one state: where a count of an area leads (UD-028). */
export function areaMessagesPath(areaId: string, status: MessageStatus = 'open'): string {
  return `/messages?${serializeQuery({ filters: [{ prop: 'area', op: 'eq', value: areaId }, { prop: 'status', op: 'eq', value: status }], q: '' }).toString()}`
}
