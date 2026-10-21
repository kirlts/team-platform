import { MessageSquare } from '@/components/icons'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { useFormat, useT } from '@/i18n'
import { attachmentUrl, replyAttachmentUrl } from '@/lib/api'
import { mainAttachment } from '@/lib/media'
import { useMe, useSetClosed } from '@/lib/queries'
import type { Message } from '@/lib/types'
import { Avatar } from './Avatar'
import { useLookups } from './lookups'
import { MediaKinds } from './MediaKinds'
import { Recipients } from './Recipients'
import { AreaBadge, StatusBadge } from './StatusBadge'
import { Thumb } from './Thumb'

/** Recipients drawn before the rest fold into «+N». */
const RECIPIENTS_SHOWN = 2

/**
 * Message row, with the mockup's layout: area tab and sender on top; below,
 * date, media icons and status in three fixed columns (so they line up row by row), the
 * title and the text, and on the right the main thumbnail; at the foot, the recipients and the actions.
 * The whole row leads to the detail; Responder opens the detail with the form at hand (a row does not
 * grow: the list fits its frame) and Cerrar or Reabrir apply instantly. In the `reply` variant it shows the latest reply: its author, its date,
 * its media and its text.
 */
export function MessageCard({ message, variant = 'message' }: { message: Message; variant?: 'message' | 'reply' }) {
  const t = useT()
  const format = useFormat()
  const me = useMe().data
  const { areaTitle, memberName } = useLookups()
  const setClosed = useSetClosed()

  const closed = message.status === 'closed'
  const isAuthor = me?.id === message.author_id
  const reply = variant === 'reply' ? message.last_reply : null
  // Reply row: the author, the date, the media and the thumbnail are the reply's.
  const from = reply ?? message
  const main = mainAttachment(from.attachments)

  return (
    <article className="relative flex flex-col gap-2 border-b border-line px-4 py-3 last:border-b-0 hover:bg-glass-edge">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3">
        <span className="flex">
          <AreaBadge title={areaTitle(message.area_id)} />
        </span>
        <span className="inline-flex max-w-[11rem] items-center gap-1.5 text-xs leading-tight text-muted">
          <Avatar name={memberName(from.author_id) || '?'} size={22} />
          {memberName(from.author_id)}
        </span>
      </div>

      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted sm:grid sm:grid-cols-[5.5rem_7.5rem_minmax(0,1fr)] sm:gap-x-2">
            <time dateTime={from.created_at} className="tabular-nums">
              {format.stamp(from.created_at)}
            </time>
            <MediaKinds of={from} />
            <span className="flex">
              <StatusBadge status={message.status} />
            </span>
          </div>
          <h3 className="break-words">
            <Link
              to={`/messages/${message.id}`}
              className="outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:outline-2 focus-visible:after:outline-accent"
            >
              {message.title}
            </Link>
          </h3>
          <p className="prose-block whitespace-pre-line break-words text-sm text-muted">{reply ? reply.body : message.body}</p>
        </div>
        {main && <Thumb item={{ kind: main.kind, src: main.kind === 'link' ? undefined : (reply ? replyAttachmentUrl : attachmentUrl)(main.id), name: main.name, size: main.size }} px={56} />}
      </div>

      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1.5 text-xs text-muted">
        <Recipients ids={variant === 'message' ? message.assignee_ids : []} max={RECIPIENTS_SHOWN} className="min-w-0 flex-1 basis-full sm:basis-40">
          {message.reply_count > 0 && (
            <li className="inline-flex items-center gap-1" title={t('card.replies', { n: message.reply_count })}>
              <MessageSquare size={13} aria-hidden />
              {message.reply_count}
            </li>
          )}
        </Recipients>
        <span className="relative z-10 ml-auto flex items-center gap-1">
          {!isAuthor && !closed && (
            <Button asChild size="sm" variant="ghost" className="text-accent-deep">
              <Link to={`/messages/${message.id}?reply=1`}>{t('card.reply')}</Link>
            </Button>
          )}
          <Button size="sm" variant="ghost" className="text-muted" disabled={setClosed.isPending} onClick={() => setClosed.mutate({ id: message.id, closed: !closed })}>
            {closed ? t('card.reopen') : t('card.close')}
          </Button>
        </span>
      </div>
    </article>
  )
}
