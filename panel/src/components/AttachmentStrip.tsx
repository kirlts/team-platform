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
 * the same everywhere. The strip stays in one row (UD-017) unless it is `named`. With `named`, every item is a row of its own with its name beside it, so no thumbnail is left
 * without one and each name sits next to what it names (J4-flow-05, J5-flow-reply-close: one name for two pictures).
 */
export function AttachmentStrip({ items, scope = 'message', max = 4, px = 40, named = false, className }: { items: readonly Attachment[]; scope?: AttachmentScope; max?: number; px?: number; named?: boolean; className?: string }) {
  const t = useT()
  const [open, setOpen] = useState<number | null>(null)
  if (items.length === 0) return null
  const gallery = toGalleryItems(items, scope)
  const shown = gallery.slice(0, max)
  const hidden = gallery.length - shown.length
  return (
    <>
      <ul aria-label={t('media.attachments')} className={cn(named ? 'flex flex-col items-start gap-1.5' : 'flex flex-wrap items-center gap-2', className)}>
        {shown.map((g, i) => (
          <li key={g.id}>
            <button type="button" aria-label={t('gallery.item', { n: i + 1, total: gallery.length, name: g.name ?? t(`media.kind.${g.kind}`) })} onClick={() => setOpen(i)} className={cn('rounded-md', named ? 'flex max-w-full items-center gap-2 pr-2 text-left hover:bg-hover' : 'block')}>
              <Thumb item={g} px={px} />
              {named && <span className="min-w-0 break-all text-xs text-muted">{g.name ?? t(`media.kind.${g.kind}`)}</span>}
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
