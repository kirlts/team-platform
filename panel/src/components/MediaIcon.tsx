import { Camera, FileText, Film, Link2, Mic } from '@/components/icons'
import type { AttachmentKind } from '@/lib/types'

/** One icon per kind of medium, the same wherever a kind is drawn (list rows, thumbnails, galleries): none shares a silhouette with another (UD-016). */
export const MEDIA_ICON = { image: Camera, video: Film, audio: Mic, document: FileText, link: Link2 } as const satisfies Record<AttachmentKind, unknown>

export function MediaIcon({ kind, size, className }: { kind: AttachmentKind; size: number; className?: string }) {
  const Icon = MEDIA_ICON[kind]
  return <Icon size={size} aria-hidden data-media-icon={kind} className={className} />
}
