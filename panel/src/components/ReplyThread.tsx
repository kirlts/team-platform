import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { useFormat, useT } from '@/i18n'
import { useMe } from '@/lib/queries'
import type { MessageDetail } from '@/lib/types'
import { Avatar } from './Avatar'
import { CloseMessage } from './CloseMessage'
import { AttachmentStrip } from './AttachmentStrip'
import { FitList } from './FitList'
import { useLookups } from './lookups'
import { KIND_KEY, ReplyForm } from './ReplyForm'

/**
 * Replies of a message: the list fits its frame and paginates; the form stays at the foot, in
 * view. The sender does not reply to their own message: they do not see the form.
 */
export function ReplyThread({ message, focusForm }: { message: MessageDetail; focusForm?: boolean }) {
  const t = useT()
  const format = useFormat()
  const me = useMe().data
  const { memberName } = useLookups()
  const canReply = !!me && me.id !== message.author_id && message.status !== 'closed'
  const rows = useMemo(() => message.replies, [message.replies])
  // What the person just did at the foot of the page (send, close) is brought into the window with its controls: on a phone the
  // form would otherwise end flush with the edge and «Cerrar» would fall below it (J5-flow-reply-close).
  const foot = useRef<HTMLDivElement>(null)
  const [sentAt, setSentAt] = useState<number | null>(null)
  useEffect(() => {
    if (sentAt !== null && message.replies.length > sentAt) {
      setSentAt(null)
      foot.current?.scrollIntoView?.({ block: 'nearest' })
    }
  }, [message.replies.length, sentAt])
  const status = useRef(message.status)
  useEffect(() => {
    if (status.current === message.status) return
    status.current = message.status
    foot.current?.scrollIntoView?.({ block: 'nearest' })
  }, [message.status])

  return (
    <section aria-label={t('replies.title')} className="flex min-h-0 flex-1 flex-col gap-3 md:flex-initial">
      <div className="flex items-center gap-2">
        <h2>{t('replies.title')}</h2>
        <Badge tone="neutral" className="tabular-nums">
          {message.replies.length}
        </Badge>
      </div>
      {/* The slot does not grow: the form follows the last reply instead of sitting at the foot of the screen (J1-A-24). */}
      <FitList
        className="flex-initial"
        rows={rows}
        rowKey={(r) => r.id}
        renderRow={(r) => (
          <article className="flex gap-3 border-b border-line px-3 py-3 last:border-b-0">
            <Avatar name={memberName(r.author_id) || '?'} size={28} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted">
                <span data-repeat-ok="person" className="break-words text-sm font-semibold text-fg">{memberName(r.author_id)}</span>
                {r.kind !== 'answer' && <Badge tone={'neutral'}>{t(KIND_KEY[r.kind])}</Badge>}
                <time dateTime={r.created_at} className="tabular-nums">
                  {format.stamp(r.created_at)}
                </time>
              </div>
              {r.body && <p className="prose-block whitespace-pre-wrap break-words text-sm">{r.body}</p>}
              <AttachmentStrip items={r.attachments ?? []} scope="reply" px={36} named className="pt-0.5" />
            </div>
          </article>
        )}
        empty={<p className="px-3 py-6 text-center text-sm text-muted">{t('replies.none')}</p>}
      />
      <div ref={foot} className="scroll-mb-4">
      {canReply ? (
        <ReplyForm messageId={message.id} autoFocus={focusForm} onSent={() => setSentAt(message.replies.length)}>
          <CloseMessage id={message.id} closed={false} quiet />
        </ReplyForm>
      ) : (
        // Without the form, the reason and the way out: a missing control that says nothing looks like a fault (J3-A-17, J4-flow-01).
        <div role="status" className="well flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm text-muted">
          <p className="min-w-0 break-words">{message.status === 'closed' ? t('replies.closedNote') : t('replies.yours')}</p>
          <CloseMessage id={message.id} closed={message.status === 'closed'} />
        </div>
      )}
      </div>
    </section>
  )
}
