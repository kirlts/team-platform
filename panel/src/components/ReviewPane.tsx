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
  registerPublish: (publish: (() => void) | null) => void
}

/**
 * The review of one send, inside the tray's frame (UD-025, UD-026): the original, folded once the proposal is
 * ready, and the analysis on its own AI surface. Each send has its own history of changes: the pane is keyed
 * by the input, so moving to another send starts that one's history and leaves this one's behind.
 */
export function ReviewPane(props: Props) {
  const t = useT()
  if (!props.inputId) return <p className="px-4 py-6 text-sm text-muted">{t('tray.none')}</p>
  return <Review key={props.inputId} {...props} inputId={props.inputId} />
}

function Review({ inputId, originalOpen, onToggleOriginal, onClose, registerPublish }: Props & { inputId: string }) {
  const input = useInput(inputId)
  const undo = useUndoStack()
  if (!input.data) return null
  return (
    <UndoProvider stack={undo}>
      {/* The container query looks at this wrapper: a grid cannot be the container of its own columns. */}
      <div className="@container flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        <div className={originalOpen ? 'grid min-h-0 min-w-0 flex-1 gap-x-6 gap-y-3 @2xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] @2xl:grid-rows-[minmax(0,1fr)]' : 'flex min-h-0 min-w-0 flex-1 flex-col gap-3'}>
          <InputPreview input={input.data} open={originalOpen} onToggle={onToggleOriginal} />
          <AnalysisPanel input={input.data} onClose={onClose} registerPublish={registerPublish} />
        </div>
      </div>
    </UndoProvider>
  )
}
