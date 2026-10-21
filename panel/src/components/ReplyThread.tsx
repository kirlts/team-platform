import { Badge } from '@/components/ui/badge'
import { stamp } from '@/lib/format'
import { useMe } from '@/lib/queries'
import type { MessageDetail } from '@/lib/types'
import { Avatar } from './Avatar'
import { useLookups } from './lookups'
import { KIND_LABEL, ReplyForm } from './ReplyForm'

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
        <ol className="flex flex-col border-l-2 border-line-strong pl-5">
          {message.replies.map((r) => (
            <li key={r.id} className="relative pb-4 last:pb-2">
              <span className="absolute -left-[31px] top-0 rounded-full">
                <Avatar name={memberName(r.author_id) || '?'} size={20} />
              </span>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <span className="text-[13px] font-semibold text-fg">{memberName(r.author_id)}</span>
                <Badge tone={r.kind === 'fix' ? 'answered' : 'neutral'}>{KIND_LABEL[r.kind]}</Badge>
                <time dateTime={r.created_at}>{stamp(r.created_at)}</time>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap">{r.body}</p>
            </li>
          ))}
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
