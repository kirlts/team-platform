import { Trash2 } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { useT } from '@/i18n'
import type { Selection } from '@/lib/selection'

/**
 * The strip over a list while rows are marked (UD-253): how many, mark all (the rows of the page), delete and cancel.
 * Borrar deletes at once, without asking: what it deletes comes back with Deshacer in the notice.
 */
export function SelectionBar({ selection, onAll, onDelete, busy }: { selection: Selection; onAll: () => void; onDelete: () => void; busy?: boolean }) {
  const t = useT()
  return (
    <div role="toolbar" aria-label={t('bulk.toolbar')} data-testid="selection-bar" className="flex min-h-12 flex-wrap items-center gap-x-1 gap-y-1 border-b border-line bg-selected py-2 pl-2 pr-2 sm:gap-x-3 sm:pl-10 sm:pr-4">
      <span className="pl-1 text-xs font-semibold tabular-nums sm:pl-0 sm:text-sm" aria-live="polite">
        {t('bulk.marked', { n: selection.marked.size })}
      </span>
      <Button size="sm" variant="secondary" className="px-2 text-xs sm:px-3" onClick={onAll}>
        {t('bulk.all')}
      </Button>
      <span className="ml-auto flex items-center gap-1 sm:gap-2">
        <Button size="sm" variant="secondary" className="px-2 text-xs sm:px-3" onClick={() => selection.clear()}>
          {t('common.cancel')}
        </Button>
        <Button size="sm" variant="danger" disabled={busy} data-testid="selection-delete" onClick={onDelete}>
          <Trash2 size={16} aria-hidden /> {t('bulk.delete')}
        </Button>
      </span>
    </div>
  )
}

/**
 * The check box of a row: in the gutter left of the row, at the height of its first line, above the link that covers the row. Its edge is
 * drawn at rest (a field with no edge is not found against the row) and, on a touch screen, an invisible frame brings the target to 44 px.
 */
/** `align="row"`: a row of a table, whose cells are centered from 640 px: the box is centered with them; a card keeps it at its first line. */
export function RowCheck({ id, title, selection, align = 'top' }: { id: string; title: string; selection: Selection; align?: 'top' | 'row' }) {
  const t = useT()
  return (
    <Checkbox
      data-testid="row-check"
      checked={selection.isMarked(id)}
      aria-label={t('bulk.markOf', { title })}
      onCheckedChange={(on) => selection.toggle(id, on === true)}
      className={`absolute left-3 top-3 z-10 ${align === 'row' ? 'sm:top-1/2 sm:-translate-y-1/2' : ''} rounded-sm border-edge [@media(pointer:coarse)]:after:absolute [@media(pointer:coarse)]:after:-inset-3`}
    />
  )
}
