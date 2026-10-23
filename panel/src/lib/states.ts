// The three states of a message are the only category the interface shows (UD-041, MASTER-SPEC §1.1): open, answered and
// closed, each with its color (open red, answered yellow, closed blue). One rule for the Mensajes tab, the bell, the counts by
// area and the notice in Inicio: the background takes the color of the highest state present, open > answered.
// Closed messages raise no notice, but they show their color in lists and filters.
import type { Message, MessageStatus } from '@team-platform/client'

/** In order of priority: the first one present gives its color to a notice. */
export const STATES: readonly MessageStatus[] = ['open', 'answered', 'closed']
/** The states that raise a notice. */
export const NOTICE_STATES = ['open', 'answered'] as const
export type NoticeState = (typeof NOTICE_STATES)[number]
export type StateCounts = Partial<Record<MessageStatus, number>>

/** The highest state with at least one message, or null when there is nothing. */
export function topState(counts: StateCounts): MessageStatus | null {
  return STATES.find((state) => (counts[state] ?? 0) > 0) ?? null
}

export const stateTotal = (counts: StateCounts) => STATES.reduce((n, state) => n + (counts[state] ?? 0), 0)

/**
 * The same classification the server makes in GET /messages/summary, for one message already on screen: a message not
 * closed affects me when it is assigned to me, or when I sent it and it has a reply (UD-028). Its state is the notice.
 */
export function noticeState(message: Pick<Message, 'status' | 'assignee_ids' | 'author_id'>, meId: string): NoticeState | null {
  if (message.status === 'closed' || !meId) return null
  if (message.assignee_ids.includes(meId)) return message.status
  if (message.author_id === meId && message.status === 'answered') return 'answered'
  return null
}
