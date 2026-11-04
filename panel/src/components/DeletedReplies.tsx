import { Fold } from '@/components/Fold'
import { Button } from '@/components/ui/button'
import { useErrorText, useFormat, useT } from '@/i18n'
import { firstWords } from '@/lib/first-words'
import { useNotices } from '@/lib/notices'
import { useDeletedReplies, useMe, useRestoreReply } from '@team-platform/client/react'
import { useLookups } from './lookups'

/**
 * «Respuestas borradas» of a message (soft-lock TP-08): the replies deleted from the thread, each with «Restaurar». The Deshacer of the notice lasts 8 s and the
 * row of the thread lives while nothing else is done in the screen; this list does not depend on either. Nothing is drawn while there is none.
 * `except` is the reply the thread already shows as deleted, with its own Deshacer.
 */
export function DeletedReplies({ messageId, except }: { messageId: string; except?: string }) {
  const t = useT()
  const format = useFormat()
  const errorText = useErrorText()
  const notices = useNotices()
  const me = useMe().data
  const { memberName } = useLookups()
  const restore = useRestoreReply()
  const gone = (useDeletedReplies(messageId, !!me).data ?? []).filter((r) => r.id !== except)
  if (gone.length === 0) return null
  return (
    <Fold title={t('replies.deletedList')} note={gone.length} anchor="deleted-replies">
      <ul className="flex flex-col">
        {gone.map((r) => {
          const label = firstWords(r.body, 10) || t('tray.onlyMedia')
          return (
            <li key={r.id} data-deleted-reply={r.id} className="flex min-h-12 items-center justify-between gap-3 border-b border-line py-2 last:border-b-0">
              <span className="flex min-w-0 flex-col">
                <span className="break-words text-sm">{label}</span>
                <span className="text-xs text-muted">
                  <span data-repeat-ok="person">{memberName(r.author_id)}</span> ·{' '}
                  <time dateTime={r.created_at} className="tabular-nums">
                    {format.stamp(r.created_at)}
                  </time>
                </span>
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={restore.isPending}
                aria-label={t('restore.of', { title: label })}
                data-testid="reply-restore"
                data-repeat-ok="per-reply"
                onClick={() => restore.mutate(r.id, { onError: (err) => notices.show({ tone: 'danger', text: errorText(err) }) })}
              >
                {t('restore.action')}
              </Button>
            </li>
          )
        })}
      </ul>
    </Fold>
  )
}
