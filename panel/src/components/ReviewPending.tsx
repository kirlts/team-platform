import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { MessageSquare } from '@/components/icons'
import { useLookups } from '@/components/lookups'
import { Button } from '@/components/ui/button'
import { requestMention } from '@/lib/mention'
import { useT } from '@/i18n'
import { queryKeys, type MessageDetail } from '@team-platform/client'
import { useJobProgress, useMe } from '@team-platform/client/react'
import { Meter } from './Meter'

/**
 * «Cambio listo para revisar» (UD-275, amended by UD-280): one line of state while a change waits for a person, and the way into the review. The review is not
 * a set of buttons: it is a reply in the thread, by text or voice, mentioning the agent («Entregar», descartar, pedir cambios or ask a question are all words of the reply, and the
 * model says which one it was). The one control here, «Responder a <agente>», opens that reply with the agent already mentioned and the cursor in the field, so the person
 * only writes what they want. While a delivery that was approved this way runs, the line shows its progress.
 */
export function ReviewPending({ message }: { message: MessageDetail }) {
  const t = useT()
  const me = useMe().data
  const { members } = useLookups()
  const pending = message.pending_delivery
  const running = pending?.delivering_job_id
  const progress = useJobProgress(running ?? undefined, undefined)
  const qc = useQueryClient()
  const [seen, setSeen] = useState(false)
  const done = progress?.done ?? false
  // The delivery ended (in production, or held or failed again): the message is read again and the line shows what is left.
  useEffect(() => {
    if (done && !seen) {
      setSeen(true)
      void qc.invalidateQueries({ queryKey: queryKeys.message(message.id) })
    }
  }, [done, seen, qc, message.id])
  if (!pending) return null
  const busy = Boolean(running) && !done
  // UD-289: the line says what happened to the branch, not what it was when it was held.
  const title = pending.state === 'failed' ? t('review.failed') : t('review.noReason')
  // The reply field exists while the message is open and the person is on the team; a failed delivery is retried from the thread, not reviewed.
  const agent = members.find((m) => m.id === pending.agent_id && m.kind === 'agent' && m.active !== false)
  const canAnswer = !!me && me.kind !== 'agent' && !!agent && message.status !== 'closed' && pending.state !== 'failed' && !busy
  const answer = () => {
    if (!agent) return
    requestMention(agent.id)
    const field = document.getElementById('reply-field')
    field?.scrollIntoView?.({ block: 'center' })
    field?.focus()
  }
  return (
    <section data-testid="review-pending" aria-label={title} className="glass leaf flex shrink-0 flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p data-testid="review-reason" className="text-sm">
          {title}
        </p>
        {canAnswer && agent && (
          <Button size="sm" variant="secondary" data-testid="review-reply" className="max-md:h-11" onClick={answer}>
            <MessageSquare size={14} aria-hidden /> {t('review.reply', { name: agent.name })}
          </Button>
        )}
      </div>
      {busy && (
        <div data-testid="review-progress" className="flex flex-col gap-1">
          <Meter percent={progress?.percent ?? 0} label={t('review.delivering')} />
          <p role="status" className="text-xs text-muted">
            {progress?.phrase || t('review.delivering')}
          </p>
        </div>
      )}
    </section>
  )
}
