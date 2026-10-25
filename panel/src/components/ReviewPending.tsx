import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useT } from '@/i18n'
import { queryKeys, type MessageDetail } from '@team-platform/client'
import { useJobProgress } from '@team-platform/client/react'
import { Meter } from './Meter'

/**
 * «Cambio listo para revisar» (UD-275, amended by UD-280): one line of state while a change waits for a person. It has no actions: the review is done by
 * answering in the thread, by text or voice, mentioning Claude («Entregar», descartar, pedir cambios or ask a question are all words of the reply, and the model
 * says which one it was). While a delivery that was approved this way runs, the line shows its progress.
 */
export function ReviewPending({ message }: { message: MessageDetail }) {
  const t = useT()
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
  // UD-287: the line says what happened to the branch, not what it was when it was held.
  const title = pending.state === 'failed' ? t('review.failed') : t('review.noReason')
  return (
    <section data-testid="review-pending" aria-label={title} className="glass leaf flex shrink-0 flex-col gap-2 p-3">
      <p data-testid="review-reason" className="text-sm">
        {title}
      </p>
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
