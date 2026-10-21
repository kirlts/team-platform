import { MessageSquare } from '@/components/icons'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { useFormat, useT } from '@/i18n'
import { mainAttachment } from '@/lib/media'
import { noticeState } from '@/lib/states'
import { useMe, useSetClosed } from '@/lib/queries'
import { cn } from '@/lib/utils'
import type { Message } from '@/lib/types'
import { AreaChip } from './AreaChip'
import { useLookups } from './lookups'
import { MediaKinds } from './MediaKinds'
import { MediaOpener } from './MediaOpener'
import { StateMark } from './NotifyBadge'
import { Recipients } from './Recipients'

/** The edge of a row, in the color of its state (UD-041): with the mark of the state, the only color of a row (UD-036). */
const EDGE = { open: 'shadow-[inset_3px_0_0_var(--color-state-open-bg)]', answered: 'shadow-[inset_3px_0_0_var(--color-state-answered-bg)]', closed: 'shadow-[inset_3px_0_0_var(--color-state-closed-bg)]' } as const

/** Recipients drawn before the rest fold into «y N más». */
const RECIPIENTS_SHOWN = 2

/**
 * Message row, in three levels (J1-A-13, J3-A-05): the heading comes first; the extract is support text (12 px,
 * muted, whole, never cut: UD-016); one line of metadata closes it, in plain text and not in chips: area, sender,
 * date, media, recipients and replies. What the row says about me is said once, in the column on the right: the
 * state with its shape and its word (open, answered or closed; UD-041), above the two
 * actions. The edge on the left and the shape of the state are the only color of a row. The thumbnail keeps its place at the end (UD-016).
 * Responder and Cerrar are real buttons, always drawn, on every screen and in every list (J2-A-11): a control that
 * shows only under the pointer does not exist for the keyboard or for a touch screen. They sit at the right edge, so
 * a row without Responder (the sender's own) leaves no hole (J3-A-17). The whole row leads to the detail; Responder
 * opens it with the form at hand and Cerrar or Reabrir apply instantly.
 * In the `reply` variant the heading is the latest reply and the support line names the message it answers, so both
 * lists read in the same order: what happened, then where (J3-A-08).
 */
export function MessageCard({ message, variant = 'message', hideArea = false }: { message: Message; variant?: 'message' | 'reply'; hideArea?: boolean }) {
  const t = useT()
  const format = useFormat()
  const me = useMe().data
  const { memberName } = useLookups()
  const setClosed = useSetClosed()

  const closed = message.status === 'closed'
  const affects = noticeState(message, me?.id ?? '')
  const isAuthor = me?.id === message.author_id
  const reply = variant === 'reply' ? message.last_reply : null
  // Reply row: the author, the date, the media and the thumbnail are the reply's.
  const from = reply ?? message
  const main = mainAttachment(from.attachments)

  return (
    <article data-affects-me={affects ?? undefined} data-closed={closed || undefined} className={cn('group @container relative border-b border-line last:border-b-0 hover:bg-glass-edge', EDGE[message.status])}>
      {/* The layout follows the width of the row, not the window: the same row sits in the full list and in the half columns of Inicio. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1 px-4 py-3 @2xl:grid-cols-[minmax(0,1fr)_9.5rem_3rem] @2xl:grid-rows-[auto_auto_1fr]">
      {/* The area is the tab of the card (mockup «Área» above each message): a chip in its own color, before the title. */}
      <div className="col-start-1 row-start-1 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        {!hideArea && <AreaChip areaId={message.area_id} className="shrink-0" />}
        <h3 className={cn('min-w-0 break-words text-sm font-semibold leading-snug', closed && 'font-medium text-muted')}>
          <Link
            to={`/messages/${message.id}`}
            className="outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:outline-2 focus-visible:after:outline-accent"
          >
            {reply && <span className="sr-only">{t('card.replyTo')} «{message.title}»: </span>}
            {reply ? reply.body : message.title}
          </Link>
        </h3>
      </div>
      {/* data-repeat-ok: the reply row names the message it answers; that message is listed on its own too. */}
      <p data-repeat-ok={reply ? 'reply-names-its-message' : undefined} className="col-start-1 row-start-2 whitespace-normal break-words text-xs text-muted" aria-hidden={reply ? true : undefined}>
        {reply ? t('card.inMessage', { title: message.title }) : message.body}
      </p>
      <div className="col-span-2 row-start-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted @2xl:col-span-1">
        <span data-repeat-ok="person">{memberName(from.author_id)}</span>
        <time dateTime={from.created_at} title={format.fullStamp(from.created_at)} className="tabular-nums">
          {format.stamp(from.created_at)}
        </time>
        <MediaKinds of={from} />
        <Recipients ids={variant === 'message' ? message.assignee_ids : []} max={RECIPIENTS_SHOWN} plain className="min-w-0 text-xs text-muted empty:hidden">
          {message.reply_count > 0 && (
            <li className="inline-flex items-center gap-1" title={t('card.replies', { n: message.reply_count })}>
              <MessageSquare size={13} aria-hidden />
              {message.reply_count}
            </li>
          )}
        </Recipients>
      </div>

      <div className="col-span-2 row-start-4 flex items-center justify-between gap-2 @2xl:col-span-1 @2xl:col-start-2 @2xl:row-span-3 @2xl:row-start-1 @2xl:flex-col @2xl:items-stretch @2xl:justify-start @2xl:gap-2">
        <StateMark status={message.status} plain />
        <span className="relative z-10 flex items-center justify-end gap-1">
          {!isAuthor && !closed && (
            <Button asChild size="sm" variant="secondary" className="px-3 text-xs">
              <Link to={`/messages/${message.id}?reply=1`}>{t('card.reply')}</Link>
            </Button>
          )}
          <Button size="sm" variant="ghost" className="px-2 text-xs text-muted" disabled={setClosed.isPending} onClick={() => setClosed.mutate({ id: message.id, closed: !closed })}>
            {closed ? t('card.reopen') : t('card.close')}
          </Button>
        </span>
      </div>

      {main && (
        <div className={cn('relative z-10 col-start-2 row-span-2 row-start-1 @2xl:col-start-3 @2xl:row-span-3', closed && 'opacity-60')}>
          <MediaOpener attachments={from.attachments ?? []} scope={reply ? 'reply' : 'message'} px={40} />
        </div>
      )}
      </div>
    </article>
  )
}
