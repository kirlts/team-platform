import { useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { FilterBar } from '@/components/FilterBar'
import { FitList } from '@/components/FitList'
import { MessageCard } from '@/components/MessageCard'
import { Page } from '@/components/Page'
import { PageHeader } from '@/components/PageHeader'
import { useErrorText, useT } from '@/i18n'
import { parseQuery, serializeQuery, type MessageQuery } from '@/lib/filters'
import { useMe, useMessages } from '@/lib/queries'

export function Messages() {
  const t = useT()
  const errorText = useErrorText()
  const [params, setParams] = useSearchParams()
  const me = useMe().data
  const query = useMemo(() => parseQuery(params), [params])
  const list = useMessages({ query, meId: me?.id ?? '', enabled: !!me })
  const rows = useMemo(() => list.data ?? [], [list.data])

  const change = (next: MessageQuery) => setParams(serializeQuery(next), { replace: true })

  return (
    <Page cols={12}>
      <PageHeader title={t('nav.messages')} aside={list.data && <span className="text-xs tabular-nums text-muted">{t('messages.count', { n: list.data.length })}</span>} />
      <FilterBar query={query} onChange={change} />
      <FitList
        rows={rows}
        rowKey={(m) => m.id}
        renderRow={(m) => <MessageCard message={m} />}
        empty={
          list.isPending ? (
            <p className="px-3 py-8 text-center text-sm text-muted">{t('common.loading')}</p>
          ) : list.isError ? (
            <p role="alert" className="px-3 py-8 text-center text-sm text-danger">
              {t('common.loadFailed', { reason: errorText(list.error) })}
            </p>
          ) : (
            <p className="px-3 py-8 text-center text-sm text-muted">{t('home.noMessages')}</p>
          )
        }
      />
    </Page>
  )
}
