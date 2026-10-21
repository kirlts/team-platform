// Notification priorities (UD-029). One rule for the Mensajes tab, the bell, the pending counts by area and the
// notice in Inicio: the background takes the color of the highest priority present, red > yellow > blue.
//   red: affects me directly and needs my action (assigned to me and still open).
//   yellow: pending (assigned to me and answered but not closed; open messages of an area that are not mine).
//   blue: informative or new (replies to a message I sent; news since I last looked).
import type { Message } from './types'

export const TONES = ['red', 'yellow', 'blue'] as const
export type Tone = (typeof TONES)[number]
export type ToneCounts = Partial<Record<Tone, number>>

/** The highest priority with at least one item, or null when there is nothing. */
export function topTone(counts: ToneCounts): Tone | null {
  return TONES.find((tone) => (counts[tone] ?? 0) > 0) ?? null
}

export const toneTotal = (counts: ToneCounts) => TONES.reduce((n, tone) => n + (counts[tone] ?? 0), 0)

/** The same classification the server makes in GET /messages/summary, for one message already on screen. */
export function messageTone(message: Pick<Message, 'status' | 'assignee_ids' | 'author_id'>, meId: string): Tone | null {
  if (message.status === 'closed' || !meId) return null
  if (message.assignee_ids.includes(meId)) return message.status === 'open' ? 'red' : 'yellow'
  if (message.author_id === meId && message.status === 'answered') return 'blue'
  return null
}
