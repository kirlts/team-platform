import { useId, useState } from 'react'
import { ArrowRight } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/input'
import { useErrorText, useT } from '@/i18n'
import { useForward, useMe } from '@team-platform/client/react'
import { useNotices } from '@/lib/notices'
import { useLookups } from './lookups'
import { NativeSelect } from './NativeSelect'

/**
 * «Reenviar»: the same message goes to another member with a reason (UD-272). The window asks for the member (every active one but the sender of the
 * forward, an agent as any other) and the reason, which is required: the button stays off and says what is missing until both are there. The reason
 * stays in the thread as a notice. An agent starts working the message when it receives it.
 */
export function ForwardMessage({ messageId }: { messageId: string }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" data-testid="forward-open">
          <ArrowRight size={14} aria-hidden /> {t('forward.action')}
        </Button>
      </DialogTrigger>
      <DialogContent title={t('forward.title')}>{open && <ForwardForm messageId={messageId} onClose={() => setOpen(false)} />}</DialogContent>
    </Dialog>
  )
}

function ForwardForm({ messageId, onClose }: { messageId: string; onClose: () => void }) {
  const t = useT()
  const errorText = useErrorText()
  const notices = useNotices()
  const me = useMe().data
  const { activeMembers, memberName } = useLookups()
  const forward = useForward(messageId)
  const [memberId, setMemberId] = useState('')
  const [comment, setComment] = useState('')
  const missingId = useId()
  const recipients = activeMembers.filter((m) => m.id !== me?.id)
  const noMember = memberId === ''
  const noComment = comment.trim() === ''
  const missing = noMember && noComment ? t('forward.missingBoth') : noMember ? t('forward.missingMember') : noComment ? t('forward.missingComment') : null

  const submit = () => {
    if (missing || forward.isPending) return
    forward.mutate(
      { member_id: memberId, comment: comment.trim() },
      {
        onSuccess: () => {
          notices.show({ text: t('forward.sent', { name: memberName(memberId) }) })
          onClose()
        },
      },
    )
  }

  return (
    <form
      className="flex min-h-0 flex-col gap-4 overflow-y-auto p-5"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <label className="flex flex-col gap-1 text-sm font-medium">
        {t('forward.member')}
        <NativeSelect data-testid="forward-member" autoFocus value={memberId} onChange={(e) => setMemberId(e.target.value)}>
          <option value="" disabled>
            {t('forward.memberNone')}
          </option>
          {recipients.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </NativeSelect>
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        {t('forward.comment')}
        <Textarea data-testid="forward-comment" rows={4} value={comment} onChange={(e) => setComment(e.target.value)} />
      </label>
      {forward.isError && (
        <p role="alert" className="text-xs text-danger">
          {errorText(forward.error)}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 pt-1">
        {missing && (
          <p id={missingId} role="status" className="mr-auto text-xs text-muted">
            {missing}
          </p>
        )}
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" variant="primary" data-testid="forward-submit" disabled={missing !== null || forward.isPending} aria-describedby={missing ? missingId : undefined}>
          {t('forward.submit')}
        </Button>
      </div>
    </form>
  )
}
