import { Undo } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import { useInput } from '@team-platform/client/react'
import { UndoProvider, useUndoStack } from '@/lib/undo'
import { AnalysisPanel } from './AnalysisPanel'
import { InputPreview } from './InputPreview'
import { PublishedPane } from './PublishedPane'

interface Props {
  inputId: string | undefined
  onClose: () => void
  /** A discard was done from this pane: the page returns whether it keeps the place (true) or lets the notice say it (false). */
  onDiscarded?: (inputId: string, restore: () => Promise<unknown>) => boolean
  /** The send just discarded, while the drawer has no other one open: its place with the way back. */
  discarded?: { onUndo: () => void }
  /** The send was deleted for real (UD-240): the page stops showing it at once. */
  onDeleted?: (inputId: string) => void
}

/**
 * The review of one send, inside the drawer of Inicio (UD-046): the original on the left and the analysis of the model on the right,
 * in two columns from 768 px and stacked on a phone. Each send has its own history of changes: the pane is keyed
 * by the input, so moving to another send starts that one's history and leaves this one's behind.
 */
export function ReviewPane(props: Props) {
  const t = useT()
  if (!props.inputId && props.discarded) {
    return (
      <div role="status" className="flex flex-col items-start gap-3 px-4 py-4">
        <p className="text-sm font-semibold">{t('tray.pickedDiscarded')}</p>
        <Button variant="secondary" onClick={props.discarded.onUndo}>
          <Undo size={16} aria-hidden /> {t('undo.undo')}
        </Button>
      </div>
    )
  }
  if (!props.inputId) return <p className="px-4 py-6 text-sm text-muted">{t('tray.none')}</p>
  return <Review key={props.inputId} {...props} inputId={props.inputId} />
}

function Review({ inputId, onClose, onDiscarded, onDeleted }: Props & { inputId: string }) {
  const input = useInput(inputId)
  const undo = useUndoStack()
  if (!input.data) return null
  return (
    <UndoProvider stack={undo}>
      {/* The container query looks at this wrapper: a grid cannot be the container of its own columns. */}
      <div className="@container min-h-0 min-w-0 flex-1">
        <div className="grid h-full min-h-0 gap-4 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:grid-rows-[minmax(0,1fr)]">
          <InputPreview input={input.data} />
          {input.data.status === 'published' ? <PublishedPane input={input.data} onDeleted={onDeleted} /> : <AnalysisPanel input={input.data} onClose={onClose} onDiscarded={onDiscarded ? (restore) => onDiscarded(inputId, restore) : undefined} onDeleted={onDeleted} />}
        </div>
      </div>
    </UndoProvider>
  )
}
