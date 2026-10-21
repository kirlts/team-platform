import { ArrowLeft } from '@/components/icons'
import { Link, useParams } from 'react-router'
import { Avatar } from '@/components/Avatar'
import { useLookups } from '@/components/lookups'
import { ReplyThread } from '@/components/ReplyThread'
import { AreaBadge, StatusBadge } from '@/components/StatusBadge'
import { Thumb } from '@/components/Thumb'
import { Button } from '@/components/ui/button'
import { ApiError, attachmentUrl } from '@/lib/api'
import { stamp } from '@/lib/format'
import { useMessage, useSetClosed } from '@/lib/queries'

export function MessageDetail() {
  const { id } = useParams()
  const message = useMessage(id)
  const setClosed = useSetClosed()
  const { areaTitle, memberName } = useLookups()

  if (message.isPending) return <p className="p-6 text-sm text-muted">Cargando</p>
  if (message.isError) {
    const missing = message.error instanceof ApiError && message.error.status === 404
    return (
      <div className="flex flex-col items-start gap-3 p-6">
        <p role="alert" className="text-sm text-danger">
          {missing ? 'El mensaje no existe' : `No se pudo cargar: ${message.error.message}`}
        </p>
        <Button asChild>
          <Link to="/messages">Mensajes</Link>
        </Button>
      </div>
    )
  }

  const m = message.data
  const closed = m.status === 'closed'
  const audios = m.attachments.filter((a) => a.kind === 'audio')
  const others = m.attachments.filter((a) => a.kind !== 'audio')

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 md:p-6">
      <Link to="/messages" className="inline-flex items-center gap-1 self-start text-xs text-muted hover:text-fg">
        <ArrowLeft size={13} aria-hidden /> Mensajes
      </Link>

      <header className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <h1 className="min-w-0 text-xl font-semibold leading-snug">{m.title}</h1>
          <Button
            variant="secondary"
            disabled={setClosed.isPending}
            onClick={() => setClosed.mutate({ id: m.id, closed: !closed })}
          >
            {closed ? 'Reabrir' : 'Cerrar'}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted">
          <AreaBadge title={areaTitle(m.area_id)} />
          <StatusBadge status={m.status} />
          <span className="inline-flex items-center gap-1.5">
            <Avatar name={memberName(m.author_id) || '?'} size={18} />
            {memberName(m.author_id)}
          </span>
          <time dateTime={m.created_at}>{stamp(m.created_at)}</time>
          {m.assignee_ids.length > 0 && <span>Para {m.assignee_ids.map(memberName).join(', ')}</span>}
          {setClosed.isError && (
            <span role="alert" className="text-danger">
              {setClosed.error.message}
            </span>
          )}
        </div>
      </header>

      <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.body}</p>

      {m.attachments.length > 0 && (
        <section aria-label="Adjuntos" className="flex flex-col gap-3">
          {others.length > 0 && (
            <ul className="flex flex-wrap gap-3">
              {others.map((a) => (
                <li key={a.id}>
                  <Thumb
                    item={{ kind: a.kind, src: a.kind === 'link' ? undefined : attachmentUrl(a.id), name: a.name, size: a.size }}
                    px={96}
                    href={a.kind === 'link' ? a.name : attachmentUrl(a.id)}
                  />
                  <span className="mt-1 block max-w-24 truncate text-xs text-muted">{a.name}</span>
                </li>
              ))}
            </ul>
          )}
          {audios.map((a) => (
            <figure key={a.id} className="flex flex-col gap-1">
              <figcaption className="text-xs text-muted">{a.name}</figcaption>
              <audio controls preload="metadata" src={attachmentUrl(a.id)} className="h-9 w-full max-w-sm" />
            </figure>
          ))}
        </section>
      )}

      <div className="border-t border-line pt-4">
        <ReplyThread message={m} />
      </div>
    </div>
  )
}
