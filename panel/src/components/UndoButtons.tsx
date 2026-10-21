import { Redo, Undo } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import type { UndoStack } from '@/lib/undo'

/** «Deshacer» and «Rehacer» of the screen: disabled if there is nothing to undo or redo; the count goes in the button's notice. */
export function UndoButtons({ stack }: { stack: UndoStack }) {
  const t = useT()
  return (
    <div role="group" aria-label={t('undo.group')} className="flex items-center gap-2">
      <Button size="sm" variant="secondary" disabled={stack.undoCount === 0 || stack.busy} title={t('undo.undoTitle', { n: stack.undoCount })} onClick={() => void stack.undo()}>
        <Undo size={14} aria-hidden /> {t('undo.undo')}
      </Button>
      <Button size="sm" variant="secondary" disabled={stack.redoCount === 0 || stack.busy} title={t('undo.redoTitle', { n: stack.redoCount })} onClick={() => void stack.redo()}>
        <Redo size={14} aria-hidden /> {t('undo.redo')}
      </Button>
    </div>
  )
}
