import type { Attachment, AttachmentKind } from '@team-platform/client'

/** Fixed order in which the kinds are drawn, so every row shows the same icons in the same place. */
export const MEDIA_ORDER: readonly AttachmentKind[] = ['image', 'video', 'audio', 'document', 'link']

/** Catalog key of the name of each kind. */
export const MEDIA_KEY = {
  image: 'media.kind.image',
  video: 'media.kind.video',
  audio: 'media.kind.audio',
  document: 'media.kind.document',
  link: 'media.kind.link',
} as const satisfies Record<AttachmentKind, string>

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

/**
 * Kinds of media of a message or a reply: from its attachments when the API sends them, else from
 * `attachment_kinds` (the list endpoint and replies send only the kinds).
 */
export function kindsOf(entity: { attachments?: readonly Pick<Attachment, 'kind'>[]; attachment_kinds?: readonly AttachmentKind[] }): MediaCount[] {
  if (entity.attachments && entity.attachments.length > 0) return mediaKinds(entity.attachments)
  return mediaKinds((entity.attachment_kinds ?? []).map((kind) => ({ kind })))
}

/** The attachment drawn as the main thumbnail: the first photo, else the first video, else the first of any kind. */
export function mainAttachment<T extends Pick<Attachment, 'kind'>>(attachments: readonly T[] | undefined): T | undefined {
  const list = attachments ?? []
  return list.find((a) => a.kind === 'image') ?? list.find((a) => a.kind === 'video') ?? list[0]
}
