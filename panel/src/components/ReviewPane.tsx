import { useT } from '@/i18n'
import { useInput } from '@/lib/queries'
import { UndoProvider, useUndoStack } from '@/lib/undo'
import { AnalysisPanel } from './AnalysisPanel'
import { InputPreview } from './InputPreview'

/**
 * The review of one send, inside the tray's frame (UD-025): its text and attachments on one side and
 * its analysis or proposal on the other. Each send has its own history of changes: the pane is keyed
 * by the input, so moving to another send starts that one's history and leaves this one's behind.
 */
export function ReviewPane({ inputId, onClose, registerPublish }: { inputId: string | undefined; onClose: () => void; registerPublish: (publish: (() => void) | null) => void }) {
  const t = useT()
  if (!inputId) {
    return <p className="px-4 py-6 text-sm text-muted">{t('tray.none')}</p>
  }
  return <Review key={inputId} inputId={inputId} onClose={onClose} registerPublish={registerPublish} />
}

function Review({ inputId, onClose, registerPublish }: { inputId: string; onClose: () => void; registerPublish: (publish: (() => void) | null) => void }) {
  const input = useInput(inputId)
  const undo = useUndoStack()
  if (!input.data) return null
  return (
    <UndoProvider stack={undo}>
      <div className="@container grid min-h-0 min-w-0 flex-1 gap-x-8 gap-y-3 @2xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] @2xl:grid-rows-[minmax(0,1fr)]">
        <InputPreview input={input.data} />
        <AnalysisPanel input={input.data} onClose={onClose} registerPublish={registerPublish} />
      </div>
    </UndoProvider>
  )
}
