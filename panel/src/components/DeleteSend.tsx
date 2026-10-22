import { Trash2 } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { useErrorText, useT } from '@/i18n'
import { useNotices } from '@/lib/notices'
import { useDeleteInput, useMe } from '@/lib/queries'
import type { InputRecord } from '@/lib/types'

/**
 * Deletes a send for real (UD-240) with one click and no step that confirms it (UD-253). There is no way back, so the notice says
 * what went, with the count of messages when they went too. A send that already published messages has the two forms side by
 * side: «Borrar» keeps its messages, «Borrar todo» takes them too. The sender sees it on their own sends, the Editor on every one.
 */
export function DeleteSend({ input, onDeleted, className }: { input: InputRecord; onDeleted?: (id: string) => void; className?: string }) {
  const t = useT()
  const errorText = useErrorText()
  const notices = useNotices()
  const me = useMe().data
  const remove = useDeleteInput()
  if (!me || (me.id !== input.author_id && me.role !== 'editor')) return null
  const hasMessages = (input.message_ids?.length ?? input.messages?.length ?? 0) > 0

  const run = async (withMessages: boolean) => {
    let messages = 0
    try {
      messages = (await remove.mutateAsync({ id: input.id, withMessages })).deleted?.messages ?? 0
    } catch (err) {
      notices.show({ tone: 'danger', text: errorText(err) })
      return
    }
    onDeleted?.(input.id)
    notices.show({ text: withMessages ? t('send.deletedWithMessages', { n: messages }) : t('send.deleted') })
  }

  return (
    <span className={`flex flex-wrap items-center gap-1 ${className ?? ''}`}>
      <Button size="sm" variant="ghost" className="hit text-danger" data-testid="delete-send" title={hasMessages ? t('send.deleteHint') : undefined} disabled={remove.isPending} onClick={() => void run(false)}>
        <Trash2 size={13} aria-hidden /> {t('send.delete')}
      </Button>
      {hasMessages && (
        <Button size="sm" variant="ghost" className="hit text-danger" data-testid="delete-send-all" title={t('send.deleteAllHint')} disabled={remove.isPending} onClick={() => void run(true)}>
          {t('send.deleteAll')}
        </Button>
      )}
    </span>
  )
}
