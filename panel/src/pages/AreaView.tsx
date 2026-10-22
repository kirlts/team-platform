import { ChevronLeft, Trash2 } from '@/components/icons'
import { useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Templates, descriptionRule, nameRule } from '@/components/AreaTemplates'
import { AreaColorPicker } from '@/components/AreaColorPicker'
import { EditableText } from '@/components/EditableText'
import { EmptyState } from '@/components/EmptyState'
import { Fold } from '@/components/Fold'
import { FoldedText } from '@/components/FoldedText'
import { LoadState } from '@/components/LoadState'
import { MessageList } from '@/components/MessageList'
import { Page } from '@/components/Page'
import { StateTabs } from '@/components/StateTabs'
import { UndoButtons } from '@/components/UndoButtons'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import { parseQuery, serializeQuery, upsertFilter, removeFilter, type MessageQuery } from '@/lib/filters'
import { areaCounts } from '@/lib/pending'
import { useNotices } from '@/lib/notices'
import { useDeleteArea, useMe, useMessages, useRestoreArea, useSaveArea, useSummary, useTemplates } from '@/lib/queries'
import type { Area, MessageStatus } from '@/lib/types'
import { UndoProvider, useUndo, useUndoStack } from '@/lib/undo'

/**
 * The view of one area (UD-041): its messages first, with the filter by the three states and the count of each; and, folded
 * under them, its description edited in place and its templates. The state chosen lives in the URL (`?f=status:eq:open`),
 * so the back button and a link from a count in the sidebar or in Inicio arrive at the same place.
 */
export function AreaView({ area }: { area: Area }) {
  const undo = useUndoStack()
  return (
    <UndoProvider stack={undo}>
      <AreaViewBody area={area} />
    </UndoProvider>
  )
}

function AreaViewBody({ area }: { area: Area }) {
  const t = useT()
  const undoStack = useUndo()
  const me = useMe().data
  const save = useSaveArea()
  const del = useDeleteArea()
  const restore = useRestoreArea()
  const notices = useNotices()
  const navigate = useNavigate()
  const summary = useSummary().data
  const templates = useTemplates(area.id)
  const [params, setParams] = useSearchParams()
  const chosen = useMemo(() => parseQuery(params), [params])
  const status = (chosen.filters.find((f) => f.prop === 'status' && f.op === 'eq')?.value ?? null) as MessageStatus | null
  // The area is the view's own filter; the state is the only one the person moves here.
  const query = useMemo<MessageQuery>(() => ({ filters: [{ prop: 'area', op: 'eq', value: area.id }, ...(status ? [{ prop: 'status' as const, op: 'eq' as const, value: status }] : [])], q: '' }), [area.id, status])
  const list = useMessages({ query, meId: me?.id ?? '', enabled: !!me })
  const counts = areaCounts(summary, area.id)
  const templateCount = (templates.data ?? []).filter((x) => !x.deleted_at).length

  const choose = (next: MessageStatus | null) =>
    setParams(serializeQuery({ q: '', filters: next ? upsertFilter(chosen.filters, { prop: 'status', op: 'eq', value: next }) : removeFilter(chosen.filters, 'status') }), { replace: true })

  const change = (field: 'title' | 'description', next: string) => {
    const prev = area[field]
    return undoStack.run({ label: t('areas.edited'), redo: () => save.mutateAsync({ id: area.id, [field]: next }), undo: () => save.mutateAsync({ id: area.id, [field]: prev }) })
  }

  // The Editor deletes the area (UD-240): it is done, the list of areas is shown and the strip carries Deshacer, which brings it back.
  const remove = async () => {
    await del.mutateAsync(area.id)
    navigate('/areas')
    notices.show({
      text: t('areas.areaDeleted'),
      action: {
        label: t('undo.undo'),
        run: async () => {
          await restore.mutateAsync(area.id)
          notices.show({ text: t('areas.areaRestored'), link: { to: `/areas/${area.id}`, label: area.title } })
        },
      },
    })
  }

  const changeColor = (next: string) => {
    const prev = area.color
    return undoStack.run({ label: t('areas.colorEdited'), redo: () => save.mutateAsync({ id: area.id, color: next }), undo: () => save.mutateAsync({ id: area.id, color: prev }) })
  }

  return (
    <Page cols={12}>
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
          <Link to="/areas" className="inline-flex items-center gap-0.5 text-sm font-semibold text-accent-deep hover:underline">
            <ChevronLeft size={14} aria-hidden />
            {t('areas.back')}
          </Link>
          {/* The same square the list of areas and the sidebar carry: the title says which area this is by its color too (UD-045), and it is the control to change it. */}
          <span className="self-center">
            <AreaColorPicker title={area.title} color={area.color} onChange={changeColor} />
          </span>
          <h1 className="min-w-0 break-words">
            <EditableText value={area.title} label={t('areas.fieldTitle')} validate={nameRule(t)} onSave={(v) => change('title', v)} />
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <UndoButtons stack={undoStack} />
          {me?.role === 'editor' && (
            <Button size="sm" variant="ghost" className="text-danger" disabled={del.isPending} data-testid="area-delete" onClick={() => void remove()}>
              <Trash2 size={13} aria-hidden /> {t('areas.deleteArea')}
            </Button>
          )}
        </div>
      </header>
      <StateTabs value={status} counts={counts} onChange={choose} label={t('areas.states')} />
      <MessageList
        list={list}
        query={query}
        onClear={() => choose(null)}
        none={status ? t('areas.noMessagesState') : t('areas.noMessages')}
        hideArea
        footer={
          <div className="flex flex-col gap-2 pt-4">
            <Fold title={t('areas.description')}>
              {/* The description edited in place on the left; the right side is the place of the area's color control. */}
              <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
                <div data-lane="area-description" className="scroll-thin max-h-[32dvh] min-w-0 flex-1 basis-80 overflow-y-auto pr-1">
                  <FoldedText value={area.description} label={t('areas.fieldDescription')} validate={descriptionRule(t)} onSave={(v) => change('description', v)} displayClassName="text-sm" />
                </div>
                <div data-slot="area-color" className="shrink-0 empty:hidden" />
              </div>
            </Fold>
            <Fold title={t('areas.templates')} note={templateCount}>
              <div className="flex h-[min(22rem,38dvh)] min-h-0 flex-col max-md:h-auto">
                <Templates area={area} />
              </div>
            </Fold>
          </div>
        }
      />
    </Page>
  )
}

export function AreaNotFound({ loading, query }: { loading: boolean; query: Parameters<typeof LoadState>[0]['query'] }) {
  const t = useT()
  return (
    <Page cols={12}>
      <Link to="/areas" className="inline-flex items-center gap-0.5 text-sm font-semibold text-accent-deep hover:underline">
        <ChevronLeft size={14} aria-hidden />
        {t('areas.back')}
      </Link>
      {loading ? <LoadState query={query} /> : <EmptyState>{t('areas.notFound')}</EmptyState>}
    </Page>
  )
}
