import { AlertTriangle, RotateCw } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { useErrorText, useT } from '@/i18n'
import { cn } from '@/lib/utils'

/** What a screen needs of a query to draw its waiting and failing states. */
interface Waiting {
  isPending: boolean
  isError: boolean
  error: unknown
  failureCount: number
  refetch: () => unknown
}

/** Bars of a row that is still to arrive: they keep the place the rows will take, so nothing jumps when they do (J2-A-47). */
const BARS = ['w-2/5', 'w-4/5', 'w-3/5'] as const

/**
 * The two states of a list that has not arrived: waiting, as rows that hold their space, and failed, with the reason,
 * an icon and Reintentar (J2-A-46). While the first try fails and is tried again it says so, so a slow server is
 * not the same sight as a stuck page. It goes where the list's `empty` goes. `tall` makes each row the height of a row of Mensajes (`--spacing-card-row`),
 * so the list does not jump when it arrives.
 */
export function LoadState({ query, rows = 3, tall = false, quiet = false }: { query: Waiting; rows?: number; tall?: boolean; /** The second block of a screen that is waiting: it keeps its bars and leaves the word to the first, so «Cargando» is not said twice. */ quiet?: boolean }) {
  const t = useT()
  const errorText = useErrorText()
  if (query.isError) {
    return (
      <div role="alert" className="flex flex-col items-center gap-3 px-4 py-10 text-center text-sm">
        <AlertTriangle size={22} aria-hidden className="text-danger" />
        <p className="max-w-prose break-words text-danger">{t('common.loadFailed', { reason: errorText(query.error) })}</p>
        <Button size="sm" onClick={() => void query.refetch()}>
          <RotateCw size={14} aria-hidden /> {t('common.retry')}
        </Button>
      </div>
    )
  }
  return (
    <div role={quiet ? undefined : 'status'} aria-label={quiet ? undefined : t('common.loading')} aria-hidden={quiet || undefined} className="flex flex-col">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden data-testid="load-row" className={cn('flex flex-col gap-2 border-b border-line px-4 py-4 last:border-b-0', tall && 'box-border h-card-row overflow-hidden')}>
          <span className={`block h-3.5 rounded bg-line ${BARS[i % BARS.length]}`} />
          <span className="block h-3 w-full rounded bg-line/60" />
        </div>
      ))}
      {!quiet && <span className="px-4 pb-3 pt-3 text-sm text-muted">{query.failureCount > 0 ? t('common.retrying') : t('common.loading')}</span>}
    </div>
  )
}
