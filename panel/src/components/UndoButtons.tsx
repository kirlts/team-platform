import { Redo, Undo } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import type { UndoStack } from '@/lib/undo'

/**
 * «Deshacer» and «Rehacer» of the screen: off when there is nothing to undo or redo; the count goes in the
 * tooltip. `compact` shows only the icons, each with its accessible name, for headers that are short of room.
 */
export function UndoButtons({ stack, compact = false, hideWhenEmpty = false }: { stack: UndoStack; compact?: boolean; hideWhenEmpty?: boolean }) {
  const t = useT()
  const undoTitle = t('undo.undoTitle', { n: stack.undoCount })
  const redoTitle = t('undo.redoTitle', { n: stack.redoCount })
  // Where nothing can be edited yet (a failed analysis, a job running) two off buttons only ask for a look (J1-B-16).
  if (hideWhenEmpty && stack.undoCount === 0 && stack.redoCount === 0) return null
  return (
    <div role="group" aria-label={t('undo.group')} className="flex items-center gap-1.5">
      <Button size={compact ? 'icon-sm' : 'sm'} variant="secondary" disabled={stack.undoCount === 0 || stack.busy} title={stack.undoLabel ? `${undoTitle}: ${stack.undoLabel}` : undoTitle} aria-label={t('undo.undo')} onClick={() => void stack.undo()}>
        <Undo size={14} aria-hidden /> {!compact && t('undo.undo')}
      </Button>
      <Button size={compact ? 'icon-sm' : 'sm'} variant="secondary" disabled={stack.redoCount === 0 || stack.busy} title={stack.redoLabel ? `${redoTitle}: ${stack.redoLabel}` : redoTitle} aria-label={t('undo.redo')} onClick={() => void stack.redo()}>
        <Redo size={14} aria-hidden /> {!compact && t('undo.redo')}
      </Button>
    </div>
  )
}
