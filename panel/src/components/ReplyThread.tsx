import { useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { useFormat, useT } from '@/i18n'
import { replyAttachmentUrl } from '@/lib/api'
import { useMe } from '@/lib/queries'
import type { MessageDetail } from '@/lib/types'
import { Avatar } from './Avatar'
import { FitList } from './FitList'
import { useLookups } from './lookups'
import { MediaKinds } from './MediaKinds'
import { KIND_KEY, ReplyForm } from './ReplyForm'
import { Thumb } from './Thumb'

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

  return (
    <section aria-label={t('replies.title')} className="flex min-h-0 flex-1 flex-col gap-3">
      <h2>
        {t('replies.title')} <span className="ml-1 text-muted">{message.replies.length}</span>
      </h2>
      <FitList
        rows={rows}
        rowKey={(r) => r.id}
        renderRow={(r) => (
          <article className="flex gap-3 border-b border-line px-4 py-3 last:border-b-0">
            <Avatar name={memberName(r.author_id) || '?'} size={28} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted">
                <span data-repeat-ok="person" className="break-words text-[13px] font-semibold text-fg">{memberName(r.author_id)}</span>
                {r.kind !== 'answer' && <Badge tone={r.kind === 'fix' ? 'answered' : 'neutral'}>{t(KIND_KEY[r.kind])}</Badge>}
                <time dateTime={r.created_at} className="tabular-nums">
                  {format.stamp(r.created_at)}
                </time>
                <MediaKinds of={r} />
              </div>
              {r.body && <p className="prose-block whitespace-pre-wrap break-words text-sm">{r.body}</p>}
              {(r.attachments?.length ?? 0) > 0 && (
                <ul aria-label={t('media.attachments')} className="flex flex-wrap gap-2 pt-0.5">
                  {r.attachments?.map((a) => (
                    <li key={a.id}>
                      <Thumb item={{ kind: a.kind, src: a.kind === 'link' ? undefined : replyAttachmentUrl(a.id), name: a.name, size: a.size }} px={36} href={a.kind === 'link' ? a.name : replyAttachmentUrl(a.id)} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </article>
        )}
        empty={<p className="px-3 py-6 text-center text-sm text-muted">{t('replies.none')}</p>}
      />
      {canReply && <ReplyForm messageId={message.id} autoFocus={focusForm} />}
    </section>
  )
}
