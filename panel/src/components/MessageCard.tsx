import { ArrowRight, MessageSquare } from '@/components/icons'
import { useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { attachmentUrl } from '@/lib/api'
import { stamp } from '@/lib/format'
import { useMe, useSetClosed } from '@/lib/queries'
import type { Message } from '@/lib/types'
import { Avatar } from './Avatar'
import { useLookups } from './lookups'
import { ReplyForm } from './ReplyForm'
import { AreaBadge, StatusBadge } from './StatusBadge'
import { Thumb } from './Thumb'

/**
 * Fila de mensaje. La fila entera lleva al detalle; Responder abre el formulario en la misma
 * fila y Cerrar o Reabrir se aplican al instante. En la variante `reply` muestra la última
 * respuesta en lugar del texto del mensaje.
 */
export function MessageCard({ message, variant = 'message' }: { message: Message; variant?: 'message' | 'reply' }) {
  const me = useMe().data
  const { areaTitle, memberName } = useLookups()
  const setClosed = useSetClosed()
  const [replying, setReplying] = useState(false)

  const closed = message.status === 'closed'
  const isAuthor = me?.id === message.author_id
  const reply = message.last_reply
  const main = message.attachments.find((a) => a.kind === 'image') ?? message.attachments[0]
  const recipients = message.assignee_ids.map(memberName).filter(Boolean)
  const authorName = memberName(message.author_id)

  return (
    <article className="relative border-b border-line px-4 py-3.5 last:border-b-0 hover:bg-glass-edge">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <AreaBadge title={areaTitle(message.area_id)} />
            <h3 className="line-clamp-2 min-w-0 flex-1 sm:line-clamp-1">
              <Link
                to={`/messages/${message.id}`}
                className="outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:outline-2 focus-visible:after:outline-accent"
              >
                {message.title}
              </Link>
            </h3>
            <time dateTime={message.created_at} className="shrink-0 text-xs tabular-nums text-muted">
              {stamp(variant === 'reply' && reply ? reply.created_at : message.created_at)}
            </time>
          </div>

          {variant === 'reply' && reply ? (
            <p className="mt-1.5 line-clamp-2 text-sm text-muted">
              <span className="font-medium text-fg">{memberName(reply.author_id)}:</span> {reply.body}
            </p>
          ) : (
            <p className="mt-1.5 line-clamp-2 break-words text-sm text-muted">{message.body}</p>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted">
            <span className="inline-flex min-w-0 flex-1 basis-36 items-center gap-1.5">
              <Avatar name={authorName || '?'} size={18} />
              <span className="truncate">
                {authorName}
                {recipients.length > 0 && (
                  <>
                    <ArrowRight size={11} aria-label="para" className="mx-1 inline text-faint" />
                    {recipients.join(', ')}
                  </>
                )}
              </span>
            </span>
            {message.reply_count > 0 && (
              <span className="inline-flex shrink-0 items-center gap-1" title={`${message.reply_count} respuestas`}>
                <MessageSquare size={13} aria-hidden />
                {message.reply_count}
              </span>
            )}
            <StatusBadge status={message.status} />
            <span className="relative z-10 ml-auto flex shrink-0 items-center gap-1">
              {!isAuthor && !closed && (
                <Button size="sm" variant="ghost" className="text-accent-deep" aria-expanded={replying} onClick={() => setReplying((v) => !v)}>
                  Responder
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="text-muted"
                disabled={setClosed.isPending}
                onClick={() => setClosed.mutate({ id: message.id, closed: !closed })}
              >
                {closed ? 'Reabrir' : 'Cerrar'}
              </Button>
            </span>
          </div>
        </div>
        {main && (
          <Thumb
            item={{ kind: main.kind, src: attachmentUrl(main.id), name: main.name, size: main.size }}
            px={56}
            className="hidden sm:inline-block"
          />
        )}
      </div>
      {replying && (
        <div className="relative z-10 mt-3.5 border-t border-line pt-3.5">
          <ReplyForm messageId={message.id} autoFocus onSent={() => setReplying(false)} />
        </div>
      )}
    </article>
  )
}
