import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, ChevronDown, Trash2 } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { useFormat, useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type { MessageDetail, ProgressNote, Reply } from '@team-platform/client'
import { useDeleteReply, useEditReply, useMe, useRestoreReply } from '@team-platform/client/react'
import { useUndo } from '@/lib/undo'
import { Avatar } from './Avatar'
import { CloseMessage } from './CloseMessage'
import { EditableText } from './EditableText'
import { Markdown } from '@/lib/markdown'
import { ReplyMedia } from './ReplyMedia'
import { ReplyTools } from './ReplyTools'
import { RetryExecute } from './RetryExecute'
import { PublishIdea } from './PublishIdea'
import { useLookups } from './lookups'
import { canReplyTo } from '@/lib/handoff'
import { ReplyForm } from './ReplyForm'

/** The thread shows every reply up to this many; past it, the first one and the last `THREAD_TAIL` show and the rest fold behind a count. */
const THREAD_LIMIT = 5
const THREAD_TAIL = 3

/** A row of the thread: a reply, or the place where one was just deleted, with Deshacer in it (UD-240, as the templates do). */
type ReplyItem = { kind: 'reply'; reply: Reply } | { kind: 'removed'; reply: Reply } | { kind: 'progress'; note: ProgressNote }

/** The key of a row, and its place in time: replies and progress notices share the thread by `created_at` (UD-293). */
const itemKey = (x: ReplyItem) => (x.kind === 'progress' ? `progress-${x.note.id}` : `${x.kind}-${x.reply.id}`)

/**
 * Replies of a message: one under another in order, joined by a vertical line, with the last one set apart; past `THREAD_LIMIT` the first and
 * the last ones show and a control between them opens the hidden ones. The form stays at the foot, in view. The sender does not reply to their own message: they do not see the form.
 * The author of a reply or any person of the team deletes it (UD-240, UD-287): no dialog, the row says it was deleted and Deshacer brings it back.
 * Only the author edits its text in place (UD-253), as the sender edits a message (UD-071): the text is the control, and each
 * save is an operation of the screen's undo stack. Nobody else sees it editable.
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
  const canDelete = (_r: Reply) => !!me
  const canEdit = (r: Reply) => !!me && me.id === r.author_id
  /** A reply with attachments may be left without text; one without them may not (the API answers 400 `reply_empty`). */
  const bodyRule = (r: Reply) => (v: string) => (v || (r.attachments ?? []).length > 0 ? null : t('common.required'))
  const changeText = (reply: Reply, next: string) =>
    undo.run({ label: t('replies.textEdited'), redo: () => edit.mutateAsync({ replyId: reply.id, body: next }), undo: () => edit.mutateAsync({ replyId: reply.id, body: reply.body }) })
  /** The reply just deleted, where it was, and the size of the history after deleting it: it stays while nothing else was done. */
  const [removed, setRemoved] = useState<{ reply: Reply; index: number; mark: number } | null>(null)
  const showRemoved = removed && removed.reply.message_id === message.id && undo.undoCount === removed.mark
  // Every reply of the thread is drawn, in order (UD-296): a notice that a retry replaced stays once that job ended, as a previous attempt does in a pipeline.
  // Hiding it assumed the retry always left a notice of its own, and a delivery that failed the same way left none: the last reply of message 117 vanished.
  const shown = message.replies
  const rows = useMemo<ReplyItem[]>(() => {
    const items: ReplyItem[] = shown.map((reply) => ({ kind: 'reply', reply }))
    if (showRemoved) items.splice(Math.min(removed.index, items.length), 0, { kind: 'removed', reply: removed.reply })
    // A progress notice goes after the last row that is older than it: replies keep their order and the notice lands between them (UD-293).
    for (const note of message.progress_notes ?? []) {
      let at = items.length
      while (at > 0 && items[at - 1]!.kind !== 'progress' && Date.parse((items[at - 1] as { reply: Reply }).reply.created_at) > Date.parse(note.created_at)) at -= 1
      items.splice(at, 0, { kind: 'progress', note })
    }
    return items
  }, [shown, removed, showRemoved, message.progress_notes])
  const [expanded, setExpanded] = useState(false)
  // The limit counts replies: a notice is not one, so it never makes a short thread fold. A notice between two folded replies folds with them.
  const replyRows = rows.filter((x) => x.kind !== 'progress').length
  const foldedReplies = !expanded && replyRows > THREAD_LIMIT ? replyRows - 1 - THREAD_TAIL : 0
  const hidden = useMemo(() => {
    let seen = 0
    return rows.map((x) => {
      if (x.kind === 'progress') return foldedReplies > 0 && seen >= 1 && seen <= foldedReplies
      seen += 1
      return foldedReplies > 0 && seen > 1 && seen <= foldedReplies + 1
    })
  }, [rows, foldedReplies])
  const folded = foldedReplies
  const lastReplyKey = [...rows].reverse().find((x) => x.kind !== 'progress')
  const firstHidden = hidden.indexOf(true)
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
  // A state that changes because somebody else closed or reopened the message arrives through the event stream and must not move the
  // page: only a button pressed at the foot (Cerrar, Reabrir, Responder) brings the foot into the window.
  const pressedAtFoot = useRef(false)
  const status = useRef(message.status)
  useEffect(() => {
    if (status.current === message.status) return
    status.current = message.status
    if (!pressedAtFoot.current) return
    pressedAtFoot.current = false
    foot.current?.scrollIntoView?.({ block: 'nearest' })
  }, [message.status])

  return (
    <section aria-label={t('replies.title')} className="flex min-h-0 flex-1 flex-col gap-3 md:flex-initial">
      {rows.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-muted">{t('replies.none')}</p>
      ) : (
        <div data-lane="reply-thread" className="scroll-thin min-h-0 md:flex-initial md:overflow-y-auto md:pr-1">
          <ol className="thread relative flex flex-col gap-3">
            <span aria-hidden className="thread-line absolute bottom-4 left-4 top-4 w-px -translate-x-1/2 bg-line-strong" />
            {rows.map((x, i) => {
              if (hidden[i]) {
                if (i !== firstHidden) return null
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
              const last = x === lastReplyKey
              const key = itemKey(x)
              // A progress notice (UD-293): a quiet row with the time and what Claude reports, between the message and the final answer. It stays when the answer arrives.
              if (x.kind === 'progress') {
                const lines = x.note.body.split('\n')
                return (
                  <li key={key} data-testid="progress-note" className="relative flex gap-3">
                    <span aria-hidden className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bg ring-4 ring-bg">
                      <span className="h-2 w-2 rounded-full bg-accent" />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-1 text-xs text-muted">
                      <div className="flex flex-wrap items-baseline gap-x-2.5">
                        <time dateTime={x.note.created_at} className="tabular-nums">
                          {format.stamp(x.note.created_at)}
                        </time>
                        <span className="font-medium tabular-nums text-fg">{lines[0]}</span>
                      </div>
                      {lines.slice(1).map((line, n) => (
                        <span key={n} className="break-words">
                          {line}
                        </span>
                      ))}
                    </div>
                  </li>
                )
              }
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
                    <span aria-hidden className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--notice-bg)] text-[var(--notice-ink)] ring-4 ring-bg">
                      <ArrowRight size={16} />
                    </span>
                    <article data-testid="forward-notice" className="flex min-w-0 flex-1 flex-col gap-1 rounded-lg border-l-[length:var(--notice-edge-width)] border-accent bg-[var(--notice-bg)] px-3 py-2">
                      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-xs text-muted">
                        <span className="break-words text-sm font-semibold text-[var(--notice-ink)]">{t('forward.strip', { name: r.forwarded_to ? memberName(r.forwarded_to) : '' })}</span>
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
              return (
                <li key={key} className="relative flex gap-3" data-last={last || undefined}>
                  <Avatar name={memberName(r.author_id) || '?'} size={32} className="relative z-10 ring-4 ring-bg" />
                  <article className={cn('reply-card flex min-w-0 flex-1 flex-col gap-1 rounded-lg px-3 py-2.5', last ? 'glass reply-card-last' : 'reply-card-quiet')}>
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted">
                      <span data-repeat-ok="person" className="break-words text-sm font-semibold text-fg">{memberName(r.author_id)}</span>
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
                    {canEdit(r) && !r.body ? null /* a reply of only an audio or photo has no text to fill in (UD-279) */ : canEdit(r) ? (
                      <EditableText value={r.body} label={t('replies.body')} multiline validate={bodyRule(r)} onSave={(v) => changeText(r, v)} displayClassName={last ? 'text-emph' : 'text-sm'} render={(v) => <Markdown source={v} breaks mentions={mentionNames(r)} />} />
                    ) : r.publishable && message.status !== 'closed' ? (
                      <PublishIdea messageId={message.id}>
                        <Markdown source={r.body} breaks mentions={mentionNames(r)} className={cn('break-words', last ? 'text-emph' : 'text-sm')} />
                      </PublishIdea>
                    ) : (r.retryable && message.status !== 'closed') || r.retrying ? (
                      <RetryExecute messageId={message.id} reply={r}>
                        <Markdown source={r.body} breaks mentions={mentionNames(r)} className={cn('break-words', last ? 'text-emph' : 'text-sm')} />
                      </RetryExecute>
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
      <div ref={foot} className="shrink-0 scroll-mb-4" onClickCapture={(e) => { if ((e.target as HTMLElement).closest('button')) pressedAtFoot.current = true }}>
      {canReply || (message.status !== 'closed' && !!me) ? (
        // The sender does not answer their own message, but may write in the thread to call someone with «@» (UD-278): the form is the same and asks for a mention.
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
