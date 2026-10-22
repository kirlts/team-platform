import { useEffect, useMemo, useRef, useState } from 'react'
import { Trash2 } from '@/components/icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useFormat, useT } from '@/i18n'
import { useDeleteReply, useMe, useRestoreReply } from '@/lib/queries'
import type { MessageDetail, Reply } from '@/lib/types'
import { useUndo } from '@/lib/undo'
import { Avatar } from './Avatar'
import { CloseMessage } from './CloseMessage'
import { AttachmentStrip } from './AttachmentStrip'
import { FitList } from './FitList'
import { useLookups } from './lookups'
import { KIND_KEY, ReplyForm } from './ReplyForm'

/** A row of the thread: a reply, or the place where one was just deleted, with Deshacer in it (UD-240, as the templates do). */
type ReplyItem = { kind: 'reply'; reply: Reply } | { kind: 'removed'; reply: Reply }

/**
 * Replies of a message: the list fits its frame and paginates; the form stays at the foot, in
 * view. The sender does not reply to their own message: they do not see the form.
 * The author of a reply or the Editor deletes it (UD-240): no dialog, the row says it was deleted and Deshacer brings it back.
 */
export function ReplyThread({ message, focusForm }: { message: MessageDetail; focusForm?: boolean }) {
  const t = useT()
  const format = useFormat()
  const me = useMe().data
  const { memberName } = useLookups()
  const undo = useUndo()
  const del = useDeleteReply(message.id)
  const restore = useRestoreReply()
  const canReply = !!me && me.id !== message.author_id && message.status !== 'closed'
  const canDelete = (r: Reply) => !!me && (me.id === r.author_id || me.role === 'editor')
  /** The reply just deleted, where it was, and the size of the history after deleting it: it stays while nothing else was done. */
  const [removed, setRemoved] = useState<{ reply: Reply; index: number; mark: number } | null>(null)
  const showRemoved = removed && removed.reply.message_id === message.id && undo.undoCount === removed.mark
  const rows = useMemo<ReplyItem[]>(() => {
    const items: ReplyItem[] = message.replies.map((reply) => ({ kind: 'reply', reply }))
    if (showRemoved) items.splice(Math.min(removed.index, items.length), 0, { kind: 'removed', reply: removed.reply })
    return items
  }, [message.replies, removed, showRemoved])
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
      {/* The slot does not grow: the form follows the last reply instead of sitting at the foot of the screen (J1-A-24). */}
      <FitList
        className="flex-initial"
        rows={rows}
        rowKey={(x) => `${x.kind}-${x.reply.id}`}
        renderRow={(x) =>
          x.kind === 'removed' ? (
            <article role="status" className="flex items-center justify-between gap-3 border-b border-line bg-hover px-3 py-3 last:border-b-0">
              <span className="min-w-0 break-words text-sm text-muted">{t('replies.deletedRow', { name: memberName(x.reply.author_id) })}</span>
              <Button size="sm" variant="secondary" onClick={() => void undo.undo()}>
                {t('undo.undo')}
              </Button>
            </article>
          ) : (
            <article className="flex gap-3 border-b border-line px-3 py-3 last:border-b-0">
              <Avatar name={memberName(x.reply.author_id) || '?'} size={28} />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted">
                  <span data-repeat-ok="person" className="break-words text-sm font-semibold text-fg">{memberName(x.reply.author_id)}</span>
                  {x.reply.kind !== 'answer' && <Badge tone={'neutral'}>{t(KIND_KEY[x.reply.kind])}</Badge>}
                  <time dateTime={x.reply.created_at} className="tabular-nums">
                    {format.stamp(x.reply.created_at)}
                  </time>
                  {canDelete(x.reply) && (
                    <Button size="icon-sm" variant="ghost" className="-my-1.5 ml-auto shrink-0 text-muted hover:text-danger" aria-label={t('replies.delete')} title={t('replies.delete')} disabled={del.isPending} onClick={() => void remove(x.reply)}>
                      <Trash2 size={14} aria-hidden />
                    </Button>
                  )}
                </div>
                {x.reply.body && <p className="prose-block whitespace-pre-wrap break-words text-sm">{x.reply.body}</p>}
                <AttachmentStrip items={x.reply.attachments ?? []} scope="reply" px={36} named className="pt-0.5" />
              </div>
            </article>
          )
        }
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
