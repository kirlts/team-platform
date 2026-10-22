import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useFormat, useT } from '@/i18n'
import { firstWords } from '@/lib/first-words'
import { useDiscardedSends, useRestoreInput } from '@/lib/queries'

/** The sends I discarded, listed where the sends are (UD-250): each comes back with Restaurar, with the proposal and the edits it had. */
export function DiscardedSends({ onRestored }: { onRestored: (inputId: string) => void }) {
  const t = useT()
  const format = useFormat()
  const list = useDiscardedSends()
  const restore = useRestoreInput()
  const rows = list.data ?? []
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="text-muted" data-testid="discarded-control">
          {t('restore.sends')}
          {rows.length > 0 && <span className="tabular-nums text-accent-deep">{rows.length}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80" aria-label={t('restore.sends')}>
        {rows.length === 0 ? (
          <p className="px-3 py-2 text-muted">{t('restore.noSends')}</p>
        ) : (
          <ul className="scroll-thin flex max-h-72 flex-col overflow-y-auto">
            {rows.map((input) => {
              const label = firstWords(input.text, 8) || t('tray.onlyMedia')
              return (
                <li key={input.id} data-testid="discarded-row" className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="min-w-0">
                    <span data-repeat-ok="send-label" className="block break-words">{label}</span>
                    <time dateTime={input.created_at} className="text-xs tabular-nums text-muted">
                      {format.stamp(input.created_at)}
                    </time>
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={restore.isPending}
                    aria-label={t('restore.of', { title: label })}
                    onClick={() => void restore.mutateAsync(input.id).then(() => onRestored(input.id))}
                  >
                    {t('restore.action')}
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
