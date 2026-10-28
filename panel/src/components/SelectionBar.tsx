import type { ReactNode } from 'react'
import { Trash2 } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { useT } from '@/i18n'
import type { Selection } from '@/lib/selection'
import { cn } from '@/lib/utils'

/**
 * The strip over a list while rows are marked (UD-253): how many of the total, mark all (every row of the list, not only the page), delete and cancel.
 * Borrar deletes at once, without asking: what it deletes comes back with Deshacer in the notice.
 */
export function SelectionBar({ selection, total, onAll, onDelete, busy, className }: { selection: Selection; /** How many rows the list has that can be marked; the count says how many of them are marked, and the mark-all control marks the rest. */ total?: number; onAll: () => void; onDelete: () => void; busy?: boolean; className?: string }) {
  const t = useT()
  return (
    <div role="toolbar" aria-label={t('bulk.toolbar')} data-testid="selection-bar" className={cn('flex min-h-12 flex-wrap items-center gap-x-1 gap-y-1 border-b border-line bg-selected py-1 pl-2 pr-2 sm:gap-x-3 sm:py-2 sm:pl-10 sm:pr-4', className)}>
      <span className="pl-1 text-xs font-semibold tabular-nums sm:pl-0 sm:text-sm" aria-live="polite">
        {total !== undefined && total > selection.marked.size ? t('bulk.markedOf', { n: selection.marked.size, total }) : t('bulk.marked', { n: selection.marked.size })}
      </span>
      {(total === undefined || total > selection.marked.size) && (
        <Button size="sm" variant="ghost" className="px-2 text-xs [word-spacing:0.12em] sm:px-3 sm:text-sm" onClick={onAll}>
          {t('bulk.all')}
        </Button>
      )}
      <span className="ml-auto flex items-center gap-1 sm:gap-2">
        <Button size="sm" variant="ghost" className="px-2 text-xs text-muted sm:px-3 sm:text-sm" onClick={() => selection.clear()}>
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
 * Where the strip sits: under the list, never over it. Over it, marking the first row pushed every row down by the height of the strip and the
 * next click fell on the row that had moved. Under it nothing above the pointer moves. On a phone the foot of a list is far from the row that was
 * just marked, so there the strip floats over the foot of the window and the list keeps the room it takes (`max-md:h-16`).
 */
export function SelectionFoot({ children }: { children: ReactNode }) {
  return (
    <div className="pt-2 max-md:h-16">
      {/* `data-selection-float`: on a phone the notice rises over the strip instead of covering it (styles.css). */}
      <div data-selection-float className="glass leaf overflow-hidden max-md:fixed max-md:inset-x-3 max-md:bottom-3 max-md:z-20 max-md:shadow-[var(--shadow-pop)]">{children}</div>
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
