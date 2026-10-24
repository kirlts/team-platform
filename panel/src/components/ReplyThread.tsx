import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, ChevronDown, Trash2 } from '@/components/icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useFormat, useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type { MessageDetail, Reply } from '@team-platform/client'
import { useDeleteReply, useEditReply, useMe, useRestoreReply } from '@team-platform/client/react'
import { useUndo } from '@/lib/undo'
import { Avatar } from './Avatar'
import { CloseMessage } from './CloseMessage'
import { EditableText } from './EditableText'
import { Markdown } from '@/lib/markdown'
import { ReplyMedia } from './ReplyMedia'
import { ReplyTools } from './ReplyTools'
import { useLookups } from './lookups'
import { canReplyTo } from '@/lib/handoff'
import { ReplyForm } from './ReplyForm'

/** The thread shows every reply up to this many; past it, the first one and the last `THREAD_TAIL` show and the rest fold behind a count. */
const THREAD_LIMIT = 5
const THREAD_TAIL = 3

/** A row of the thread: a reply, or the place where one was just deleted, with Deshacer in it (UD-240, as the templates do). */
type ReplyItem = { kind: 'reply'; reply: Reply } | { kind: 'removed'; reply: Reply }

/**
 * Replies of a message: one under another in order, joined by a vertical line, with the last one set apart; past `THREAD_LIMIT` the first and
 * the last ones show and a control between them opens the hidden ones. The form stays at the foot, in view. The sender does not reply to their own message: they do not see the form.
 * The author of a reply or the Editor deletes it (UD-240): no dialog, the row says it was deleted and Deshacer brings it back.
 * Only the author edits its text in place (UD-253), as the sender edits a message (UD-071): the text is the control, and each
 * save is an operation of the screen's undo stack. Nobody else, the Editor included, sees it editable.
 */
