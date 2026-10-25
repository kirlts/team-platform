import { MessageSquare } from '@/components/icons'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { useFormat, useT } from '@/i18n'
import { kindsOf, mainAttachment } from '@/lib/media'
import { noticeState } from '@/lib/states'
import { useNotices } from '@/lib/notices'
import { useSelectionScope } from '@/lib/selection'
import type { Message } from '@team-platform/client'
import { useDeleteMessage, useMe, usePrefetchMessage, useRestoreMessage, useSetClosed } from '@team-platform/client/react'
import { cn } from '@/lib/utils'
import { AreaChip } from './AreaChip'
import { AssessmentMarks } from './AssessmentMarks'
import { useLookups } from './lookups'
import { MediaKinds } from './MediaKinds'
import { MediaOpener } from './MediaOpener'
import { StateMark } from './NotifyBadge'
import { Recipients } from './Recipients'
import { RowCheck } from './SelectionBar'
import { plainText } from '@/lib/first-words'

/** The edge of a row, in the color of its state (UD-041): with the mark of the state, the only color of a row (UD-036). */
// The width of the edge is a theme variable (`--card-edge-width`, 0 draws none).
const EDGE = { open: 'shadow-[inset_var(--card-edge-width)_0_0_var(--color-state-open-bg)]', answered: 'shadow-[inset_var(--card-edge-width)_0_0_var(--color-state-answered-bg)]', closed: 'shadow-[inset_var(--card-edge-width)_0_0_var(--color-state-closed-bg)]' } as const

/** Recipients drawn before the rest fold into «y N más». */
const RECIPIENTS_SHOWN = 2

/** The heading: one line ended with an ellipsis as well (UD-241, amended 2026-10-21), so the extract, the state and every datum below fall at the same y in every row. The whole text is the tooltip and the detail. */
export const HEADING = 'min-w-0 truncate text-sm font-semibold leading-snug' // justified: UD-241 amends UD-016 for the heading of a row of a list; on a phone too (Martín, 2026-10-24)

/** The extract: one line ended with an ellipsis, the one text the interface cuts, so every row measures the same. The whole text is the tooltip and the detail. */
const EXTRACT = 'min-w-0 truncate text-xs text-muted' // justified: UD-241 amends UD-016 for the extract of a row of a list; on a phone too (Martín, 2026-10-24)

/**
 * Message row, one grid for every row of every list (UD-241): every row measures the same and each datum falls at the same y and x in
 * all of them, so a list reads at a glance. From top to bottom, in four lines of fixed height («Tarjeta de lista» in DISENO.md):
 *   1. the text block, 64 px: the heading, dominant (15 px, semibold), up to two lines, and under it the extract, muted (12 px), one line
 *      ended with an ellipsis: the one text the interface cuts (UD-241 amends UD-016); the whole text is the tooltip and is read in the detail.
 *      A heading of three lines or more grows the row, never cut (UD-016);
 *   2. the state (its shape, its color and its word: UD-041) and the area chip (its color only in the chip: UD-045);
 *   3. who, when, and at the right edge the media icons and the count of replies (UD-016), under the thumbnail;
 *   4. who it is for; in the stacked layout this line also holds the two actions.
 * The thumbnail column is always there, with or without media, so the text column has one width in every row. Responder and Cerrar are
 * real buttons, always drawn (J2-A-11); they sit at the right edge, so a row without Responder leaves no hole (J3-A-17). The whole
 * row leads to the detail. In the `reply` variant the heading is the latest reply and the extract names the message it answers (J3-A-08).
 * The layout follows the width of the row (container query), not the window: the same row sits in the full list and in the half columns of Inicio.
 */
