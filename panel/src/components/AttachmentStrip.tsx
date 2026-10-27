import { useState, type ReactNode } from 'react'
import { useFormat, useT } from '@/i18n'
import { toGalleryItems, type AttachmentScope, type GalleryItem } from '@/lib/gallery'
import type { Attachment } from '@team-platform/client'
import { cn } from '@/lib/utils'
import { MediaGalleryDialog } from './MediaGallery'
import { DownloadLink } from './DownloadLink'
import { Thumb } from './Thumb'

/**
 * Attachments of a message, a reply or an input where the gallery has no room of its own: the first ones as thumbnails and the
 * rest behind «+N». Any of them opens the gallery over the page on that medium (`MediaGallery`), so what is looked at is
 * the same everywhere. The strip stays in one row (UD-017) unless it is `named`. With `named`, every item is a row of its own with its name beside it, so no thumbnail is left
 * without one and each name sits next to what it names (J4-flow-05, J5-flow-reply-close: one name for two pictures).
 */
export function AttachmentStrip({ items, scope = 'message', max = 4, px = 40, named = false, className, renderAction }: { items: readonly Attachment[]; scope?: AttachmentScope; max?: number; px?: number; named?: boolean; className?: string; /** What acts on one file, after its download (the «Quitar» of the author's own reply). */ renderAction?: (item: GalleryItem) => ReactNode }) {
  const t = useT()
  const format = useFormat()
  const [open, setOpen] = useState<number | null>(null)
  if (items.length === 0) return null
  const gallery = toGalleryItems(items, scope)
  const shown = gallery.slice(0, max)
  const hidden = gallery.length - shown.length
  return (
    <>
      <ul aria-label={t('media.attachments')} className={cn(named ? 'grid grid-cols-1 items-start gap-x-3 gap-y-1.5 @lg:grid-cols-2' : 'flex flex-wrap items-center gap-2', className)}>
        {shown.map((g, i) => (
          <li key={g.id} className={cn('min-w-0', named && 'flex items-center gap-1')}>
            {named && g.mime === 'application/pdf' && g.src ? (
              // A PDF opens where the browser reads it, in a tab of its own.
              <a href={g.src} target="_blank" rel="noreferrer" aria-label={t('media.open', { name: g.name ?? t(`media.kind.${g.kind}`) })} className="flex min-w-0 max-w-full flex-1 items-center gap-2 rounded-md pr-2 text-left hover:bg-hover">
                <Thumb item={g} px={px} />
                <span className="min-w-0 text-xs text-muted [overflow-wrap:anywhere]">{[g.name ?? t(`media.kind.${g.kind}`), format.fileSize(g.size)].filter(Boolean).join(' · ')}</span>
              </a>
            ) : (
              <button type="button" aria-label={t('gallery.item', { n: i + 1, total: gallery.length, name: g.name ?? t(`media.kind.${g.kind}`) })} onClick={() => setOpen(i)} className={cn('rounded-md', named ? 'flex min-w-0 max-w-full flex-1 items-center gap-2 pr-2 text-left hover:bg-hover' : 'block')}>
                <Thumb item={g} px={px} />
                {named && <span className="min-w-0 text-xs text-muted [overflow-wrap:anywhere]">{[g.name ?? t(`media.kind.${g.kind}`), format.fileSize(g.size)].filter(Boolean).join(' · ')}</span>}
              </button>
            )}
            {named && <DownloadLink href={g.download} name={g.name} />}
            {named && renderAction?.(g)}
          </li>
        ))}
        {hidden > 0 && (
          <li>
            <button
              type="button"
              aria-label={t('media.allMore', { n: hidden })}
              title={t('media.allMore', { n: hidden })}
              onClick={() => setOpen(max)}
              className="inline-flex h-7 min-w-7 items-center justify-center rounded-md border border-dashed border-line-strong px-1.5 text-xs font-semibold text-muted hover:border-[var(--control-hover-edge)] hover:text-accent"
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
