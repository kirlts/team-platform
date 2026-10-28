import { useCallback, useMemo, type ReactNode } from 'react'
import { EmptyState } from '@/components/EmptyState'
import { FitList } from '@/components/FitList'
import { LoadState } from '@/components/LoadState'
import { MessageCard } from '@/components/MessageCard'
import { SelectionBar, SelectionFoot } from '@/components/SelectionBar'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import type { MessageQuery, Message } from '@team-platform/client'
import { useDeleteMessages, useMe, useRestoreMessages, type useMessages } from '@team-platform/client/react'
import { useNotices } from '@/lib/notices'
import { SelectionProvider, useSelection, type SelectionScope } from '@/lib/selection'

/**
 * The list of messages that fits its frame, one row per message. Mensajes and the view of an area draw the same list and
 * the same row (UD-041); they differ in the query they ask and in what they say when it is empty. `hideArea` drops the area chip of
 * each row when the whole view is that area; `footer` is drawn right under the list (see `FitList`).
 *
 * Each message the person may delete (any, for a person of the team) carries a check box; marking one shows the strip over the list
 * with the buttons to mark all, delete and cancel (UD-253). Borrar deletes them at once without asking, and the notice carries Deshacer.
 * `noneAction` is the one action of a list that has nothing yet (what fills it).
 */
export function MessageList({ list, query, onClear, none, noneAction, hideArea = false, footer, filtered }: { list: ReturnType<typeof useMessages>; query: MessageQuery; onClear: () => void; none: ReactNode; noneAction?: ReactNode; hideArea?: boolean; footer?: ReactNode; /** Whether the person narrowed the list. By default any filter or text does; the view of an area always carries its own area filter, which narrows nothing the person chose, so it says it. */ filtered?: boolean }) {
  const t = useT()
  const me = useMe().data
  const notices = useNotices()
  const del = useDeleteMessages()
  const restore = useRestoreMessages()
  const rows = useMemo(() => list.data ?? [], [list.data])
  const selection = useSelection()
  const canMark = useCallback((m: Message | undefined) => !!m && !!me && !m.deleted_at, [me])
  const byId = useMemo(() => new Map(rows.map((m) => [m.id, m])), [rows])
  const scope = useMemo<SelectionScope>(() => ({ ...selection, canMark: (id) => canMark(byId.get(id)) }), [selection, canMark, byId])

  // A marked row that left the list (deleted elsewhere, filtered out) is not deleted by Borrar.
  const marked = [...selection.marked].filter((id) => canMark(byId.get(id)))
  // Every row of the list as filtered, not only the page on screen: the mark-all control marks them all and the strip counts against them.
  const markable = useMemo(() => rows.filter((m) => canMark(m)).map((m) => m.id), [rows, canMark])
  const remove = async () => {
    const ids = marked
    if (!ids.length) return
    await del.mutateAsync(ids)
    selection.clear()
    notices.show({
      text: t('bulk.messagesDeleted', { n: ids.length }),
      action: {
        label: t('undo.undo'),
        run: async () => {
          await restore.mutateAsync(ids)
          notices.show({ text: t('bulk.messagesRestored', { n: ids.length }) })
        },
      },
    })
  }

  const bar =
    marked.length > 0 ? (
      <SelectionFoot>
        <SelectionBar className="border-b-0" selection={selection} total={markable.length} busy={del.isPending} onAll={() => selection.add(markable)} onDelete={() => void remove()} />
      </SelectionFoot>
    ) : null

  return (
    <SelectionProvider scope={scope}>
      <FitList
        rows={rows}
        rowKey={(m) => m.id}
        footer={bar || footer ? <>{bar}{footer}</> : undefined}
        renderRow={(m) => <MessageCard message={m} hideArea={hideArea} />}
        empty={
          list.isPending || list.isError ? (
            <LoadState query={list} rows={4} tall />
          ) : (filtered ?? (query.q || query.filters.length > 0)) ? (
            <EmptyState
              action={
                <Button size="lg" onClick={onClear}>
                  {t('messages.clearSearch')}
                </Button>
              }
            >
              {query.q ? t('messages.noMatch', { q: query.q }) : t('messages.noMatchFilters')}
            </EmptyState>
          ) : (
            <EmptyState action={noneAction}>{none}</EmptyState>
          )
        }
      />
    </SelectionProvider>
  )
}
