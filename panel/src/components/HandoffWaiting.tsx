import { useLookups } from '@/components/lookups'
import { useT } from '@/i18n'
import type { MessageDetail } from '@team-platform/client'

/**
 * The handoff to a person (UD-269) as a state that shows: while the last reply is the question of an agent (`clarification`) and the message is open, one line says who it waits for.
 * Like the line of a review (UD-280) it has nothing to press: the person answers in the reply field of the sheet. A held delivery says it in its own line (`ReviewPending`).
 */
export function HandoffWaiting({ message }: { message: MessageDetail }) {
  const t = useT()
  const { members, memberName } = useLookups()
  const last = message.replies.at(-1)
  const asked = message.status !== 'closed' && !message.pending_delivery && last?.kind === 'clarification' && members.some((m) => m.id === last.author_id && m.kind === 'agent')
  const holders = message.assignee_ids.filter((id) => members.find((m) => m.id === id)?.kind !== 'agent')
  if (!asked || holders.length === 0) return null
  return (
    <p data-testid="handoff-waiting" className="m-0 shrink-0 px-1.5 text-sm text-muted">
      {t('handoff.waiting', { names: holders.map((id) => memberName(id) || '?').join(', ') })}
    </p>
  )
}
