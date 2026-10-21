import { ArrowLeft } from '@/components/icons'
import { Link, useParams } from 'react-router'
import { Avatar } from '@/components/Avatar'
import { useLookups } from '@/components/lookups'
import { MediaKinds } from '@/components/MediaKinds'
import { Page } from '@/components/Page'
import { Recipients } from '@/components/Recipients'
import { ReplyThread } from '@/components/ReplyThread'
import { AreaBadge, StatusBadge } from '@/components/StatusBadge'
import { Thumb } from '@/components/Thumb'
import { Button } from '@/components/ui/button'
import { ApiError, attachmentUrl } from '@/lib/api'
import { stamp } from '@/lib/format'
import { MEDIA_LABEL } from '@/lib/media'
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
    <Page cols={8}>
      <Link to="/messages" className="inline-flex items-center gap-1 self-start text-xs text-muted hover:text-fg">
        <ArrowLeft size={13} aria-hidden /> Mensajes
      </Link>

      <header className="flex flex-col gap-3">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4">
          <h1 className="break-words font-sans text-[1.5rem] font-semibold leading-snug">{m.title}</h1>
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
          <time dateTime={m.created_at} className="tabular-nums">
            {stamp(m.created_at)}
          </time>
          <MediaKinds attachments={m.attachments} />
          {setClosed.isError && (
            <span role="alert" className="text-danger">
              {setClosed.error.message}
            </span>
          )}
        </div>
        <Recipients ids={m.assignee_ids} />
      </header>

      <p className="whitespace-pre-wrap leading-relaxed">{m.body}</p>

      {m.attachments.length > 0 && (
        <section aria-label="Adjuntos" className="flex flex-col gap-3">
          {others.length > 0 && (
            <ul className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {others.map((a) => (
                <li key={a.id} className="flex min-w-0 items-center gap-3">
                  <Thumb
                    item={{ kind: a.kind, src: a.kind === 'link' ? undefined : attachmentUrl(a.id), name: a.name, size: a.size }}
                    px={56}
                    href={a.kind === 'link' ? a.name : attachmentUrl(a.id)}
                  />
                  <span className="min-w-0 flex-1 break-words text-xs leading-tight text-muted [overflow-wrap:anywhere]">
                    <span className="block text-sm text-fg">{MEDIA_LABEL[a.kind]}</span>
                    {a.name}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {audios.map((a) => (
            <figure key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <figcaption className="flex min-w-0 basis-full flex-col text-xs leading-tight text-muted [overflow-wrap:anywhere] sm:basis-auto sm:w-40">
                <span className="text-sm text-fg">{MEDIA_LABEL.audio}</span>
                {a.name}
              </figcaption>
              <audio controls preload="metadata" src={attachmentUrl(a.id)} className="h-9 min-w-0 flex-1 basis-60" />
            </figure>
          ))}
        </section>
      )}

      <div className="border-t border-line-strong pt-6">
        <ReplyThread message={m} />
      </div>
    </Page>
  )
}
