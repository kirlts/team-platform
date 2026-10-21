import { Check, Plus, X } from '@/components/icons'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useT } from '@/i18n'
import { attachmentUrl } from '@/lib/api'
import { MEDIA_KEY } from '@/lib/media'
import type { Attachment } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useState } from 'react'
import { toGalleryItems } from '@/lib/gallery'
import { MediaGalleryDialog } from './MediaGallery'
import { Thumb } from './Thumb'

/**
 * Attachments of a proposed message: the first ones as removable thumbnails and, after them, the button
 * that opens the list of all the input's attachments with their mark. Past `max` the button says «+N».
 */
export function AttachmentPicker({ all, selected, onChange, max = 3, onUpload, uploading = false }: { all: Attachment[]; selected: string[]; onChange: (ids: string[]) => void; max?: number; onUpload?: () => void; uploading?: boolean }) {
  const t = useT()
  const [looking, setLooking] = useState<number | null>(null)
  const included = all.filter((a) => selected.includes(a.id))
  const shown = included.slice(0, max)
  const hidden = included.length - shown.length
  const addClass = 'hit inline-flex items-center justify-center gap-1 rounded-md px-1.5 text-xs font-semibold text-muted hover:bg-hover hover:text-accent'
  if (all.length === 0) {
    if (!onUpload) return null
    // Nothing to choose from: the one control to add goes straight to the files, with the same shape as «+ Destinatario».
    return (
      <ul aria-label={t('media.attachments')} className="flex flex-wrap items-center gap-2">
        <li>
          <button type="button" aria-label={t('published.addFiles')} title={t('published.addFiles')} disabled={uploading} onClick={onUpload} className={cn(addClass, 'disabled:opacity-50')}>
            <Plus size={13} aria-hidden /> {t('media.addShort')}
          </button>
        </li>
      </ul>
    )
  }
  return (
    <ul aria-label={t('media.attachments')} className="flex w-full flex-wrap items-center gap-2">
      {shown.map((a, i) => (
        // One chip per attachment, like the ones in the compose bar: the picture, its name and the remove inside the same frame (J3-B-11).
        <li key={a.id} className="flex min-h-9 min-w-0 max-w-full items-center gap-2 rounded-md border border-line-strong bg-surface py-0.5 pl-1 pr-0.5">
          {/* The picture opens the gallery over what this message carries, on that one. */}
          <button type="button" onClick={() => setLooking(i)} aria-label={t('gallery.item', { n: i + 1, total: included.length, name: a.name ?? t(MEDIA_KEY[a.kind]) })} className="block rounded-md">
            <Thumb item={{ kind: a.kind, src: a.kind === 'link' ? undefined : attachmentUrl(a.id), name: a.name, size: a.size }} px={28} />
          </button>
          <span className="min-w-0 max-w-[14rem] text-xs leading-tight text-muted [overflow-wrap:anywhere]">{a.name}</span>
          <button type="button" onClick={() => onChange(selected.filter((x) => x !== a.id))} aria-label={t('media.remove', { name: a.name ?? t(MEDIA_KEY[a.kind]) })} className="hit inline-flex shrink-0 items-center justify-center rounded-full text-muted hover:bg-hover hover:text-danger">
            <X size={13} aria-hidden />
          </button>
        </li>
      ))}
      <li>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={t('media.pick')}
              title={t('media.pick')}
              className={addClass}
            >
              {hidden > 0 ? `+${hidden}` : (
                <>
                  <Plus size={13} aria-hidden /> {t('media.addShort')}
                </>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-1" collisionPadding={8}>
            <ul data-lane="attachment-picker" className="scroll-thin flex max-h-72 flex-col overflow-y-auto">
              {all.map((a) => {
                const on = selected.includes(a.id)
                return (
                  <li key={a.id}>
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={on}
                      onClick={() => onChange(on ? selected.filter((x) => x !== a.id) : [...selected, a.id])}
                      className={cn('flex min-h-9 w-full items-center gap-2 rounded-sm px-2 py-1 text-left hover:bg-hover', on && 'bg-accent-soft/40')}
                    >
                      <Thumb item={{ kind: a.kind, src: a.kind === 'link' ? undefined : attachmentUrl(a.id), name: a.name, size: a.size }} px={28} />
                      <span className="min-w-0 flex-1 text-xs leading-tight [overflow-wrap:anywhere]">
                        <span className="block text-sm">{t(MEDIA_KEY[a.kind])}</span>
                        <span className="text-muted">{a.name}</span>
                      </span>
                      <span aria-hidden className="inline-flex w-4 text-accent">
                        {on && <Check size={14} />}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
            {onUpload && (
              <button type="button" disabled={uploading} onClick={onUpload} className="flex min-h-9 w-full items-center gap-2 rounded-sm border-t border-line px-2 py-1 text-left text-sm font-semibold hover:bg-hover disabled:opacity-50">
                <Plus size={14} aria-hidden /> {t('media.upload')}
              </button>
            )}
          </PopoverContent>
        </Popover>
      </li>
      <MediaGalleryDialog items={toGalleryItems(included)} open={looking !== null} onOpenChange={(o) => !o && setLooking(null)} index={looking ?? 0} />
    </ul>
  )
}
