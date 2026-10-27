import { useState } from 'react'
import { X } from '@/components/icons'
import { useT } from '@/i18n'
import { captureLabel } from '@/lib/capture-label'
import { toGalleryItems } from '@/lib/gallery'
import { MEDIA_KEY } from '@/lib/media'
import type { Attachment } from '@team-platform/client'
import { cn } from '@/lib/utils'
import { DownloadLink } from './DownloadLink'
import { AttachmentStrip } from './AttachmentStrip'
import { MediaGalleryDialog } from './MediaGallery'
import { ReplyTranscript } from './ReplyTranscript'

/**
 * What a reply carries. The pictures are already open, the width of the reply, each with its short label over it («Antes», «Después») and no file
 * name; with two of them they sit side by side when the reply is wide enough and one under the other when it is not. A click enlarges one to
 * the whole window. The other media (video, audio, documents, links) keep their named row.
 */
/** «Quitar» of one file of the author's own reply (UD-279): beside the file it takes off, so the file is drawn once. 44 px on a phone. */
export function RemoveFile({ name, onRemove, disabled }: { name?: string; onRemove: () => void; disabled?: boolean }) {
  const t = useT()
  const label = t('media.remove', { name: name ?? t('media.attachments') })
  return (
    <button type="button" data-testid="remove-reply-file" aria-label={label} title={t('media.removeShort')} disabled={disabled} onClick={onRemove} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-danger disabled:opacity-50 max-md:h-11 max-md:w-11 pointer-coarse:h-11 pointer-coarse:w-11">
      <X size={16} aria-hidden />
    </button>
  )
}

export function ReplyMedia({ items, tools, onRemove, removing }: { items: readonly Attachment[]; /** The author's own controls under the media: add (UD-279). */ tools?: React.ReactNode; /** The author's own reply: each file carries its «Quitar». */ onRemove?: (file: Attachment) => void; removing?: boolean }) {
  const t = useT()
  const [open, setOpen] = useState<number | null>(null)
  if (items.length === 0 && !tools) return null
  const gallery = toGalleryItems(items, 'reply')
  const pictures = gallery.map((g, index) => ({ g, index })).filter(({ g }) => g.kind === 'image' && g.src)
  const rest = items.filter((a) => a.kind !== 'image')
  return (
    <div className="@container flex flex-col gap-3 pt-1">
      {pictures.length > 0 && (
        <ul aria-label={t('media.attachments')} className={cn('grid grid-cols-1 gap-3', pictures.length === 2 && '@lg:grid-cols-2')}>
          {pictures.map(({ g, index }) => {
            const named = captureLabel(g.name)
            const alt = named?.alt ?? g.name ?? t(MEDIA_KEY.image)
            return (
              <li key={g.id} className="flex min-w-0 flex-col gap-1.5">
                <div className="flex min-h-0 items-center justify-between gap-2">
                  {named ? <span className="rotulo">{named.label}</span> : <span />}
                  <span className="inline-flex items-center">
                    <DownloadLink href={g.download} name={g.name} className="-my-1.5" />
                    {onRemove && <RemoveFile name={g.name} disabled={removing} onRemove={() => onRemove(items[index]!)} />}
                  </span>
                </div>
                <button type="button" aria-label={t('media.zoom', { name: named ? `${named.label}: ${alt}` : alt })} onClick={() => setOpen(index)} className="block cursor-zoom-in overflow-hidden rounded-md">
                  {/* Eager: in a long thread (message 117 has fourteen replies) a lazy picture below the first screen stays at 0 px until the thread is scrolled to it. */}
                  <img src={g.src} alt={alt} loading="eager" decoding="async" className="max-h-[60dvh] w-full rounded-md bg-raised object-contain object-top" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {rest.length > 0 && <AttachmentStrip items={rest} scope="reply" px={48} named renderAction={onRemove ? (g) => <RemoveFile name={g.name} disabled={removing} onRemove={() => onRemove(items.find((a) => a.id === g.id)!)} /> : undefined} />}
      {gallery.filter((g) => g.transcriptSrc).map((g) => <ReplyTranscript key={g.id} src={g.transcriptSrc as string} name={g.name} />)}
      {tools}
      <MediaGalleryDialog items={gallery} open={open !== null} onOpenChange={(o) => !o && setOpen(null)} index={open ?? 0} />
    </div>
  )
}
