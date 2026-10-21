import { attachmentUrl } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { stamp } from '@/lib/format'
import { useMe } from '@/lib/queries'
import type { MessageDetail } from '@/lib/types'
import { Avatar } from './Avatar'
import { useLookups } from './lookups'
import { MediaKinds } from './MediaKinds'
import { KIND_LABEL, ReplyForm } from './ReplyForm'
import { Thumb } from './Thumb'

/** Hilo lineal de respuestas con el formulario al pie. El emisor no responde su propio mensaje: no ve el formulario. */
export function ReplyThread({ message }: { message: MessageDetail }) {
  const me = useMe().data
  const { memberName } = useLookups()
  const canReply = !!me && me.id !== message.author_id && message.status !== 'closed'

  return (
    <section aria-label="Respuestas" className="flex flex-col">
      <h2 className="mb-4">
        Respuestas <span className="ml-1 text-muted">{message.replies.length}</span>
      </h2>
      {message.replies.length > 0 && (
        <ol className="flex flex-col">
          {message.replies.map((r, i) => {
            const last = i === message.replies.length - 1
            const files = r.attachments ?? []
            return (
              <li key={r.id} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3">
                {/* La columna del avatar lleva el hilo: una línea que baja hasta la respuesta siguiente. */}
                <div className="flex flex-col items-center gap-1 pb-1">
                  <Avatar name={memberName(r.author_id) || '?'} size={24} />
                  {!last && <span aria-hidden className="w-px flex-1 bg-line-strong" />}
                </div>
                <div className={last ? 'flex min-w-0 flex-col gap-1.5 pb-2' : 'flex min-w-0 flex-col gap-1.5 pb-5'}>
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted">
                    <span className="break-words text-[13px] font-semibold text-fg">{memberName(r.author_id)}</span>
                    <Badge tone={r.kind === 'fix' ? 'answered' : 'neutral'}>{KIND_LABEL[r.kind]}</Badge>
                    <time dateTime={r.created_at} className="tabular-nums">
                      {stamp(r.created_at)}
                    </time>
                    <MediaKinds attachments={files} />
                  </div>
                  <p className="whitespace-pre-wrap break-words">{r.body}</p>
                  {files.length > 0 && (
                    <ul aria-label="Adjuntos de la respuesta" className="flex flex-wrap gap-2.5 pt-1">
                      {files.map((a) => (
                        <li key={a.id}>
                          <Thumb
                            item={{ kind: a.kind, src: a.kind === 'link' ? undefined : attachmentUrl(a.id), name: a.name, size: a.size }}
                            px={56}
                            href={a.kind === 'link' ? a.name : attachmentUrl(a.id)}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      )}
      {canReply && (
        <div id="reply" className={message.replies.length ? 'mt-2 border-t border-line pt-3' : ''}>
          <ReplyForm messageId={message.id} />
        </div>
      )}
    </section>
  )
}
