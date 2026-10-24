import { useState } from 'react'
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
export function ReplyMedia({ items, tools }: { items: readonly Attachment[]; /** The author's own controls under the media: add and remove (UD-277). */ tools?: React.ReactNode }) {
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
                  <DownloadLink href={g.download} name={g.name} className="-my-1.5" />
                </div>
                <button type="button" aria-label={t('media.zoom', { name: named ? `${named.label}: ${alt}` : alt })} onClick={() => setOpen(index)} className="block cursor-zoom-in overflow-hidden rounded-md">
                  <img src={g.src} alt={alt} loading="lazy" className="max-h-[60dvh] w-full rounded-md bg-raised object-contain object-top" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {rest.length > 0 && <AttachmentStrip items={rest} scope="reply" px={48} named />}
      {gallery.filter((g) => g.transcriptSrc).map((g) => <ReplyTranscript key={g.id} src={g.transcriptSrc as string} name={g.name} />)}
      {tools}
      <MediaGalleryDialog items={gallery} open={open !== null} onOpenChange={(o) => !o && setOpen(null)} index={open ?? 0} />
    </div>
  )
}
