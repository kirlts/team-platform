import { ChevronDown, Trash2 } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useErrorText, useT } from '@/i18n'
import { useNotices } from '@/lib/notices'
import type { InputRecord } from '@team-platform/client'
import { useDeleteInput, useMe, useRestoreInput } from '@team-platform/client/react'

/**
 * Deletes a send with one click and no step that confirms it (UD-253), and the notice offers Deshacer (the server keeps the send until it is purged,
 * UD-253 «lo reversible ofrece Deshacer»). One control per block (I4): «Borrar envío» keeps the messages the send published, and when it has any, the arrow
 * beside it opens the other form, «Borrar envío y mensajes», which takes them to the trash with it. Any person of the team sees it, on every send (UD-287).
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
    notices.show({
      text: withMessages ? t('send.deletedWithMessages', { n: messages }) : t('send.deleted'),
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
    <span className={`inline-flex items-center ${className ?? ''}`}>
      <Button size="sm" variant="ghost" className="hit text-danger" data-testid="delete-send" title={hasMessages ? t('send.deleteHint') : undefined} disabled={remove.isPending} onClick={() => void run(false)}>
        <Trash2 size={13} aria-hidden /> {t('send.delete')}
      </Button>
      {hasMessages && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" className="hit text-danger" data-testid="delete-send-more" aria-label={t('send.deleteMore')} disabled={remove.isPending}>
              <ChevronDown size={13} aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem data-testid="delete-send-all" title={t('send.deleteAllHint')} className="text-danger" onSelect={() => void run(true)}>
              {t('send.deleteAll')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </span>
  )
}
