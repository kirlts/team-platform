import { useState } from 'react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Play, X } from '@/components/icons'
import { useFormat, useT } from '@/i18n'
import { MEDIA_KEY } from '@/lib/media'
import type { AttachmentKind } from '@/lib/types'
import { cn } from '@/lib/utils'
import { MediaIcon } from './MediaIcon'

export interface ThumbSource {
  kind: AttachmentKind
  /** Address of the file (API or local view). */
  src?: string
  name?: string
  size?: number
}

/** Square thumbnail of an attachment. A video carries its play mark. With `onRemove` it can be removed. */
export function Thumb({
  item,
  px = 48,
  onRemove,
  href,
  className,
}: {
  item: ThumbSource
  px?: number
  onRemove?: () => void
  href?: string
  className?: string
}) {
  const t = useT()
  const format = useFormat()
  const [zoomed, setZoomed] = useState(false)
  const label = item.name ?? t(MEDIA_KEY[item.kind])
  const inner =
    item.kind === 'image' && item.src ? (
      <img src={item.src} alt={label} className="h-full w-full rounded-[4px] object-cover" loading="lazy" />
    ) : item.kind === 'video' && item.src ? (
      <span className="relative block h-full w-full">
        <video src={`${item.src}#t=0.1`} preload="metadata" muted playsInline className="h-full w-full rounded-[4px] bg-raised object-cover" aria-label={label} />
        <span aria-hidden className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-[55%] w-[55%] items-center justify-center rounded-full bg-fg/60 text-bg">
            <Play size={Math.round(px * 0.3)} fill="currentColor" />
          </span>
        </span>
      </span>
    ) : (
      <span className="flex h-full w-full flex-col items-center justify-center gap-0.5 rounded-[4px] bg-raised text-accent-deep">
        <MediaIcon kind={item.kind} size={Math.round(px * 0.38)} />
      </span>
    )
  const body = (
    <span className="frame block overflow-hidden rounded-md" style={{ width: px, height: px }} title={[label, format.fileSize(item.size)].filter(Boolean).join(' · ')}>
      {inner}
    </span>
  )
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1', className)}>
      {href && item.kind === 'image' && item.src ? (
        // A photo opens large in the page, where a capture can be read; a link in the corner still opens it in a new tab.
        <>
          <button type="button" aria-label={t('media.zoom', { name: label })} onClick={() => setZoomed(true)} className="block cursor-zoom-in rounded-md">
            {body}
          </button>
          <Dialog open={zoomed} onOpenChange={setZoomed}>
            <DialogContent title={label} className="max-w-[min(64rem,calc(100vw-2rem))]">
              <div data-lane="photo" className="scroll-thin flex min-h-0 flex-col gap-2 overflow-auto p-3">
                <img src={item.src} alt={label} className="max-h-[75dvh] w-full object-contain" />
                <a href={href} target="_blank" rel="noreferrer" className="self-end text-xs text-accent hover:underline">
                  {t('media.openNewTab')}
                </a>
              </div>
            </DialogContent>
          </Dialog>
        </>
      ) : href ? (
        <a href={href} target="_blank" rel="noreferrer" aria-label={t('media.open', { name: label })} className="block rounded-md">
          {body}
        </a>
      ) : (
        body
      )}
      {onRemove && (
        // Beside the picture, never over it: a target of its own, 24 px at the least (J1-B-02).
        <button type="button" onClick={onRemove} aria-label={t('media.remove', { name: label })} className="hit inline-flex shrink-0 items-center justify-center rounded-full text-muted hover:bg-hover hover:text-danger">
          <X size={13} aria-hidden />
        </button>
      )}
    </span>
  )
}
