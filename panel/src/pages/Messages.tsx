import { useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { FilterBar } from '@/components/FilterBar'
import { MessageList } from '@/components/MessageList'
import { Page } from '@/components/Page'
import { PageHeader } from '@/components/PageHeader'
import { useT } from '@/i18n'
import { parseQuery, serializeQuery, type MessageQuery } from '@team-platform/client'
import { useMe, useMessages } from '@team-platform/client/react'

export function Messages() {
  const t = useT()
  const [params, setParams] = useSearchParams()
  const me = useMe().data
  const query = useMemo(() => parseQuery(params), [params])
  const list = useMessages({ query, meId: me?.id ?? '', enabled: !!me })

  const change = (next: MessageQuery) => setParams(serializeQuery(next), { replace: true })

  return (
    <Page cols={12}>
      <PageHeader title={t('nav.messages')} count={list.data ? t('messages.count', { n: list.data.length }) : undefined} />
      <FilterBar query={query} onChange={change} />
      <MessageList list={list} query={query} onClear={() => change({ ...query, q: '', filters: [] })} none={t('home.noMessages')} />
    </Page>
  )
}
