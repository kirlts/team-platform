import { FileAudio, FileText, Film, Link2, X } from '@/components/icons'
import { fileSize } from '@/lib/format'
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

/** Miniatura cuadrada de un adjunto. Con `onRemove` se puede quitar. */
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
  const Icon = ICON[item.kind]
  const label = item.name ?? item.kind
  const inner =
    item.kind === 'image' && item.src ? (
      <img src={item.src} alt={label} className="h-full w-full object-cover" loading="lazy" />
    ) : item.kind === 'video' && item.src ? (
      <video src={`${item.src}#t=0.1`} preload="metadata" muted playsInline className="h-full w-full object-cover" aria-label={label} />
    ) : (
      <span className="flex h-full w-full flex-col items-center justify-center gap-0.5 text-muted">
        <Icon size={Math.round(px * 0.38)} aria-hidden />
      </span>
    )
  const body = (
    <span
      className="block overflow-hidden rounded-md border border-line-strong bg-surface"
      style={{ width: px, height: px }}
      title={[label, fileSize(item.size)].filter(Boolean).join(' · ')}
    >
      {inner}
    </span>
  )
  return (
    <span className={cn('relative inline-block shrink-0', className)}>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" aria-label={`Abrir ${label}`} className="block rounded-md">
          {body}
        </a>
      ) : (
        body
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Quitar ${label}`}
          className="absolute -right-1.5 -top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full border border-line-strong bg-raised text-muted hover:text-danger"
        >
          <X size={11} aria-hidden />
        </button>
      )}
    </span>
  )
}
