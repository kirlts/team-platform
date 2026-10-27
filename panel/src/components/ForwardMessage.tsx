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
export function ForwardMessage({ messageId, iconOnly = false }: { messageId: string; /** A phone has no room for the word beside the other actions: the arrow alone, with the word as its name. */ iconOnly?: boolean }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size={iconOnly ? 'icon' : 'sm'} variant="ghost" data-testid="forward-open" className={iconOnly ? 'max-md:h-11 max-md:w-11' : undefined} aria-label={iconOnly ? t('forward.action') : undefined} title={iconOnly ? t('forward.action') : undefined}>
          <ArrowRight size={14} aria-hidden /> {!iconOnly && t('forward.action')}
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
  // What is missing is said under its own field, and only after sending was tried: a window that opens already complaining says nothing a person can act on.
  const [tried, setTried] = useState(false)
  const memberError = useId()
  const commentError = useId()
  const recipients = activeMembers.filter((m) => m.id !== me?.id)
  const noMember = memberId === ''
  const noComment = comment.trim() === ''

  const submit = () => {
    if (forward.isPending) return
    if (noMember || noComment) {
      setTried(true)
      return
    }
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
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <label className="flex flex-col gap-1 text-sm font-medium">
        {t('forward.member')}
        <NativeSelect data-testid="forward-member" autoFocus value={memberId} aria-invalid={tried && noMember ? true : undefined} aria-describedby={tried && noMember ? memberError : undefined} onChange={(e) => setMemberId(e.target.value)}>
          <option value="" disabled>
            {t('forward.memberNone')}
          </option>
          {recipients.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </NativeSelect>
        {tried && noMember && (
          <span id={memberError} role="alert" data-testid="forward-member-error" className="text-xs font-normal text-danger">
            {t('forward.missingMember')}
          </span>
        )}
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        {t('forward.comment')}
        <Textarea data-testid="forward-comment" rows={4} value={comment} aria-invalid={tried && noComment ? true : undefined} aria-describedby={tried && noComment ? commentError : undefined} onChange={(e) => setComment(e.target.value)} />
        {tried && noComment && (
          <span id={commentError} role="alert" data-testid="forward-comment-error" className="text-xs font-normal text-danger">
            {t('forward.missingComment')}
          </span>
        )}
      </label>
      {forward.isError && (
        <p role="alert" className="text-xs text-danger">
          {errorText(forward.error)}
        </p>
      )}
      <div className="flex items-center justify-end gap-3 pt-1">
        <Button variant="ghost" onClick={onClose} className="max-md:h-11">
          {t('common.cancel')}
        </Button>
        <Button type="submit" variant="primary" data-testid="forward-submit" disabled={forward.isPending} className="max-md:h-11">
          {t('forward.submit')}
        </Button>
      </div>
    </form>
  )
}
