import { useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { FilterBar } from '@/components/FilterBar'
import { MessageCard } from '@/components/MessageCard'
import { Page } from '@/components/Page'
import { PageHeader } from '@/components/PageHeader'
import { parseQuery, serializeQuery, type MessageQuery } from '@/lib/filters'
import { useMe, useMessages } from '@/lib/queries'

export function Messages() {
  const [params, setParams] = useSearchParams()
  const me = useMe().data
  const query = useMemo(() => parseQuery(params), [params])
  const list = useMessages({ query, meId: me?.id ?? '', enabled: !!me })

  const change = (next: MessageQuery) => setParams(serializeQuery(next), { replace: true })

  return (
    <Page cols={10}>
      <PageHeader
        title="Mensajes"
        aside={list.data && <span className="text-xs tabular-nums text-muted">{list.data.length === 1 ? '1 mensaje' : `${list.data.length} mensajes`}</span>}
      />
      <FilterBar query={query} onChange={change} />
      <div className="glass leaf overflow-hidden">
        {list.isPending ? (
          <p className="px-3 py-8 text-center text-sm text-muted">Cargando</p>
        ) : list.isError ? (
          <p role="alert" className="px-3 py-8 text-center text-sm text-danger">
            No se pudo cargar: {list.error.message}
          </p>
        ) : list.data.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted">Sin mensajes</p>
        ) : (
          list.data.map((m) => <MessageCard key={m.id} message={m} />)
        )}
      </div>
    </Page>
  )
}
