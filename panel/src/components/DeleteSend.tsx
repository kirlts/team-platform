import { Trash2 } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { useErrorText, useT } from '@/i18n'
import { useNotices } from '@/lib/notices'
import type { InputRecord } from '@team-platform/client'
import { useDeleteInput, useMe, useRestoreInput } from '@team-platform/client/react'

/**
 * Deletes a send with one click and no step that confirms it (UD-253), and the notice offers Deshacer (the server keeps the send until it is purged,
 * UD-253 «lo reversible ofrece Deshacer»). «Borrar envío» keeps the messages the send published; when it has any, «Borrar envío y mensajes» is drawn beside it, with its own
 * label (a person with a finger has no tooltip), and takes them to the trash with it. It is the one that takes more, so it is the quieter of the two (muted until the pointer is on it) and a group apart. The notice of each says what became of the messages. Any person of the team sees it, on every send (UD-287).
 * `onDeleted(id)` tells the page the send is gone; `onDeleted(id, true)`, that it came back.
 */
export function DeleteSend({ input, onDeleted, className }: { input: InputRecord; onDeleted?: (id: string, back?: boolean) => void; className?: string }) {
  const t = useT()
  const errorText = useErrorText()
  const notices = useNotices()
  const me = useMe().data
  const remove = useDeleteInput()
  const restore = useRestoreInput()
  if (!me) return null
  const kept = input.message_ids?.length ?? input.messages?.length ?? 0
  const hasMessages = kept > 0

  const run = async (withMessages: boolean) => {
    let messages = 0
    try {
      messages = (await remove.mutateAsync({ id: input.id, withMessages })).deleted?.messages ?? 0
    } catch (err) {
      notices.show({ tone: 'danger', text: errorText(err) })
      return
    }
    onDeleted?.(input.id)
    notices.show({
      // The notice says what happened to the messages: they go with the send or they stay where they are.
      text: withMessages ? t('send.deletedWithMessages', { n: messages }) : hasMessages ? t('send.deletedKeeping', { n: kept }) : t('send.deleted'),
      action: {
        label: t('undo.undo'),
        run: async () => {
          await restore.mutateAsync(input.id)
          onDeleted?.(input.id, true)
        },
      },
    })
  }

  return (
    <span className={`inline-flex flex-wrap items-center gap-x-6 gap-y-2 ${className ?? ''}`}>
      <Button size="sm" variant="ghost" className="hit text-danger" data-testid="delete-send" disabled={remove.isPending} onClick={() => void run(false)}>
        <Trash2 size={13} aria-hidden /> {t('send.delete')}
      </Button>
      {hasMessages && (
        <Button size="sm" variant="ghost" className="hit text-muted hover:text-danger" data-testid="delete-send-all" disabled={remove.isPending} onClick={() => void run(true)}>
          <Trash2 size={13} aria-hidden /> {t('send.deleteAll')}
        </Button>
      )}
    </span>
  )
}
