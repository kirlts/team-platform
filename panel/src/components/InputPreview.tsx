import { ChevronRight } from '@/components/icons'
import { useT } from '@/i18n'
import { useSaveInputText } from '@/lib/queries'
import type { InputRecord } from '@/lib/types'
import { useUndo } from '@/lib/undo'
import { cn } from '@/lib/utils'
import { AttachmentStrip } from './AttachmentStrip'
import { EditableText } from './EditableText'
import { MediaKinds } from './MediaKinds'

/**
 * The original of a send: its text and attachments, as they were when the person sent them. It is a
 * fold: closed, a bar with the word «Original» and one icon per kind of attachment; open, the text,
 * which is corrected in place while the proposal is open, and the attachments. The text lives only
 * here (UD-026): the tray row shows it only while this is closed.
 */
export function InputPreview({ input, open, onToggle }: { input: InputRecord; open: boolean; onToggle: () => void }) {
  const t = useT()
  const undo = useUndo()
  const saveText = useSaveInputText(input.id)
  const editable = input.status === 'proposed' || input.status === 'failed'

  const change = (next: string) => {
    const prev = input.text
    return undo.run({ label: t('input.edited'), redo: () => saveText.mutateAsync(next), undo: () => saveText.mutateAsync(prev) })
  }

  return (
    <section aria-label={t('input.sent')} className={cn('flex min-w-0 flex-col gap-2', open && 'min-h-0 max-h-48 shrink-0')}>
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex items-center gap-2 self-start rounded-md py-0.5 text-left hover:text-accent">
        <ChevronRight size={14} aria-hidden className={cn('transition-transform', open && 'rotate-90')} />
        <h2>{t('original.title')}</h2>
        <MediaKinds of={{ attachments: input.attachments }} />
      </button>
      {open && (
        <>
          {/* A pasted text has no maximum length: it is a lane with its own scroll, declared. */}
          <div data-lane="input-text" className="scroll-thin min-h-0 flex-1 overflow-y-auto px-1.5 text-sm">
            <EditableText value={input.text} label={t('original.title')} multiline prose canEdit={editable} validate={(v) => (v ? null : t('common.required'))} onSave={change} />
          </div>
          <AttachmentStrip items={input.attachments} className="shrink-0" />
        </>
      )}
    </section>
  )
}
