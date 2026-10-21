import { useT } from '@/i18n'
import { useSaveInputText } from '@/lib/queries'
import type { InputRecord } from '@/lib/types'
import { useUndo } from '@/lib/undo'
import { AttachmentStrip } from './AttachmentStrip'
import { EditableText } from './EditableText'

/**
 * Text and attachments of the submitted input, as they were left on the server. The text is corrected in
 * place while the proposal is open; each change can be undone.
 */
export function InputPreview({ input }: { input: InputRecord }) {
  const t = useT()
  const undo = useUndo()
  const saveText = useSaveInputText(input.id)
  const editable = input.status === 'proposed' || input.status === 'failed'

  const change = (next: string) => {
    const prev = input.text
    return undo.run({ label: t('input.edited'), redo: () => saveText.mutateAsync(next), undo: () => saveText.mutateAsync(prev) })
  }

  return (
    <section aria-label={t('input.sent')} className="flex min-h-0 min-w-0 flex-col gap-3">
      <h2>{t('input.title')}</h2>
      {/* A pasted text has no maximum length: it is a lane with its own declared scrolling. */}
      <div data-lane="input-text" className="scroll-thin min-h-0 flex-1 overflow-y-auto px-1.5 text-sm">
        <EditableText value={input.text} label={t('input.title')} multiline prose canEdit={editable} validate={(v) => (v ? null : t('common.required'))} onSave={change} />
      </div>
      <AttachmentStrip items={input.attachments} className="shrink-0" />
    </section>
  )
}
