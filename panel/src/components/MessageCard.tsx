import { MessageSquare } from '@/components/icons'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { useFormat, useT } from '@/i18n'
import { attachmentUrl, replyAttachmentUrl } from '@/lib/api'
import { mainAttachment } from '@/lib/media'
import { messageTone } from '@/lib/priority'
import { useMe, useSetClosed } from '@/lib/queries'
import { cn } from '@/lib/utils'
import type { Message } from '@/lib/types'
import { Avatar } from './Avatar'
import { useLookups } from './lookups'
import { MediaKinds } from './MediaKinds'
import { ToneMark } from './NotifyBadge'
import { Recipients } from './Recipients'
import { AreaBadge, StatusBadge } from './StatusBadge'
import { Thumb } from './Thumb'

/** The edge of a row that affects me, in the color of its priority (UD-029); the mark beside the area says it with a shape and a word. */
const EDGE = { red: 'shadow-[inset_4px_0_0_var(--color-tone-red-bg)]', yellow: 'shadow-[inset_4px_0_0_var(--color-tone-yellow-bg)]', blue: 'shadow-[inset_4px_0_0_var(--color-tone-blue-bg)]' } as const

/** Recipients drawn before the rest fold into «+N». */
const RECIPIENTS_SHOWN = 2

/**
 * Message row, in three levels (J1-A-13): the title and its status come first; the extract is support text
 * (12 px, muted, whole, never cut: UD-016); date, media, sender and recipients close it as one line of metadata.
 * The status has its own fixed column, so it lines up row by row (J1-A-15). Responder and Cerrar are real
 * buttons that appear on hover or keyboard focus and are always there on a touch screen (J1-A-16); their slot is
 * reserved, so a row never changes height when they show. The thumbnail keeps its place beside the media icons (UD-016).
 * The whole row leads to the detail; Responder opens it with the form at hand and Cerrar or Reabrir apply instantly.
 * In the `reply` variant it shows the latest reply: its author, its date, its media and its text.
 */
export function MessageCard({ message, variant = 'message' }: { message: Message; variant?: 'message' | 'reply' }) {
  const t = useT()
  const format = useFormat()
  const me = useMe().data
  const { areaTitle, memberName } = useLookups()
  const setClosed = useSetClosed()

  const closed = message.status === 'closed'
  const tone = messageTone(message, me?.id ?? '')
  const isAuthor = me?.id === message.author_id
  const reply = variant === 'reply' ? message.last_reply : null
  // Reply row: the author, the date, the media and the thumbnail are the reply's.
  const from = reply ?? message
  const main = mainAttachment(from.attachments)

  return (
    <article data-affects-me={tone ?? undefined} className={cn('group @container relative border-b border-line last:border-b-0 hover:bg-glass-edge', tone && EDGE[tone])}>
      {/* The layout follows the width of the row, not the window: the same row sits in the full list and in the half columns of Inicio. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1 px-4 py-3 @2xl:grid-cols-[minmax(0,1fr)_9.5rem_3.5rem] @2xl:grid-rows-[auto_auto_1fr]">
      {/* data-repeat-ok: the reply row names the message it answers; that message is listed on its own too. */}
      <h3 data-repeat-ok={reply ? 'reply-names-its-message' : undefined} className="col-start-1 row-start-1 break-words text-sm font-semibold leading-snug">
        <Link
          to={`/messages/${message.id}`}
          className="outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:outline-2 focus-visible:after:outline-accent"
        >
          {message.title}
        </Link>
      </h3>
      <p className="col-start-1 row-start-2 whitespace-normal break-words text-xs text-muted">{reply ? reply.body : message.body}</p>
      <div className="col-span-2 row-start-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted @2xl:col-span-1">
        <AreaBadge title={areaTitle(message.area_id)} />
        {tone && <ToneMark tone={tone} />}
        <span data-repeat-ok="person" className="inline-flex items-center gap-1.5 leading-tight">
          <Avatar name={memberName(from.author_id) || '?'} size={18} />
          {memberName(from.author_id)}
        </span>
        <time dateTime={from.created_at} title={format.fullStamp(from.created_at)} className="tabular-nums">
          {format.stamp(from.created_at)}
        </time>
        <MediaKinds of={from} />
        <Recipients ids={variant === 'message' ? message.assignee_ids : []} max={RECIPIENTS_SHOWN} className="min-w-0 text-xs text-muted empty:hidden">
          {message.reply_count > 0 && (
            <li className="inline-flex items-center gap-1" title={t('card.replies', { n: message.reply_count })}>
              <MessageSquare size={13} aria-hidden />
              {message.reply_count}
            </li>
          )}
        </Recipients>
      </div>

      <div className="col-span-2 row-start-4 flex items-center justify-between gap-2 @2xl:col-span-1 @2xl:col-start-2 @2xl:row-span-3 @2xl:row-start-1 @2xl:flex-col @2xl:items-start @2xl:justify-start @2xl:gap-1.5">
        <StatusBadge status={message.status} />
        <span className="relative z-10 flex items-center gap-1 transition-opacity duration-150 @2xl:-ml-2 @2xl:opacity-0 @2xl:group-focus-within:opacity-100 @2xl:group-hover:opacity-100 [@media(hover:none)]:opacity-100">
          {!isAuthor && !closed && (
            <Button asChild size="sm" variant="ghost" className="px-2 text-xs text-accent-deep">
              <Link to={`/messages/${message.id}?reply=1`}>{t('card.reply')}</Link>
            </Button>
          )}
          <Button size="sm" variant="ghost" className="px-2 text-xs text-muted" disabled={setClosed.isPending} onClick={() => setClosed.mutate({ id: message.id, closed: !closed })}>
            {closed ? t('card.reopen') : t('card.close')}
          </Button>
        </span>
      </div>

      {main && (
        <div className="col-start-2 row-span-2 row-start-1 @2xl:col-start-3 @2xl:row-span-3">
          <Thumb item={{ kind: main.kind, src: main.kind === 'link' ? undefined : (reply ? replyAttachmentUrl : attachmentUrl)(main.id), name: main.name, size: main.size }} px={48} />
        </div>
      )}
      </div>
    </article>
  )
}
