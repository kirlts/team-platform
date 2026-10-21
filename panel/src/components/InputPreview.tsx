import { useT } from '@/i18n'
import { toGalleryItems } from '@/lib/gallery'
import { useSaveInputText } from '@/lib/queries'
import type { InputRecord } from '@/lib/types'
import { useUndo } from '@/lib/undo'
import { EditableText } from './EditableText'
import { MediaGallery } from './MediaGallery'

/**
 * The original of a send, on the left of the drawer of Inicio (mockup «Mensaje o transcripción» with «Previsualización» and
 * «Lista de adjuntos»): the text or the transcription, corrected in place while the proposal is open, and the attachments in the gallery,
 * whose strip is the list of them. It is neutral on purpose: what the person sent must not be read as part of what the model made of it,
 * which is the tinted box beside it (UD-045). It is always open: the original is half of the answer to «what did I send».
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
    <OriginalFrame>
      {/* A pasted text has no maximum length: it is a lane with its own scroll, declared, and the only one the drawer keeps (UD-110); its cap comes from the window. */}
      {input.text && (
        <div data-lane="input-text" className="scroll-thin min-h-0 flex-1 overflow-y-auto px-1 text-sm md:max-h-[60dvh]">
          <EditableText value={input.text} label={t('original.title')} multiline prose canEdit={editable} validate={(v) => (v ? null : t('common.required'))} onSave={change} />
        </div>
      )}
      {input.attachments.length > 0 && <MediaGallery items={toGalleryItems(input.attachments)} variant="compact" className="shrink-0" />}
    </OriginalFrame>
  )
}

/** The frame of the original: neutral surface, titled «Original». */
export function OriginalFrame({ children }: { children: React.ReactNode }) {
  const t = useT()
  return (
    <section aria-label={t('input.sent')} data-testid="original-box" className="flex min-h-0 min-w-0 flex-col gap-2 rounded-[3px_10px_3px_10px] border border-line-strong bg-surface p-3">
      <h2>{t('original.title')}</h2>
      {children}
    </section>
  )
}
