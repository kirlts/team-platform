import { useMemo, type ReactNode } from 'react'
import { EmptyState } from '@/components/EmptyState'
import { FitList } from '@/components/FitList'
import { LoadState } from '@/components/LoadState'
import { MessageCard } from '@/components/MessageCard'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import type { MessageQuery } from '@/lib/filters'
import type { useMessages } from '@/lib/queries'

/**
 * The list of messages that fits its frame, one row per message. Mensajes and the view of an area draw the same list and
 * the same row (UD-041); they differ in the query they ask and in what they say when it is empty.
 */
export function MessageList({ list, query, onClear, none }: { list: ReturnType<typeof useMessages>; query: MessageQuery; onClear: () => void; none: ReactNode }) {
  const t = useT()
  const rows = useMemo(() => list.data ?? [], [list.data])
  return (
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
              <Button size="sm" onClick={onClear}>
                {t('messages.clearSearch')}
              </Button>
            }
          >
            {query.q ? t('messages.noMatch', { q: query.q }) : t('messages.noMatchFilters')}
          </EmptyState>
        ) : (
          <EmptyState>{none}</EmptyState>
        )
      }
    />
  )
}
