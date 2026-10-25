import { ChevronLeft, Trash2 } from '@/components/icons'
import { useEffect, useMemo } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { Templates, descriptionRule, nameRule } from '@/components/AreaTemplates'
import { AreaColorPicker } from '@/components/AreaColorPicker'
import { EditableText } from '@/components/EditableText'
import { EmptyState } from '@/components/EmptyState'
import { Fold } from '@/components/Fold'
import { FoldedText } from '@/components/FoldedText'
import { LoadState } from '@/components/LoadState'
import { NativeSelect, ON_PAGE_FIELD } from '@/components/NativeSelect'
import { MessageList } from '@/components/MessageList'
import { Page } from '@/components/Page'
import { StateTabs } from '@/components/StateTabs'
import { UndoButtons } from '@/components/UndoButtons'
import { MoreMenu } from '@/components/MoreMenu'
import { useT } from '@/i18n'
import { EXECUTE_MODELS, parseQuery, serializeQuery, upsertFilter, removeFilter, type MessageQuery, type Area, type MessageStatus } from '@team-platform/client'
import { useDeleteArea, useMe, useMembers, useMessages, useRestoreArea, useSaveArea, useSummary, useTemplates } from '@team-platform/client/react'
import { areaCounts } from '@/lib/pending'
import { useNotices } from '@/lib/notices'
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
  // «N plantillas» of the list of areas links to #plantillas: the section is open and the page brings it into view.
  const { hash } = useLocation()
  useEffect(() => {
    if (hash === '#plantillas') document.getElementById('plantillas')?.scrollIntoView({ block: 'start' })
  }, [hash, templates.isSuccess])

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

  const changeDecider = (next: string) => {
    const prev = area.escalation_member_id ?? null
    return undoStack.run({ label: t('areas.deciderEdited'), redo: () => save.mutateAsync({ id: area.id, escalation_member_id: next }), undo: () => save.mutateAsync({ id: area.id, escalation_member_id: prev }) })
  }

  const changeModel = (field: 'execute_model' | 'execute_model_direct', next: string) => {
    const prev = area[field] ?? null
    const value = next === '' ? null : next
    return undoStack.run({ label: t('areas.modelEdited'), redo: () => save.mutateAsync({ id: area.id, [field]: value }), undo: () => save.mutateAsync({ id: area.id, [field]: prev }) })
  }

  return (
    <Page cols={12}>
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3">
          <Link to="/areas" className="inline-flex min-h-6 items-center gap-1 text-sm font-semibold text-accent-deep hover:underline">
            <ChevronLeft size={16} aria-hidden />
            {t('areas.back')}
          </Link>
          {/* The same dot the list of areas and the sidebar carry: the title says which area this is by its color too (UD-045), and it is the control to change it. */}
          <AreaColorPicker title={area.title} color={area.color} onChange={changeColor} />
          <h1 className="min-w-0 break-words">
            <EditableText value={area.title} label={t('areas.fieldTitle')} validate={nameRule(t)} onSave={(v) => change('title', v)} />
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <UndoButtons stack={undoStack} />
          {me?.role === 'editor' && <MoreMenu items={[{ key: 'delete', label: t('areas.deleteArea'), icon: <Trash2 size={16} aria-hidden />, danger: true, testId: 'area-delete', onSelect: () => void remove() }]} />}
        </div>
      </header>
      <AreaOwner area={area} canEdit={me?.role === 'editor'} onChange={changeDecider} />
      <AreaModels area={area} canEdit={me?.role === 'editor'} onChange={changeModel} />
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
            <Templates area={area} />
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
      <Link to="/areas" className="inline-flex min-h-6 items-center gap-1 text-sm font-semibold text-accent-deep hover:underline">
        <ChevronLeft size={16} aria-hidden />
        {t('areas.back')}
      </Link>
      {loading ? <LoadState query={query} /> : <EmptyState>{t('areas.notFound')}</EmptyState>}
    </Page>
  )
}

