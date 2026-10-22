import { useState } from 'react'
import { Trash2 } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { useErrorText, useT } from '@/i18n'
import { useNotices } from '@/lib/notices'
import { useDeleteInput, useMe } from '@/lib/queries'
import type { InputRecord } from '@/lib/types'

/**
 * Deletes a send for real (UD-240): there is no way back, so the button becomes the step that confirms it, in its place,
 * with no window over the page. A send that already published messages offers the two forms: the messages stay, or they go too.
 * The sender sees it on their own sends, the Editor on every one.
 */
export function DeleteSend({ input, onDeleted, className }: { input: InputRecord; onDeleted?: (id: string) => void; className?: string }) {
  const t = useT()
  const errorText = useErrorText()
  const notices = useNotices()
  const me = useMe().data
  const remove = useDeleteInput()
  const [confirming, setConfirming] = useState(false)
  if (!me || (me.id !== input.author_id && me.role !== 'editor')) return null
  const hasMessages = (input.message_ids?.length ?? input.messages?.length ?? 0) > 0

  const run = async (withMessages: boolean) => {
    try {
      await remove.mutateAsync({ id: input.id, withMessages })
    } catch (err) {
      notices.show({ tone: 'danger', text: errorText(err) })
      setConfirming(false)
      return
    }
    onDeleted?.(input.id)
    notices.show({ text: t('send.deleted') })
  }

  if (!confirming) {
    return (
      <Button size="sm" variant="ghost" className={`hit text-danger ${className ?? ''}`} data-testid="delete-send" onClick={() => setConfirming(true)}>
        <Trash2 size={13} aria-hidden /> {t('send.delete')}
      </Button>
    )
  }
  return (
    <span role="group" aria-label={t('send.deleteGroup')} data-testid="delete-send-confirm" className={`flex flex-wrap items-center gap-1.5 ${className ?? ''}`}>
      <Button size="sm" variant="danger" className="hit" disabled={remove.isPending} onClick={() => void run(false)}>
        {t('send.deleteConfirm')}
      </Button>
      {hasMessages && (
        <Button size="sm" variant="ghost" className="hit text-danger" disabled={remove.isPending} onClick={() => void run(true)}>
          {t('send.deleteWithMessages')}
        </Button>
      )}
      <Button size="sm" variant="ghost" className="hit" disabled={remove.isPending} onClick={() => setConfirming(false)}>
        {t('common.cancel')}
      </Button>
    </span>
  )
}
