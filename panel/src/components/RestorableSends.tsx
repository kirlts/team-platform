import { Fold } from '@/components/Fold'
import { Button } from '@/components/ui/button'
import { useErrorText, useFormat, useT } from '@/i18n'
import { firstWords } from '@/lib/first-words'
import { useNotices } from '@/lib/notices'
import type { InputRecord } from '@team-platform/client'
import { useDeletedInputs, useDiscardedInputs, useRestoreInput } from '@team-platform/client/react'

/**
 * «Descartados» and «Borrados» of Inicio (soft-locks TP-01, TP-07): the sends a person set aside or deleted, each with «Restaurar». The Deshacer of the
 * notice lasts 8 s and the marker of the drawer lives while Inicio is mounted; these lists do not: the deleted ones wait until the purge (UD-317).
 * Nothing is drawn while both are empty, so a person with nothing to bring back sees no new row.
 */
export function RestorableSends() {
  const discarded = useDiscardedInputs().data ?? []
  const deleted = useDeletedInputs().data ?? []
  const t = useT()
  if (discarded.length === 0 && deleted.length === 0) return null
  return (
    <div data-testid="restorable-sends" className="flex w-full flex-col gap-3">
      {discarded.length > 0 && (
        <Fold title={t('restore.discarded')} note={discarded.length} anchor="discarded-sends">
          <SendRows items={discarded} />
        </Fold>
      )}
      {deleted.length > 0 && (
        <Fold title={t('restore.deletedSends')} note={deleted.length} anchor="deleted-sends">
          <SendRows items={deleted} />
        </Fold>
      )}
    </div>
  )
}

function SendRows({ items }: { items: InputRecord[] }) {
  const t = useT()
  const format = useFormat()
  const errorText = useErrorText()
  const notices = useNotices()
  const restore = useRestoreInput()
  const bringBack = (id: string) => restore.mutate(id, { onError: (err) => notices.show({ tone: 'danger', text: errorText(err) }) })
  return (
    <ul className="flex flex-col">
      {items.map((input) => {
        const label = firstWords(input.text, 8) || t('tray.onlyMedia')
        return (
          <li key={input.id} data-restorable={input.id} className="flex min-h-12 items-center justify-between gap-3 border-b border-line py-2 last:border-b-0">
            <span className="flex min-w-0 flex-col">
              <span className="break-words">{label}</span>
              <time dateTime={input.created_at} className="text-sm tabular-nums text-muted">
                {format.stamp(input.created_at)}
              </time>
            </span>
            <Button size="sm" variant="secondary" disabled={restore.isPending} aria-label={t('restore.of', { title: label })} data-testid="send-restore" data-repeat-ok="per-send" onClick={() => bringBack(input.id)}>
              {t('restore.action')}
            </Button>
          </li>
        )
      })}
    </ul>
  )
}