/**
 * Who decides in the area (UD-269) and the week's count of what sessions handed over to people: the select is the field, it saves on change
 * (Editor only); the figure is the total and the count by person, 0 when nothing was handed over.
 */
function AreaOwner({ area, canEdit, onChange }: { area: Area; canEdit: boolean; onChange: (id: string) => void | Promise<unknown> }) {
  const t = useT()
  const all = useMembers().data ?? []
  const members = all.filter((m) => m.kind !== 'agent' && m.active !== false)
  const names = useMemo(() => new Map(all.map((m) => [m.id, m.name])), [all])
  const nameOf = (id: string) => names.get(id) ?? ''
  const owner = area.escalation_member_id ?? ''
  const handoffs = area.handoffs ?? []
  const total = handoffs.reduce((n, h) => n + h.count, 0)
  return (
    <div className="flex flex-wrap items-end gap-x-12 gap-y-4 text-sm" data-testid="area-owner">
      <label className="flex w-full min-w-0 flex-col items-start gap-2 sm:w-auto">
        <span className="rotulo">{t('areas.decider')}</span>
        {canEdit ? (
          <span className="w-full sm:w-56">
            <NativeSelect className={ON_PAGE_FIELD} value={owner} onChange={(e) => void onChange(e.target.value)} aria-label={t('areas.decider')} data-testid="area-owner-select">
              {owner === '' && <option value="" />}
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </NativeSelect>
          </span>
        ) : (
          <span className="font-semibold">{nameOf(owner)}</span>
        )}
      </label>
      <dl className="flex min-w-0 flex-col gap-2" data-testid="area-handoffs">
        <dt className="rotulo">{t('areas.handoffs')}</dt>
        <dd className="flex min-w-0 flex-wrap items-baseline gap-x-5 gap-y-1">
          <span className="text-lg font-semibold tabular-nums">{total}</span>
          {handoffs.map((h) => (
            <span key={h.member_id} className="flex items-baseline gap-1.5">
              <span className="text-muted">{nameOf(h.member_id)}</span>
              <span className="font-semibold tabular-nums">{h.count}</span>
            </span>
          ))}
        </dd>
      </dl>
    </div>
  )
}

/**
 * The Claude model the area's unattended sessions run with and the one for its direct fixes (UD-292). Two selects, each the field: they save on change (Editor only).
 * «Igual» in the second one is the area's own model, which is what direct fixes ran with before the level existed.
 */
function AreaModels({ area, canEdit, onChange }: { area: Area; canEdit: boolean; onChange: (field: 'execute_model' | 'execute_model_direct', id: string) => void | Promise<unknown> }) {
  const t = useT()
  const labelOf = (id: string | null | undefined) => EXECUTE_MODELS.find((m) => m.id === id)?.label ?? id ?? ''
  const fields = [
    { field: 'execute_model' as const, label: t('areas.model'), value: area.execute_model ?? '', same: false },
    { field: 'execute_model_direct' as const, label: t('areas.modelDirect'), value: area.execute_model_direct ?? '', same: true },
  ]
  return (
    <div className="flex flex-wrap items-end gap-x-12 gap-y-4 text-sm" data-testid="area-models">
      {fields.map(({ field, label, value, same }) => (
        <label key={field} className="flex w-full min-w-0 flex-col items-start gap-2 sm:w-auto">
          <span className="rotulo">{label}</span>
          {canEdit ? (
            <span className="w-full sm:w-56">
              <NativeSelect className={ON_PAGE_FIELD} value={value} onChange={(e) => void onChange(field, e.target.value)} aria-label={label} data-testid={`area-${field.replace(/_/g, '-')}-select`}>
                {same && <option value="">{t('areas.modelSame')}</option>}
                {EXECUTE_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                {value !== '' && !EXECUTE_MODELS.some((m) => m.id === value) && <option value={value}>{value}</option>}
              </NativeSelect>
            </span>
          ) : (
            <span className="font-semibold">{value === '' ? t('areas.modelSame') : labelOf(value)}</span>
          )}
        </label>
      ))}
    </div>
  )
}
