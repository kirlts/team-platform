import { MessageSquare } from '@/components/icons'
import { useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { attachmentUrl } from '@/lib/api'
import { stamp } from '@/lib/format'
import { mainAttachment } from '@/lib/media'
import { useMe, useSetClosed } from '@/lib/queries'
import type { Message } from '@/lib/types'
import { Avatar } from './Avatar'
import { useLookups } from './lookups'
import { MediaKinds } from './MediaKinds'
import { Recipients } from './Recipients'
import { ReplyForm } from './ReplyForm'
import { AreaBadge, StatusBadge } from './StatusBadge'
import { Thumb } from './Thumb'

/**
 * Fila de mensaje, con la disposición de la maqueta: pestaña de área y emisor arriba; debajo,
 * fecha con los íconos de medio, título y texto a la izquierda y la miniatura principal a la
 * derecha; al pie, los destinatarios y las acciones. La fila entera lleva al detalle; Responder
 * abre el formulario en la misma fila y Cerrar o Reabrir se aplican al instante. En la variante
 * `reply` muestra la última respuesta: su autor, su fecha, sus medios y su texto.
 */
export function MessageCard({ message, variant = 'message' }: { message: Message; variant?: 'message' | 'reply' }) {
  const me = useMe().data
  const { areaTitle, memberName } = useLookups()
  const setClosed = useSetClosed()
  const [replying, setReplying] = useState(false)

  const closed = message.status === 'closed'
  const isAuthor = me?.id === message.author_id
  const reply = variant === 'reply' ? message.last_reply : null
  // Fila de respuesta: el emisor, la fecha, los medios y la miniatura son los de la respuesta.
  const from = reply ?? message
  const main = mainAttachment(from.attachments)

  return (
    <article className="relative flex flex-col gap-2 border-b border-line px-4 py-4 last:border-b-0 hover:bg-glass-edge">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3">
        <span className="flex">
          <AreaBadge title={areaTitle(message.area_id)} />
        </span>
        <span className="inline-flex max-w-[11rem] items-center gap-1.5 text-xs leading-tight text-muted">
          <Avatar name={memberName(from.author_id) || '?'} size={20} />
          {memberName(from.author_id)}
        </span>
      </div>

      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted">
            <time dateTime={from.created_at} className="tabular-nums">
              {stamp(from.created_at)}
            </time>
            <MediaKinds attachments={from.attachments} />
            <StatusBadge status={message.status} />
          </div>
          <h3 className="break-words">
            <Link
              to={`/messages/${message.id}`}
              className="outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:outline-2 focus-visible:after:outline-accent"
            >
              {message.title}
            </Link>
          </h3>
          <p className="whitespace-pre-line break-words text-sm text-muted">{reply ? reply.body : message.body}</p>
        </div>
        {main && (
          <Thumb item={{ kind: main.kind, src: main.kind === 'link' ? undefined : attachmentUrl(main.id), name: main.name, size: main.size }} px={56} />
        )}
      </div>

      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1.5 text-xs text-muted">
        <Recipients ids={variant === 'message' ? message.assignee_ids : []} className="min-w-0 flex-1 basis-full sm:basis-40">
          {message.reply_count > 0 && (
            <li className="inline-flex items-center gap-1" title={`${message.reply_count} respuestas`}>
              <MessageSquare size={13} aria-hidden />
              {message.reply_count}
            </li>
          )}
        </Recipients>
        <span className="relative z-10 ml-auto flex items-center gap-1">
          {!isAuthor && !closed && (
            <Button size="sm" variant="ghost" className="text-accent-deep" aria-expanded={replying} onClick={() => setReplying((v) => !v)}>
              Responder
            </Button>
          )}
          <Button size="sm" variant="ghost" className="text-muted" disabled={setClosed.isPending} onClick={() => setClosed.mutate({ id: message.id, closed: !closed })}>
            {closed ? 'Reabrir' : 'Cerrar'}
          </Button>
        </span>
      </div>
      {replying && (
        <div className="relative z-10 mt-1.5 border-t border-line pt-3.5">
          <ReplyForm messageId={message.id} autoFocus onSent={() => setReplying(false)} />
        </div>
      )}
    </article>
  )
}
