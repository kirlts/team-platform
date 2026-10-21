import { useT } from '@/i18n'
import { toGalleryItems } from '@/lib/gallery'
import { useSaveInputText } from '@/lib/queries'
import type { InputRecord } from '@/lib/types'
import { useNarrow } from '@/lib/useNarrow'
import { useUndo } from '@/lib/undo'
import { EditableText } from './EditableText'
import { FoldedText } from './FoldedText'
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
  // On a phone, once the result is published the original reads as its first paragraph and opens whole with «Ver más»: the result is what the person came for and it was left under the fold of the screen (ronda 5). Nothing is cut or hidden.
  const folded = useNarrow() && input.status === 'published'

  const change = (next: string) => {
    const prev = input.text
    return undo.run({ label: t('input.edited'), redo: () => saveText.mutateAsync(next), undo: () => saveText.mutateAsync(prev) })
  }

  return (
    <OriginalFrame>
      {/* A pasted text has no maximum length: it is a lane with its own scroll, declared, and the only one the drawer keeps (UD-110); its cap comes from the window. */}
      {input.text && (
        <div data-lane="input-text" className="scroll-thin min-h-0 flex-1 overflow-y-auto px-1 text-sm md:max-h-[60dvh]">
          {folded ? (
            <FoldedText value={input.text} label={t('original.title')} canEdit={false} onSave={change} />
          ) : (
            <EditableText value={input.text} label={t('original.title')} multiline prose canEdit={editable} validate={(v) => (v ? null : t('common.required'))} onSave={change} />
          )}
        </div>
      )}
      {input.attachments.length > 0 && <MediaGallery items={toGalleryItems(input.attachments)} variant="compact" className="shrink-0" />}
    </OriginalFrame>
  )
}

/** The frame of the original: neutral surface, titled «Original». It is as tall as what it holds and starts at the top: the analysis beside it may be taller, and the original does not stretch to meet it. */
export function OriginalFrame({ children }: { children: React.ReactNode }) {
  const t = useT()
  return (
    <section aria-label={t('input.sent')} data-testid="original-box" className="flex min-h-0 min-w-0 flex-col gap-2 self-start rounded-[3px_10px_3px_10px] border border-line-strong bg-surface p-3">
      <h2>{t('original.title')}</h2>
      {children}
    </section>
  )
}