export function ReplyThread({ message, focusForm }: { message: MessageDetail; focusForm?: boolean }) {
  const t = useT()
  const format = useFormat()
  const me = useMe().data
  const { memberName, members } = useLookups()
  const undo = useUndo()
  const del = useDeleteReply(message.id)
  const restore = useRestoreReply()
  const edit = useEditReply(message.id)
  const canReply = canReplyTo(message, me?.id, members) // the sender too, while they hold the question of a handoff (UD-269)
  /** The names of the members the reply mentions (a list of ids chosen in the form): their tokens are drawn highlighted. */
  const mentionNames = (r: Reply) => (r.mentions ?? []).map((id) => memberName(id)).filter(Boolean)
  const canDelete = (r: Reply) => !!me && (me.id === r.author_id || me.role === 'editor')
  const canEdit = (r: Reply) => !!me && me.id === r.author_id
  /** A reply with attachments may be left without text; one without them may not (the API answers 400 `reply_empty`). */
  const bodyRule = (r: Reply) => (v: string) => (v || (r.attachments ?? []).length > 0 ? null : t('common.required'))
  const changeText = (reply: Reply, next: string) =>
    undo.run({ label: t('replies.textEdited'), redo: () => edit.mutateAsync({ replyId: reply.id, body: next }), undo: () => edit.mutateAsync({ replyId: reply.id, body: reply.body }) })
  /** The reply just deleted, where it was, and the size of the history after deleting it: it stays while nothing else was done. */
  const [removed, setRemoved] = useState<{ reply: Reply; index: number; mark: number } | null>(null)
  const showRemoved = removed && removed.reply.message_id === message.id && undo.undoCount === removed.mark
  const rows = useMemo<ReplyItem[]>(() => {
    const items: ReplyItem[] = message.replies.map((reply) => ({ kind: 'reply', reply }))
    if (showRemoved) items.splice(Math.min(removed.index, items.length), 0, { kind: 'removed', reply: removed.reply })
    return items
  }, [message.replies, removed, showRemoved])
  const [expanded, setExpanded] = useState(false)
  const folded = !expanded && rows.length > THREAD_LIMIT ? rows.length - 1 - THREAD_TAIL : 0
  const remove = (reply: Reply) => {
    const index = message.replies.findIndex((x) => x.id === reply.id)
    const mark = undo.undoCount + 1
    return undo
      .run({ label: t('replies.deleted'), redo: () => del.mutateAsync(reply.id), undo: () => restore.mutateAsync(reply.id) })
      .then(() => setRemoved({ reply, index, mark }))
  }
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
      {rows.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-muted">{t('replies.none')}</p>
      ) : (
        <div data-lane="reply-thread" className="scroll-thin min-h-0 md:flex-initial md:overflow-y-auto md:pr-1">
          <ol className="thread relative flex flex-col gap-3">
            <span aria-hidden className="thread-line absolute bottom-4 left-4 top-4 w-px -translate-x-1/2 bg-line-strong" />
            {rows.map((x, i) => {
              if (folded > 0 && i > 0 && i <= folded) {
                if (i > 1) return null
                return (
                  <li key="folded" className="relative flex items-center gap-3">
                    <span aria-hidden className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bg text-muted ring-4 ring-bg">
                      <ChevronDown size={16} />
                    </span>
                    <Button size="sm" variant="secondary" onClick={() => setExpanded(true)}>
                      {t('replies.more', { n: folded })}
                    </Button>
                  </li>
                )
              }
              const last = i === rows.length - 1
              const key = `${x.kind}-${x.reply.id}`
              if (x.kind === 'removed') {
                return (
                  <li key={key} className="relative flex gap-3">
                    <span aria-hidden className="relative z-10 h-8 w-8 shrink-0 rounded-full bg-bg ring-4 ring-bg" />
                    <article role="status" className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-lg bg-hover px-3 py-2">
                      <span className="min-w-0 break-words text-sm text-muted">{t('replies.deletedRow', { name: memberName(x.reply.author_id) })}</span>
                      <Button size="sm" variant="secondary" onClick={() => void undo.undo()}>
                        {t('undo.undo')}
                      </Button>
                    </article>
                  </li>
                )
              }
              const r = x.reply
              // A forward is a notice of the thread, not a reply: a flat strip with the arrow where the avatar goes, the member it went to, and the reason under it (UD-272).
              if (r.kind === 'forward') {
                return (
                  <li key={key} className="relative flex gap-3" data-last={last || undefined}>
                    <span aria-hidden className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-deep ring-4 ring-bg">
                      <ArrowRight size={16} />
                    </span>
                    <article data-testid="forward-notice" className="flex min-w-0 flex-1 flex-col gap-1 rounded-lg border-l-2 border-accent bg-accent-soft px-3 py-2">
                      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-xs text-muted">
                        <span className="break-words text-sm font-semibold text-accent-deep">{t('forward.strip', { name: r.forwarded_to ? memberName(r.forwarded_to) : '' })}</span>
                        <span data-repeat-ok="person">{t('forward.by', { name: memberName(r.author_id) })}</span>
                        <time dateTime={r.created_at} className="tabular-nums">
                          {format.stamp(r.created_at)}
                        </time>
                      </div>
                      <Markdown source={r.body} breaks className="break-words text-sm" />
                    </article>
                  </li>
                )
              }
              const handoffQuestion = r.kind === 'clarification' && members.some((m) => m.id === r.author_id && m.kind === 'agent')
              return (
                <li key={key} className="relative flex gap-3" data-last={last || undefined}>
                  <Avatar name={memberName(r.author_id) || '?'} size={32} className="relative z-10 ring-4 ring-bg" />
                  <article className={cn('reply-card flex min-w-0 flex-1 flex-col gap-1 rounded-lg px-3 py-2.5', last ? 'glass reply-card-last' : 'reply-card-quiet')}>
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted">
                      <span data-repeat-ok="person" className="break-words text-sm font-semibold text-fg">{memberName(r.author_id)}</span>
                      {handoffQuestion && <Badge tone="neutral">{t('replies.question')}</Badge>}
                      <time dateTime={r.created_at} className="tabular-nums">
                        {format.stamp(r.created_at)}
                      </time>
                      {r.edited_at && (
                        <time dateTime={r.edited_at} data-testid="reply-edited" className="tabular-nums">
                          {t('replies.edited', { when: format.stamp(r.edited_at) })}
                        </time>
                      )}
                      {canDelete(r) && (
                        <Button size="icon-sm" variant="ghost" className="-my-1.5 ml-auto shrink-0 text-muted hover:text-danger" aria-label={t('replies.delete')} title={t('replies.delete')} disabled={del.isPending} onClick={() => void remove(r)}>
                          <Trash2 size={14} aria-hidden />
                        </Button>
                      )}
                    </div>
                    {canEdit(r) && !r.body ? null /* a reply of only an audio or photo has no text to fill in (UD-278) */ : canEdit(r) ? (
                      <EditableText value={r.body} label={t('replies.body')} multiline validate={bodyRule(r)} onSave={(v) => changeText(r, v)} displayClassName={last ? 'text-emph' : 'text-sm'} render={(v) => <Markdown source={v} breaks mentions={mentionNames(r)} />} />
                    ) : (
                      r.body && <Markdown source={r.body} breaks mentions={mentionNames(r)} className={cn('break-words', last ? 'text-emph' : 'text-sm')} />
                    )}
                    <ReplyMedia items={r.attachments ?? []} tools={canEdit(r) && message.status !== 'closed' ? <ReplyTools message={message} reply={r} /> : undefined} />
                  </article>
                </li>
              )
            })}
          </ol>
        </div>
      )}
      <div ref={foot} className="shrink-0 scroll-mb-4">
      {canReply || (message.status !== 'closed' && !!me) ? (
        // The sender does not answer their own message, but may write in the thread to call someone with «@» (UD-277): the form is the same and asks for a mention.
        <ReplyForm messageId={message.id} autoFocus={focusForm} senderMode={!canReply} onSent={() => setSentAt(message.replies.length)}>
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
