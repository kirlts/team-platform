import { useState } from 'react'
import { useT } from '@/i18n'
import { mainAttachment, MEDIA_KEY } from '@/lib/media'
import { toGalleryItems, type AttachmentScope } from '@/lib/gallery'
import type { Attachment } from '@/lib/types'
import { MediaGalleryDialog } from './MediaGallery'
import { Thumb } from './Thumb'

/**
 * The main thumbnail of a row (UD-016) with the count of media it stands for: it opens the gallery on the first one,
 * and the gallery holds all of them. A row with one medium shows no count.
 */
export function MediaOpener({ attachments, scope = 'message', px = 40 }: { attachments: readonly Attachment[]; scope?: AttachmentScope; px?: number }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const main = mainAttachment(attachments)
  if (!main) return null
  const items = toGalleryItems(attachments, scope)
  const start = Math.max(0, attachments.indexOf(main))
  const label = attachments.length > 1 ? t('gallery.openMany', { n: attachments.length }) : t('media.zoom', { name: main.name ?? t(MEDIA_KEY[main.kind]) })
  return (
    <>
      <button type="button" aria-label={label} title={label} onClick={() => setOpen(true)} className="relative block rounded-md">
        <Thumb item={items[start]} px={px} />
        {attachments.length > 1 && (
          <span aria-hidden className="absolute -bottom-1 -right-1 inline-flex min-w-4 items-center justify-center rounded-full border border-line-strong bg-surface px-1 text-xs font-semibold tabular-nums leading-4 text-fg">
            {attachments.length}
          </span>
        )}
      </button>
      <MediaGalleryDialog items={items} open={open} onOpenChange={setOpen} index={start} />
    </>
  )
}
