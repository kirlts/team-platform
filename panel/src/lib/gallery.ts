import { attachmentUrl, replyAttachmentUrl } from './api'
import type { Attachment, AttachmentKind } from './types'

/** What the gallery draws for one medium. `src` is absent for a link (it has an address, not a file). */
export interface GalleryItem {
  id: string
  kind: AttachmentKind
  /** Address of the file in the API. */
  src?: string
  /** Original file name, or the address of a link. */
  name?: string
  size?: number
  mime?: string
  /** Address of the extracted text (audio and video), only when the server has one. */
  transcriptSrc?: string
}

/** Which id space an attachment belongs to: a message and its input share one; a reply has its own (`GET /replies/attachments/:id`). */
export type AttachmentScope = 'message' | 'reply'

export function transcriptUrl(id: string): string {
  return `${attachmentUrl(id)}/transcript`
}

/** The gallery items of a list of attachments. A transcript is offered only where the server says it extracted text. */
export function toGalleryItems(attachments: readonly Attachment[] | undefined, scope: AttachmentScope = 'message'): GalleryItem[] {
  const file = scope === 'reply' ? replyAttachmentUrl : attachmentUrl
  return (attachments ?? []).map((a) => ({
    id: a.id,
    kind: a.kind,
    src: a.kind === 'link' ? undefined : file(a.id),
    name: a.name,
    size: a.size,
    mime: a.mime,
    transcriptSrc: scope === 'message' && a.extracted && (a.kind === 'audio' || a.kind === 'video') ? transcriptUrl(a.id) : undefined,
  }))
}

/** Domain of a link, or the text as it came when it is not an address. */
export function linkDomain(address: string | undefined): string {
  if (!address) return ''
  try {
    return new URL(address).hostname.replace(/^www\./, '')
  } catch {
    return address
  }
}

/** The index that follows `from` in `dir`, clamped to the ends: the gallery does not loop, so the end is felt. */
export function stepIndex(from: number, dir: 1 | -1, total: number): number {
  return Math.min(Math.max(from + dir, 0), Math.max(total - 1, 0))
}
