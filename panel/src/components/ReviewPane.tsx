import { Undo } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import { useInput } from '@/lib/queries'
import { UndoProvider, useUndoStack } from '@/lib/undo'
import { AnalysisPanel } from './AnalysisPanel'
import { InputPreview } from './InputPreview'

interface Props {
  inputId: string | undefined
  /** Whether the original is open: the page decides, because the tray row hides its text while it is. */
  originalOpen: boolean
  onToggleOriginal: () => void
  onClose: () => void
  /** A discard was done from this pane: the page returns whether it keeps the place (true) or lets the notice say it (false). */
  onDiscarded?: (inputId: string, restore: () => Promise<unknown>) => boolean
  /** The send just discarded, while the window has no other one open: its place with the way back. */
  discarded?: { onUndo: () => void }
}

/**
 * The review of one send, inside the tray's frame (UD-025, UD-026): the original, folded once the proposal is
 * ready, and the analysis on its own AI surface. Each send has its own history of changes: the pane is keyed
 * by the input, so moving to another send starts that one's history and leaves this one's behind.
 */
export function ReviewPane(props: Props) {
  const t = useT()
  if (!props.inputId && props.discarded) {
    return (
      <div role="status" className="flex flex-col items-start gap-3 px-1 py-4">
        <p className="text-sm font-semibold">{t('tray.pickedDiscarded')}</p>
        <Button variant="secondary" onClick={props.discarded.onUndo}>
          <Undo size={14} aria-hidden /> {t('undo.undo')}
        </Button>
      </div>
    )
  }
  if (!props.inputId) return <p className="px-4 py-6 text-sm text-muted">{t('tray.none')}</p>
  return <Review key={props.inputId} {...props} inputId={props.inputId} />
}

function Review({ inputId, originalOpen, onToggleOriginal, onClose, onDiscarded }: Props & { inputId: string }) {
  const input = useInput(inputId)
  const undo = useUndoStack()
  if (!input.data) return null
  return (
    <UndoProvider stack={undo}>
      {/* The container query looks at this wrapper: a grid cannot be the container of its own columns. */}
      <div className="@container flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        {/* The original, open, sits above the analysis in its own short frame: the proposal keeps the whole width (J2-B-20). */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          <InputPreview input={input.data} open={originalOpen} onToggle={onToggleOriginal} />
          <AnalysisPanel input={input.data} onClose={onClose} onDiscarded={onDiscarded ? (restore) => onDiscarded(inputId, restore) : undefined} />
        </div>
      </div>
    </UndoProvider>
  )
}