export function MessageCard({ message, variant = 'message', hideArea = false }: { message: Message; variant?: 'message' | 'reply'; hideArea?: boolean }) {
  const t = useT()
  const format = useFormat()
  const me = useMe().data
  const { memberName } = useLookups()
  const setClosed = useSetClosed()
  const del = useDeleteMessage()
  const restore = useRestoreMessage()
  const prefetch = usePrefetchMessage()
  const notices = useNotices()
  // In a list that marks rows (UD-253) every row keeps the gutter of the check box, so the text starts at the same x with or without one.
  const selection = useSelectionScope()

  const closed = message.status === 'closed'
  const affects = noticeState(message, me?.id ?? '')
  const isAuthor = me?.id === message.author_id
  const reply = variant === 'reply' ? message.last_reply : null
  // Reply row: the author, the date, the media and the thumbnail are the reply's.
  const from = reply ?? message
  const main = mainAttachment(from.attachments)
  // The sender or any person of the team deletes from the row itself (UD-240, UD-287): it is done and the strip carries Deshacer. Never on the row of a reply.
  const canDelete = variant === 'message' && !!me
  const remove = async () => {
    await del.mutateAsync(message.id)
    notices.show({
      text: t('detail.deleted'),
      action: {
        label: t('undo.undo'),
        run: async () => {
          await restore.mutateAsync(message.id)
          notices.show({ text: t('detail.restored'), link: { to: `/messages/${message.id}`, label: message.title } })
        },
      },
    })
  }
  // A deleted message (the «Borrados» filter) has no detail to lead to, so it has no link: the one action is Restaurar (UD-250).
  const gone = !!message.deleted_at
  const bringBack = async () => {
    await restore.mutateAsync(message.id)
    notices.show({ text: t('detail.restored'), link: { to: `/messages/${message.id}`, label: message.title } })
  }
  const extract = reply ? t('card.inMessage', { title: message.title }) : message.body

  return (
    <article data-affects-me={affects ?? undefined} data-closed={closed || undefined} data-deleted={gone || undefined} data-marked={selection?.isMarked(message.id) || undefined} className={cn('group @container relative border-b border-line last:border-b-0 hover:bg-glass-edge data-[marked]:bg-selected', EDGE[message.status])}>
      <div className={cn('grid grid-cols-[minmax(0,1fr)_2.5rem] grid-rows-[auto_auto_auto_auto] items-start gap-x-4 gap-y-1 py-3 pr-4 @2xl:grid-cols-[minmax(0,1fr)_14rem_2.5rem]', selection ? 'pl-10' : 'pl-4')}>
      {/* The text block has one height in every row (`--spacing-card-text`): two lines of heading and the extract. A one-line heading leaves its air under the extract, between the groups and not inside the paragraph. */}
      <div data-testid="card-text" className="col-start-1 row-start-1 flex min-h-card-text min-w-0 flex-col gap-y-1">
        <h3 title={reply ? plainText(reply.body) : message.title} data-ellipsis-ok="UD-241" className={cn(HEADING, (closed || gone) && 'font-medium text-muted')}>
          {gone ? (
            message.title
          ) : (
            <Link
              to={`/messages/${message.id}`}
              onPointerEnter={() => prefetch(message.id, message.area_id)}
              onFocus={() => prefetch(message.id, message.area_id)}
              className="outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:outline-2 focus-visible:after:outline-accent"
            >
              {reply && <span className="sr-only">{t('card.replyTo')} «{message.title}»: </span>}
              {reply ? plainText(reply.body) : message.title}
            </Link>
          )}
        </h3>
        {/* data-repeat-ok: the reply row names the message it answers; that message is listed on its own too. data-ellipsis-ok: the detectors of cut text skip this line (UD-241). */}
        <p data-testid="card-extract" data-repeat-ok={reply ? 'reply-names-its-message' : undefined} data-ellipsis-ok="UD-241" title={extract} aria-hidden={reply ? true : undefined} className={EXTRACT}>
          {extract}
        </p>
      </div>
      {/* The state opens its line and not the column of actions: «Respondido» next to «Responder» read as one thing said twice (J4-A-home-02). */}
      <div data-testid="card-state" className="col-start-1 row-start-2 flex min-w-0 flex-nowrap items-center gap-x-3 text-xs text-muted [&_.guard-mark]:py-0 [&_.guard-mark]:leading-4">
        <StateMark status={message.status} plain className="min-h-0 shrink-0 px-0" />
        {/* One line in every card (V9): on a phone a long area name ends in «…» before the row grows. */}
        {!hideArea && <AreaChip areaId={message.area_id} title={undefined} className="min-w-0 truncate" />} {/* justified: UD-241, one line per card */}
        {variant === 'message' && !gone && <AssessmentMarks message={message} />}
        {/* The number of the message, as a tracker shows it (#115): the team refers to messages by it. Secondary text at the right edge of the state line, which has the room the line of the author lacks on a phone, so the row keeps its height. */}
        <span data-testid="card-number" className="ml-auto shrink-0 tabular-nums">#{message.id}</span>
      </div>
      <div data-testid="card-who" className="col-start-1 row-start-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span data-repeat-ok="person">{memberName(from.author_id)}</span>
        <time dateTime={from.created_at} title={format.fullStamp(from.created_at)} className="tabular-nums">
          {format.stamp(from.created_at)}
        </time>
        {/* The media and the replies, as one unit, take the right edge of the text column, under the thumbnail: the same x in every row. */}
        {(message.reply_count > 0 || kindsOf(from).length > 0) && (
          <span className="ml-auto inline-flex items-center gap-3">
            <MediaKinds of={from} />
            {message.reply_count > 0 && (
              <span className="inline-flex items-center gap-1" title={t('card.replies', { n: message.reply_count })}>
                <MessageSquare size={16} aria-hidden />
                {message.reply_count}
              </span>
            )}
          </span>
        )}
      </div>

      {/* The last line: who it is for on the left (kept, even empty, so every row has the line; long names wrap inside their own column), the two actions pinned to the right of the first line; in the wide layout the actions leave for their own column. */}
      <div data-testid="card-foot" className="col-span-2 row-start-4 grid min-h-7 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 @2xl:contents">
        <Recipients ids={variant === 'message' ? message.assignee_ids : []} max={RECIPIENTS_SHOWN} plain className="min-h-7 min-w-0 content-center text-xs text-muted @2xl:col-start-1 @2xl:row-start-4 @2xl:min-h-[1lh] @2xl:content-normal" />
        <span className="relative z-10 ml-auto flex items-center justify-end gap-1 @2xl:col-start-2 @2xl:row-span-4 @2xl:row-start-1 @2xl:self-start">
          {gone && (
            <Button size="sm" variant="secondary" className="px-3 text-xs" disabled={restore.isPending} aria-label={t('restore.of', { title: message.title })} data-testid="card-restore" onClick={() => void bringBack()}>
              {t('restore.action')}
            </Button>
          )}
          {!gone && canDelete && (
            // The rare action, apart from the two of the conversation and quiet at rest; it is done at once and the notice carries Deshacer.
            <Button size="sm" variant="ghost" className="px-1.5 text-xs text-muted hover:text-danger" disabled={del.isPending} aria-label={t('card.deleteOf', { title: message.title })} data-testid="card-delete" onClick={() => void remove()}>
              {t('card.delete')}
            </Button>
          )}
          {!gone && !isAuthor && !closed && (
            <Button asChild size="sm" variant="secondary" className="px-3 text-xs">
              <Link to={`/messages/${message.id}?reply=1`}>{t('card.reply')}</Link>
            </Button>
          )}
          {!gone && <Button size="sm" variant="ghost" className="px-2 text-xs text-muted" disabled={setClosed.isPending} onClick={() => setClosed.mutate({ id: message.id, closed: !closed })}>
            {closed ? t('card.reopen') : t('card.close')}
          </Button>}
        </span>
      </div>

      {/* The thumbnail column exists in every row (UD-241): a row without media keeps the same text width as one with it. */}
      <div data-testid="card-thumb" className={cn('relative z-10 col-start-2 row-start-1 size-10 @2xl:col-start-3', closed && 'opacity-60')}>
        {main && <MediaOpener attachments={from.attachments ?? []} scope={reply ? 'reply' : 'message'} px={40} />}
      </div>
      </div>
      {/* After the grid, so the grid stays the first child of the row; drawn in the gutter, over the link that covers the row. */}
      {selection && selection.canMark(message.id) && <RowCheck id={message.id} title={message.title} selection={selection} />}
    </article>
  )
}
