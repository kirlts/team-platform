import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/input'
import { useErrorText, useT } from '@/i18n'
import { queryKeys, type MessageDetail } from '@team-platform/client'
import { useDeliver, useDiscardDelivery, useJobProgress, useMe } from '@team-platform/client/react'
import { useLookups } from './lookups'
import { Meter } from './Meter'

/** Takes the focus to the reply field, where the changes are asked for (the mentions of the thread address them to the agent). */
function focusReply() {
  const field = document.getElementById('reply-field')
  field?.scrollIntoView({ block: 'center' })
  field?.focus()
}

/**
 * «Revisión» (UD-275; the title avoids «pendiente», retired as a state by UD-041): a change that waits for a person before it reaches production. The proposal (screenshots and walkthrough) is in the
 * thread; here the person decides: «Entregar» (primary, an Editor), «Pedir cambios» (focus on the reply field) and «Descartar» (with a required reason).
 * A person who is not an Editor sees the block without buttons and who can approve. While the delivery runs the block shows its progress.
 */
export function ReviewPending({ message }: { message: MessageDetail }) {
  const t = useT()
  const errorText = useErrorText()
  const me = useMe().data
  const { members, memberName } = useLookups()
  const pending = message.pending_delivery
  const deliver = useDeliver(message.id)
  const discard = useDiscardDelivery(message.id)
  const [jobId, setJobId] = useState<string>()
  const [dialog, setDialog] = useState<'deliver' | 'discard' | null>(null)
  const [hint, setHint] = useState(false)
  const [reason, setReason] = useState('')
  const running = pending?.delivering_job_id ?? jobId
  const progress = useJobProgress(running, undefined)
  const qc = useQueryClient()
  const done = progress?.done ?? false
  // The delivery ended (in production, or held or failed again): the message is read again and the block shows what is left.
  useEffect(() => {
    if (done) void qc.invalidateQueries({ queryKey: queryKeys.message(message.id) })
  }, [done, qc, message.id])
  if (!pending) return null
  const editor = me?.role === 'editor'
  const approvers = members.filter((m) => m.role === 'editor' && m.kind !== 'agent' && m.active !== false).map((m) => m.name)
  const busy = Boolean(running) && !progress?.done
  const agent = pending.agent_id ? memberName(pending.agent_id) : ''

  const confirm = () =>
    deliver.mutate(undefined, {
      onSuccess: (r) => {
        setJobId(r.job_id)
        setDialog(null)
      },
    })
  const confirmDiscard = () => {
    if (!reason.trim()) return
    discard.mutate(reason.trim(), {
      onSuccess: () => {
        setDialog(null)
        setReason('')
      },
    })
  }

  return (
    <section data-testid="review-pending" aria-labelledby="review-title" className="glass leaf flex shrink-0 flex-col gap-2 p-3">
      <h2 id="review-title" className="text-xs font-semibold">
        {t('review.title')}
      </h2>
      <p data-testid="review-reason" className="text-sm">
        {pending.held_reason || t('review.noReason')}
      </p>
      {busy ? (
        <div data-testid="review-progress" className="flex flex-col gap-1">
          <Meter percent={progress?.percent ?? 0} label={t('review.delivering')} />
          <p role="status" className="text-xs text-muted">
            {progress?.phrase || t('review.delivering')}
          </p>
        </div>
      ) : editor ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm" data-testid="review-deliver" onClick={() => setDialog('deliver')}>
            {t('review.deliver')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            data-testid="review-changes"
            onClick={() => {
              setHint(true)
              focusReply()
            }}
          >
            {t('review.changes')}
          </Button>
          <Button variant="ghost" size="sm" className="text-muted hover:text-danger" data-testid="review-discard" onClick={() => setDialog('discard')}>
            {t('review.discard')}
          </Button>
        </div>
      ) : (
        <p data-testid="review-approvers" className="text-xs text-muted">
          {t('review.approvers', { names: approvers.join(', ') || '—' })}
        </p>
      )}
      {hint && !busy && (
        <p data-testid="review-hint" className="text-xs text-muted">
          {agent ? t('review.changesHint', { name: agent }) : t('review.changesHintNoName')}
        </p>
      )}
      {deliver.isError && (
        <p role="alert" className="text-xs text-danger">
          {errorText(deliver.error)}
        </p>
      )}

      <Dialog open={dialog === 'deliver'} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent title={t('review.deliver')}>
          <div className="flex flex-col gap-4 p-5">
            <p className="text-sm">{t('review.confirmLine')}</p>
            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={() => setDialog(null)}>
                {t('common.cancel')}
              </Button>
              <Button variant="primary" data-testid="review-confirm" disabled={deliver.isPending} onClick={confirm}>
                {t('review.deliver')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === 'discard'} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent title={t('review.discard')}>
          <form
            className="flex flex-col gap-4 p-5"
            onSubmit={(e) => {
              e.preventDefault()
              confirmDiscard()
            }}
          >
            <p className="text-sm">{t('review.discardLine')}</p>
            <label className="flex flex-col gap-1 text-sm font-medium">
              {t('review.reason')}
              <Textarea data-testid="review-discard-reason" autoFocus rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            {discard.isError && (
              <p role="alert" className="text-xs text-danger">
                {errorText(discard.error)}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
              {!reason.trim() && (
                <p role="status" className="mr-auto text-xs text-muted">
                  {t('review.reasonMissing')}
                </p>
              )}
              <Button variant="ghost" onClick={() => setDialog(null)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" variant="primary" data-testid="review-discard-confirm" disabled={!reason.trim() || discard.isPending}>
                {t('review.discard')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}
