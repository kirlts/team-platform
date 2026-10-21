import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { AnalysisPanel } from '@/components/AnalysisPanel'
import { ComposeBar } from '@/components/ComposeBar'
import { InputPreview } from '@/components/InputPreview'
import { MessageCard } from '@/components/MessageCard'
import { Page } from '@/components/Page'
import { PageHeader } from '@/components/PageHeader'
import { Segmented } from '@/components/Segmented'
import { ApiError } from '@/lib/api'
import { clock, longDate } from '@/lib/format'
import { useInput, useMe, useMessages } from '@/lib/queries'
import { ME, type MessageQuery } from '@/lib/filters'

const ACTIVE_KEY = 'team-active-input'

function readActive(): string | undefined {
  try {
    return localStorage.getItem(ACTIVE_KEY) ?? undefined
  } catch {
    return undefined
  }
}

function writeActive(id: string | undefined) {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id)
    else localStorage.removeItem(ACTIVE_KEY)
  } catch {
    // Sin almacenamiento, la propuesta no sobrevive a una recarga de la pestaña.
  }
}

/** Cantidad de filas que muestra cada columna; el resto está en Mensajes. Es de pantalla. */
const FEED_ROWS = 6

export function Home() {
  const me = useMe().data
  const [now, setNow] = useState(() => new Date())
  const [activeId, setActiveId] = useState<string | undefined>(readActive)
  const input = useInput(activeId)

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000)
    return () => clearInterval(t)
  }, [])

  const close = () => {
    writeActive(undefined)
    setActiveId(undefined)
  }

  // Un input que ya no existe, se publicó o se canceló deja libre la zona de análisis.
  useEffect(() => {
    const err = input.error
    if (err instanceof ApiError && err.status === 404) close()
    const status = input.data?.status
    if (status === 'published' || status === 'cancelled') close()
  }, [input.error, input.data?.status])

  return (
    <Page cols={12} section>
      <PageHeader
        title={me?.project_name ?? ''}
        aside={
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
            <time dateTime={now.toISOString()}>
              {longDate(now)} <span className="text-accent-deep">{clock(now)}</span>
            </time>
          </p>
        }
      />

      <section aria-label="Nuevo mensaje" className="flex flex-col gap-2.5">
        <h2>Nuevo mensaje</h2>
        <ComposeBar
          disabled={!!activeId && input.data?.status !== 'failed'}
          onCreated={(created) => {
            writeActive(created.input_id)
            setActiveId(created.input_id)
          }}
        />
      </section>

      {input.data && (
        <div className="glass leaf grid gap-x-10 gap-y-8 p-6 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <InputPreview input={input.data} />
          <AnalysisPanel input={input.data} onClose={close} />
        </div>
      )}

      <div className="grid gap-x-10 gap-y-10 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Feed kind="messages" meId={me?.id ?? ''} />
        <Feed kind="replies" meId={me?.id ?? ''} />
      </div>
    </Page>
  )
}

function Feed({ kind, meId }: { kind: 'messages' | 'replies'; meId: string }) {
  const [mine, setMine] = useState(true)
  const query: MessageQuery = { filters: mine ? [{ prop: 'for', op: 'eq', value: ME }] : [], q: '' }
  const feed = useMessages({ query, meId, repliesFeed: kind === 'replies', enabled: !!meId })
  const rows = (feed.data ?? []).slice(0, FEED_ROWS)
  const all = (feed.data ?? []).length

  const params = new URLSearchParams()
  if (mine) params.append('f', `for:eq:${ME}`)
  if (kind === 'replies') params.append('f', 'replies:eq:con')

  return (
    <section aria-label={kind === 'messages' ? 'Últimos mensajes' : 'Últimas respuestas'} className="flex min-w-0 flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2>{kind === 'messages' ? 'Últimos mensajes' : 'Últimas respuestas'}</h2>
        <Segmented
          label={kind === 'messages' ? 'Mensajes mostrados' : 'Respuestas mostradas'}
          size="sm"
          value={mine ? 'mine' : 'all'}
          onChange={(v) => setMine(v === 'mine')}
          options={[
            { value: 'mine', label: kind === 'messages' ? 'Para mí' : 'Que me involucran' },
            { value: 'all', label: kind === 'messages' ? 'Todos' : 'Todas' },
          ]}
        />
      </div>
      <div className="glass leaf overflow-hidden">
        {feed.isPending ? (
          <p className="px-3 py-6 text-center text-sm text-muted">Cargando</p>
        ) : rows.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted">{kind === 'messages' ? 'Sin mensajes' : 'Sin respuestas'}</p>
        ) : (
          rows.map((m) => <MessageCard key={m.id} message={m} variant={kind === 'replies' ? 'reply' : 'message'} />)
        )}
      </div>
      {all > FEED_ROWS && (
        <Link to={`/messages?${params.toString()}`} className="self-end text-xs text-accent hover:underline">
          Ver los {all}
        </Link>
      )}
    </section>
  )
}
