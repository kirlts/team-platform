import { FileAudio, FileText, Film, Link2, Play, X } from '@/components/icons'
import { useFormat, useT } from '@/i18n'
import { MEDIA_KEY } from '@/lib/media'
import type { AttachmentKind } from '@/lib/types'
import { cn } from '@/lib/utils'

export interface ThumbSource {
  kind: AttachmentKind
  /** Dirección del archivo (API o vista local). */
  src?: string
  name?: string
  size?: number
}

const ICON = { video: Film, audio: FileAudio, document: FileText, link: Link2, image: FileText } as const

/** Miniatura cuadrada de un adjunto. Un video lleva su marca de reproducción. Con `onRemove` se puede quitar. */
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
  const Icon = ICON[item.kind]
  const label = item.name ?? t(MEDIA_KEY[item.kind])
  const inner =
    item.kind === 'image' && item.src ? (
      <img src={item.src} alt={label} className="h-full w-full rounded-[4px] object-cover" loading="lazy" />
    ) : item.kind === 'video' && item.src ? (
      <span className="relative block h-full w-full">
        <video src={`${item.src}#t=0.1`} preload="metadata" muted playsInline className="h-full w-full rounded-[4px] bg-accent-soft object-cover" aria-label={label} />
        <span aria-hidden className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-[55%] w-[55%] items-center justify-center rounded-full bg-fg/60 text-bg">
            <Play size={Math.round(px * 0.3)} fill="currentColor" />
          </span>
        </span>
      </span>
    ) : (
      <span className="flex h-full w-full flex-col items-center justify-center gap-0.5 rounded-[4px] bg-accent-soft text-accent-deep">
        <Icon size={Math.round(px * 0.38)} aria-hidden />
      </span>
    )
  const body = (
    <span className="frame block overflow-hidden rounded-md" style={{ width: px, height: px }} title={[label, format.fileSize(item.size)].filter(Boolean).join(' · ')}>
      {inner}
    </span>
  )
  return (
    <span className={cn('relative inline-block shrink-0', className)}>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" aria-label={t('media.open', { name: label })} className="block rounded-md">
          {body}
        </a>
      ) : (
        body
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={t('media.remove', { name: label })}
          className="btn-glass absolute right-0.5 top-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-muted hover:!text-danger"
        >
          <X size={11} aria-hidden />
        </button>
      )}
    </span>
  )
}
