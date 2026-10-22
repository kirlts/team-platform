import { Trash2 } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { useT } from '@/i18n'
import type { Selection } from '@/lib/selection'

/**
 * The strip over a list while rows are marked (UD-253): how many, Marcar todos (the rows of the page), Borrar and Cancelar.
 * Borrar deletes at once, without asking: what it deletes comes back with Deshacer in the notice.
 */
export function SelectionBar({ selection, onAll, onDelete, busy }: { selection: Selection; onAll: () => void; onDelete: () => void; busy?: boolean }) {
  const t = useT()
  return (
    <div role="toolbar" aria-label={t('bulk.toolbar')} data-testid="selection-bar" className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-selected py-2 pl-3 pr-4">
      <Checkbox checked aria-label={t('bulk.cancel')} onCheckedChange={() => selection.clear()} />
      <span className="text-sm font-semibold tabular-nums" aria-live="polite">
        {t('bulk.marked', { n: selection.marked.size })}
      </span>
      <Button size="sm" variant="ghost" className="text-xs" onClick={onAll}>
        {t('bulk.all')}
      </Button>
      <span className="ml-auto flex items-center gap-2">
        <Button size="sm" variant="ghost" className="text-xs text-muted" onClick={() => selection.clear()}>
          {t('common.cancel')}
        </Button>
        <Button size="sm" variant="secondary" className="text-danger" disabled={busy} data-testid="selection-delete" onClick={onDelete}>
          <Trash2 size={13} aria-hidden /> {t('bulk.delete')}
        </Button>
      </span>
    </div>
  )
}

/** The check box of a row: in the gutter left of the row, at the height of its first line, above the link that covers the row. */
export function RowCheck({ id, title, selection }: { id: string; title: string; selection: Selection }) {
  const t = useT()
  return (
    <Checkbox
      data-testid="row-check"
      checked={selection.isMarked(id)}
      aria-label={t('bulk.markOf', { title })}
      onCheckedChange={(on) => selection.toggle(id, on === true)}
      className="absolute left-3 top-3 z-10"
    />
  )
}
