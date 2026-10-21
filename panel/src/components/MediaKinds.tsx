import { Camera, FileText, Film, Link2, Mic } from '@/components/icons'
import { useT } from '@/i18n'
import { kindsOf, MEDIA_KEY } from '@/lib/media'
import type { Attachment, AttachmentKind } from '@/lib/types'
import { cn } from '@/lib/utils'

const ICON = { image: Camera, video: Film, audio: Mic, document: FileText, link: Link2 } as const

/**
 * One small icon per kind of media attached to a message or a reply (UD-016), drawn next to the
 * date as in the mockup: photo, video, audio, document and link. A count shows when there is
 * more than one of a kind. Renders nothing without media.
 */
export function MediaKinds({ of, className }: { of: { attachments?: readonly Pick<Attachment, 'kind'>[]; attachment_kinds?: readonly AttachmentKind[] }; className?: string }) {
  const kinds = kindsOf(of)
  const t = useT()
  if (kinds.length === 0) return null
  return (
    <ul aria-label={t('media.attachments')} className={cn('inline-flex items-center gap-2', className)}>
      {kinds.map(({ kind, count }) => {
        const Icon = ICON[kind]
        const label = count > 1 ? `${t(MEDIA_KEY[kind])}, ${count}` : t(MEDIA_KEY[kind])
        return (
          <li key={kind} className="inline-flex items-center gap-0.5 text-accent-deep" title={label}>
            <Icon size={15} aria-hidden />
            {count > 1 && (
              <span aria-hidden className="text-xs font-semibold tabular-nums leading-none">
                {count}
              </span>
            )}
            <span className="sr-only">{label}</span>
          </li>
        )
      })}
    </ul>
  )
}
