import { useState } from 'react'
import { useT } from '@/i18n'
import { toGalleryItems, type AttachmentScope } from '@/lib/gallery'
import type { Attachment } from '@/lib/types'
import { cn } from '@/lib/utils'
import { MediaGalleryDialog } from './MediaGallery'
import { Thumb } from './Thumb'

/**
 * Attachments of a message, a reply or an input where the gallery has no room of its own: the first ones as thumbnails and the
 * rest behind «+N». Any of them opens the gallery over the page on that medium (`MediaGallery`), so what is looked at is
 * the same everywhere. The strip never grows past one row (UD-017).
 */
export function AttachmentStrip({ items, scope = 'message', max = 4, px = 40, className }: { items: readonly Attachment[]; scope?: AttachmentScope; max?: number; px?: number; className?: string }) {
  const t = useT()
  const [open, setOpen] = useState<number | null>(null)
  if (items.length === 0) return null
  const gallery = toGalleryItems(items, scope)
  const shown = gallery.slice(0, max)
  const hidden = gallery.length - shown.length
  return (
    <>
      <ul aria-label={t('media.attachments')} className={cn('flex flex-wrap items-center gap-2', className)}>
        {shown.map((g, i) => (
          <li key={g.id}>
            <button type="button" aria-label={t('gallery.item', { n: i + 1, total: gallery.length, name: g.name ?? t(`media.kind.${g.kind}`) })} onClick={() => setOpen(i)} className="block rounded-md">
              <Thumb item={g} px={px} />
            </button>
          </li>
        ))}
        {hidden > 0 && (
          <li>
            <button
              type="button"
              aria-label={t('media.allMore', { n: hidden })}
              title={t('media.allMore', { n: hidden })}
              onClick={() => setOpen(max)}
              className="inline-flex h-7 min-w-7 items-center justify-center rounded-md border border-dashed border-line-strong px-1.5 text-xs font-semibold text-muted hover:border-accent hover:text-accent"
            >
              +{hidden}
            </button>
          </li>
        )}
      </ul>
      <MediaGalleryDialog items={gallery} open={open !== null} onOpenChange={(o) => !o && setOpen(null)} index={open ?? 0} />
    </>
  )
}
