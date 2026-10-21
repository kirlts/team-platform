import { Camera, FileText, Film, Link2, Mic } from '@/components/icons'
import { MEDIA_LABEL, mediaKinds } from '@/lib/media'
import type { Attachment, AttachmentKind } from '@/lib/types'
import { cn } from '@/lib/utils'

const ICON = { image: Camera, video: Film, audio: Mic, document: FileText, link: Link2 } as const

/**
 * One small icon per kind of media attached to a message or a reply (UD-016), drawn next to the
 * date as in the mockup: photo, video, audio, document and link. A count shows when there is
 * more than one of a kind. Renders nothing without attachments.
 */
export function MediaKinds({ attachments, className }: { attachments: readonly Pick<Attachment, 'kind'>[] | undefined; className?: string }) {
  const kinds = mediaKinds(attachments)
  if (kinds.length === 0) return null
  return (
    <ul aria-label="Adjuntos" className={cn('inline-flex items-center gap-2', className)}>
      {kinds.map(({ kind, count }) => (
        <MediaKind key={kind} kind={kind} count={count} />
      ))}
    </ul>
  )
}

function MediaKind({ kind, count }: { kind: AttachmentKind; count: number }) {
  const Icon = ICON[kind]
  const label = count > 1 ? `${MEDIA_LABEL[kind]}, ${count}` : MEDIA_LABEL[kind]
  return (
    <li className="inline-flex items-center gap-0.5 text-accent-deep" title={label}>
      <Icon size={15} aria-hidden />
      {count > 1 && (
        <span aria-hidden className="text-[11px] font-semibold tabular-nums leading-none">
          {count}
        </span>
      )}
      <span className="sr-only">{label}</span>
    </li>
  )
}
