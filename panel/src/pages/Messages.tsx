import { useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { FilterBar } from '@/components/FilterBar'
import { FitList } from '@/components/FitList'
import { MessageCard } from '@/components/MessageCard'
import { Page } from '@/components/Page'
import { PageHeader } from '@/components/PageHeader'
import { LoadState } from '@/components/LoadState'
import { useT } from '@/i18n'
import { parseQuery, serializeQuery, type MessageQuery } from '@/lib/filters'
import { useMe, useMessages } from '@/lib/queries'

export function Messages() {
  const t = useT()
  const [params, setParams] = useSearchParams()
  const me = useMe().data
  const query = useMemo(() => parseQuery(params), [params])
  const list = useMessages({ query, meId: me?.id ?? '', enabled: !!me })
  const rows = useMemo(() => list.data ?? [], [list.data])

  const change = (next: MessageQuery) => setParams(serializeQuery(next), { replace: true })

  return (
    <Page cols={12}>
      <PageHeader title={t('nav.messages')} count={list.data ? t('messages.count', { n: list.data.length }) : undefined} />
      <FilterBar query={query} onChange={change} />
      <FitList
        rows={rows}
        rowKey={(m) => m.id}
        renderRow={(m) => <MessageCard message={m} />}
        empty={
          list.isPending || list.isError ? (
            <LoadState query={list} rows={4} />
          ) : query.q || query.filters.length > 0 ? (
            <EmptyState
              action={
                <Button size="sm" onClick={() => change({ ...query, q: '', filters: [] })}>
                  {t('messages.clearSearch')}
                </Button>
              }
            >
              {query.q ? t('messages.noMatch', { q: query.q }) : t('messages.noMatchFilters')}
            </EmptyState>
          ) : (
            <EmptyState>{t('home.noMessages')}</EmptyState>
          )
        }
      />
    </Page>
  )
}
