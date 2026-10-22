import { ChevronLeft, ChevronRight } from '@/components/icons'
import { useT } from '@/i18n'

/** Range and the two arrows of a list the server pages (Cola, Auditoría): the same strip FitList draws at its foot. */
export function PageControls({ page, limit, total, onPage }: { page: number; limit: number; total: number; onPage: (page: number) => void }) {
  const t = useT()
  if (total <= limit) return null
  const from = (page - 1) * limit + 1
  const to = Math.min(total, page * limit)
  return (
    <div data-page-controls className="flex items-center justify-between gap-3 border-t border-line pt-2 text-sm text-muted">
      <span aria-live="polite" className="tabular-nums">
        {t('pager.range', { from, to, total })}
      </span>
      <span className="flex items-center gap-1">
        <button
          type="button"
          aria-label={t('pager.previous')}
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-edge bg-glass hover:border-accent disabled:opacity-40"
        >
          <ChevronLeft size={16} aria-hidden />
        </button>
        <button
          type="button"
          aria-label={t('pager.next')}
          disabled={to >= total}
          onClick={() => onPage(page + 1)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-edge bg-glass hover:border-accent disabled:opacity-40"
        >
          <ChevronRight size={16} aria-hidden />
        </button>
      </span>
    </div>
  )
}
