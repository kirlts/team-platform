import type { Member, MessageDetail } from '@team-platform/client'

/**
 * Whether the person holds the question of an agent (UD-269): the message is assigned to them and the last reply is a `clarification` from an
 * agent member. The sender who receives a handoff may then reply, as the server allows (`holdsPendingQuestion`).
 */
export function holdsPendingQuestion(message: Pick<MessageDetail, 'assignee_ids' | 'replies'>, meId: string, members: Pick<Member, 'id' | 'kind'>[]): boolean {
  if (!message.assignee_ids.includes(meId)) return false
  const last = message.replies.at(-1)
  return last?.kind === 'clarification' && members.some((m) => m.id === last.author_id && m.kind === 'agent')
}

/** Who may reply: anyone but the sender, or the sender with a pending question; never on a closed message. */
export function canReplyTo(message: Pick<MessageDetail, 'author_id' | 'status' | 'assignee_ids' | 'replies'>, meId: string | undefined, members: Pick<Member, 'id' | 'kind'>[]): boolean {
  if (!meId || message.status === 'closed') return false
  return meId !== message.author_id || holdsPendingQuestion(message, meId, members)
}
