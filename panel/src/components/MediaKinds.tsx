import { useT } from '@/i18n'
import { kindsOf, MEDIA_KEY } from '@/lib/media'
import type { Attachment, AttachmentKind } from '@team-platform/client'
import { cn } from '@/lib/utils'
import { MediaIcon } from './MediaIcon'


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
        const label = count > 1 ? `${t(MEDIA_KEY[kind])}, ${count}` : t(MEDIA_KEY[kind])
        return (
          <li key={kind} className="inline-flex items-center gap-0.5 text-muted" title={label}>
            <MediaIcon kind={kind} size={15} />
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
