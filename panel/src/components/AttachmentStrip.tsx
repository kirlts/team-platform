import { Menu } from '@/components/icons'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useT } from '@/i18n'
import { attachmentUrl } from '@/lib/api'
import { MEDIA_KEY } from '@/lib/media'
import type { Attachment } from '@/lib/types'
import { cn } from '@/lib/utils'
import { AudioPlayer } from './AudioPlayer'
import { Thumb } from './Thumb'

const source = (a: Attachment) => ({ kind: a.kind, src: a.kind === 'link' ? undefined : attachmentUrl(a.id), name: a.name, size: a.size })
const target = (a: Attachment) => (a.kind === 'link' ? a.name : attachmentUrl(a.id))

/**
 * Attachments of a message or an input: the first ones as thumbnails and the rest behind «+N», which
 * opens the full list (name, kind and a player for audio) on top of the page. The strip never grows
 * past one row (UD-017: what is not needed now folds, with its count).
 */
export function AttachmentStrip({ items, max = 4, px = 40, className }: { items: readonly Attachment[]; max?: number; px?: number; className?: string }) {
  const t = useT()
  if (items.length === 0) return null
  const shown = items.slice(0, max)
  const hidden = items.length - shown.length
  return (
    <ul aria-label={t('media.attachments')} className={cn('flex flex-wrap items-center gap-2', className)}>
      {shown.map((a) => (
        <li key={a.id}>
          <Thumb item={source(a)} px={px} href={target(a)} />
        </li>
      ))}
      <li>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={hidden > 0 ? t('media.allMore', { n: hidden }) : t('media.all')}
              className="inline-flex h-7 min-w-7 items-center justify-center rounded-md border border-dashed border-line-strong px-1.5 text-xs font-semibold text-muted hover:border-accent hover:text-accent"
            >
              {hidden > 0 ? `+${hidden}` : <Menu size={14} aria-hidden />}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 p-2">
            <ul data-lane="attachment-list" className="scroll-thin flex max-h-80 flex-col gap-2 overflow-y-auto">
              {items.map((a) => (
                <li key={a.id} className="flex min-w-0 flex-col gap-1.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <Thumb item={source(a)} px={36} href={target(a)} />
                    <span className="min-w-0 flex-1 text-xs leading-tight text-muted [overflow-wrap:anywhere]">
                      <span className="block text-sm text-fg">{t(MEDIA_KEY[a.kind])}</span>
                      {a.name}
                    </span>
                  </span>
                  {a.kind === 'audio' && <AudioPlayer src={attachmentUrl(a.id)} name={a.name ?? t(MEDIA_KEY.audio)} />}
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      </li>
    </ul>
  )
}
