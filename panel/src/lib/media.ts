import type { Attachment, AttachmentKind } from './types'

/** Fixed order in which the kinds are drawn, so every row shows the same icons in the same place. */
export const MEDIA_ORDER: readonly AttachmentKind[] = ['image', 'video', 'audio', 'document', 'link']

export const MEDIA_LABEL: Record<AttachmentKind, string> = {
  image: 'Foto',
  video: 'Video',
  audio: 'Audio',
  document: 'Documento',
  link: 'Enlace',
}

export interface MediaCount {
  kind: AttachmentKind
  count: number
}

/** One entry per kind present, in `MEDIA_ORDER`, with how many attachments of that kind there are. */
export function mediaKinds(attachments: readonly Pick<Attachment, 'kind'>[] | undefined): MediaCount[] {
  const counts = new Map<AttachmentKind, number>()
  for (const a of attachments ?? []) counts.set(a.kind, (counts.get(a.kind) ?? 0) + 1)
  return MEDIA_ORDER.filter((k) => counts.has(k)).map((kind) => ({ kind, count: counts.get(kind) ?? 0 }))
}

/** The attachment drawn as the main thumbnail: the first photo, else the first video, else the first of any kind. */
export function mainAttachment<T extends Pick<Attachment, 'kind'>>(attachments: readonly T[] | undefined): T | undefined {
  const list = attachments ?? []
  return list.find((a) => a.kind === 'image') ?? list.find((a) => a.kind === 'video') ?? list[0]
}
