import { ChevronRight, Plus, Trash2 } from '@/components/icons'
import { useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { AreaColorPicker } from '@/components/AreaColorPicker'
import { descriptionRule } from '@/components/AreaTemplates'
import { ShowDeleted } from '@/components/ShowDeleted'
import { FitList } from '@/components/FitList'
import { FoldedText } from '@/components/FoldedText'
import { StateMark, useCountsLabel } from '@/components/NotifyBadge'
import { FormDialog } from '@/components/FormDialog'
import { Page } from '@/components/Page'
import { PageHeader } from '@/components/PageHeader'
import { UndoButtons } from '@/components/UndoButtons'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/EmptyState'
import { LoadState } from '@/components/LoadState'
import { useT } from '@/i18n'
import { AreaNotFound, AreaView } from '@/pages/AreaView'
import { areaCounts, areaMessagesPath } from '@/lib/pending'
import { useNotices } from '@/lib/notices'
import { useAreas, useDeleteAreas, useDeletedAreas, useDeleteArea, useMe, useRestoreArea, useRestoreAreas, useSaveArea, useSummary, useTemplates } from '@/lib/queries'
import { useSelection, type Selection } from '@/lib/selection'
import { RowCheck, SelectionBar } from '@/components/SelectionBar'
import type { Area } from '@/lib/types'
import { UndoProvider, useUndo, useUndoStack } from '@/lib/undo'

/**
 * Areas (Editor only). Without an area: the list of all of them, to create one and to open any (UD-041). With one
 * (`/areas/:areaId`): the view of that area, its messages first.
 */
export function Areas() {
  const t = useT()
  const me = useMe().data
  const areas = useAreas()
  const { areaId } = useParams()

  if (me && me.role !== 'editor') {
    return (
      <Page cols={12}>
        <PageHeader title={t('nav.areas')} />
        <p role="status" className="text-sm text-muted">
          {t('areas.editorOnly')}
        </p>
      </Page>
    )
  }
  if (areaId) {
    const area = (areas.data ?? []).find((a) => a.id === areaId)
    return area ? <AreaView key={area.id} area={area} /> : <AreaNotFound loading={areas.isPending || areas.isError} query={areas} />
  }
  return <AreaList />
}

type AreaItem = { kind: 'live' | 'deleted'; area: Area }

/** A deleted area: muted, with no counts and no edits, and the one action that brings it back (UD-250). */
function DeletedAreaRow({ area }: { area: Area }) {
  const t = useT()
  const restore = useRestoreArea()
  return (
    <section data-deleted="true" className="flex items-center gap-3 border-b border-line py-3 pl-12 pr-4 text-muted last:border-b-0">
      <span aria-hidden className="size-3 shrink-0 rounded-full opacity-50" style={{ backgroundColor: area.color }} />
      <span className="min-w-0 flex-1 break-words font-semibold">{area.title}</span>
      <Button size="sm" variant="secondary" disabled={restore.isPending} aria-label={t('restore.of', { title: area.title })} data-testid="area-restore" onClick={() => restore.mutate(area.id)}>
        {t('restore.action')}
      </Button>
    </section>
  )
}

function AreaList() {
  const t = useT()
  const areas = useAreas()
  const save = useSaveArea()
  const undo = useUndoStack()
  const [creating, setCreating] = useState(false)
  // «Borradas» adds the deleted areas under the live ones, muted and with Restaurar (UD-250); restoring moves the row up.
  const [showDeleted, setShowDeleted] = useState(false)
  const deleted = useDeletedAreas(showDeleted)
  const rows = useMemo<AreaItem[]>(() => [...(areas.data ?? []).map((area): AreaItem => ({ kind: 'live', area })), ...(showDeleted ? (deleted.data ?? []).map((area): AreaItem => ({ kind: 'deleted', area })) : [])], [areas.data, deleted.data, showDeleted])
  // Several at once (UD-253): the marked areas are deleted without asking; the history and the notice carry Deshacer.
  const selection = useSelection()
  const notices = useNotices()
  const delMany = useDeleteAreas()
  const restoreMany = useRestoreAreas()
  const page = useRef<readonly string[]>([])
  const liveIds = useMemo(() => new Set((areas.data ?? []).map((a) => a.id)), [areas.data])
  const marked = [...selection.marked].filter((id) => liveIds.has(id))
  const removeMarked = async () => {
    const ids = marked
    const text = t('bulk.areasDeleted', { n: ids.length })
    await undo.run({ label: text, redo: () => delMany.mutateAsync(ids), undo: () => restoreMany.mutateAsync(ids) })
    selection.clear()
    notices.show({ text, action: { label: t('undo.undo'), run: () => undo.undo() } })
  }

  return (
    <UndoProvider stack={undo}>
      <Page cols={12}>
        <PageHeader
          title={t('nav.areas')}
          aside={
            <div className="flex items-center gap-2">
              <UndoButtons stack={undo} />
              <ShowDeleted label={t('restore.areas')} on={showDeleted} onChange={setShowDeleted} />
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus size={14} aria-hidden /> {t('areas.add')}
              </Button>
            </div>
          }
        />
        <FitList
          rows={rows}
          rowKey={(x) => `${x.kind}-${x.area.id}`}
          label={t('nav.areas')}
          renderRow={(x) => (x.kind === 'live' ? <AreaRow area={x.area} selection={selection} /> : <DeletedAreaRow area={x.area} />)}
          onShown={(keys) => (page.current = keys.filter((k) => k.startsWith('live-')).map((k) => k.slice(5)))}
          header={marked.length > 0 ? <SelectionBar selection={selection} busy={delMany.isPending} onAll={() => selection.add(page.current)} onDelete={() => void removeMarked()} /> : undefined}
          empty={areas.isPending || areas.isError ? <LoadState query={areas} /> : <EmptyState>{t('areas.none')}</EmptyState>}
        />
        <FormDialog
          open={creating}
          onOpenChange={setCreating}
          title={t('areas.new')}
          submitLabel={t('common.create')}
          fields={[
            { name: 'title', label: t('areas.fieldTitle'), required: true, maxLength: 64 },
            { name: 'description', label: t('areas.fieldDescription'), multiline: true, required: true, maxLength: 1024 },
          ]}
          onSubmit={(v) => save.mutateAsync({ title: v.title, description: v.description })}
        />
      </Page>
    </UndoProvider>
  )
}

/** An area in the list: its name opens the area; the description is edited here; the counts lead to its open and answered messages. */
function AreaRow({ area, selection }: { area: Area; selection: Selection }) {
  const t = useT()
  const undo = useUndo()
  const save = useSaveArea()
  const del = useDeleteArea()
  const restore = useRestoreArea()
  const notices = useNotices()
  const summary = useSummary().data
  const label = useCountsLabel()
  const counts = areaCounts(summary, area.id)
  const templateCount = (useTemplates(area.id).data ?? []).filter((x) => !x.deleted_at).length
  const empty = !!summary && counts.open === 0 && counts.answered === 0
  const cut = area.title.lastIndexOf(' ') + 1
  const [head, tail] = [area.title.slice(0, cut), area.title.slice(cut)]

  const change = (next: string) => {
    const prev = area.description
    return undo.run({ label: t('areas.edited'), redo: () => save.mutateAsync({ id: area.id, description: next }), undo: () => save.mutateAsync({ id: area.id, description: prev }) })
  }

  // Deleting is reversible (UD-240): it is done, the screen's history and the strip both carry Deshacer.
  const remove = async () => {
    await undo.run({ label: t('areas.areaDeleted'), redo: () => del.mutateAsync(area.id), undo: () => restore.mutateAsync(area.id) })
    notices.show({ text: t('areas.areaDeleted'), action: { label: t('undo.undo'), run: () => undo.undo() } })
  }

  const changeColor = (next: string) => {
    const prev = area.color
    return undo.run({ label: t('areas.colorEdited'), redo: () => save.mutateAsync({ id: area.id, color: next }), undo: () => save.mutateAsync({ id: area.id, color: prev }) })
  }

  return (
    <section data-marked={selection.isMarked(area.id) || undefined} className="relative grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1 border-b border-line py-3 pl-12 pr-12 last:border-b-0 data-[marked]:bg-selected sm:grid-cols-[auto_minmax(10rem,14rem)_8rem_minmax(0,1fr)]">
      <RowCheck id={area.id} title={area.title} selection={selection} />
      <AreaColorPicker title={area.title} color={area.color} onChange={changeColor} />
      {/* The name leads to the area; the chevron is glued to its last word, so a name on several lines keeps it at full size next to it. */}
      <Link to={`/areas/${area.id}`} aria-label={t('areas.open', { title: area.title })} className="self-start font-semibold hover:text-accent-deep hover:underline">
        {head}
        <span className="whitespace-nowrap">
          {tail}
          <ChevronRight size={15} aria-hidden className="ml-1 inline-block shrink-0 align-[-0.2em] text-muted" />
        </span>
      </Link>
      {/* Fixed-width column right after the name: the counts line up row by row, and an area with none shows both at zero (UD-211, which amends J3-A-33). Each count leads to Mensajes filtered by the area and that state. */}
      <span className="col-start-2 row-start-3 mt-1 flex empty:hidden flex-row flex-wrap items-start gap-x-4 gap-y-0.5 sm:col-start-3 sm:row-start-1 sm:mt-0 sm:flex-col sm:flex-nowrap sm:gap-x-0 sm:self-center">
        {/* An area with neither open nor answered messages says so with the same two counts at zero, in muted ink, so the column is never blank (UD-211). */}
        {empty &&
          (['open', 'answered'] as const).map((status) => (
            <span key={status} data-testid="zero-count">
              <StateMark status={status} n={0} plain />
            </span>
          ))}
        {(['open', 'answered'] as const).map(
          (status) =>
            counts[status] > 0 && (
              <Link key={status} to={areaMessagesPath(area.id, status)} aria-label={t('areas.countOf', { title: area.title, count: label({ [status]: counts[status] }) })} title={t('areas.countOf', { title: area.title, count: label({ [status]: counts[status] }) })} className="rounded-full hover:bg-hover">
                <StateMark status={status} n={counts[status]} plain />
              </Link>
            ),
        )}
      </span>
      <div className="col-start-2 row-start-2 min-w-0 sm:col-start-4 sm:row-start-1">
        <FoldedText value={area.description} label={t('areas.fieldDescription')} validate={descriptionRule(t)} onSave={change} displayClassName="text-xs text-muted" />
      </div>
      <Link to={`/areas/${area.id}#plantillas`} aria-label={t('areas.templatesOf', { title: area.title })} className="col-start-2 row-start-4 text-xs font-semibold text-accent-deep hover:underline sm:col-start-4 sm:row-start-2">
        {t('areas.templateCount', { n: templateCount })}
      </Link>
      <Button size="icon-sm" variant="ghost" className="absolute right-3 top-2.5 text-muted hover:text-danger" disabled={del.isPending} title={t('areas.deleteArea')} aria-label={t('areas.deleteAreaOf', { title: area.title })} data-testid="area-delete" onClick={() => void remove()}>
        <Trash2 size={14} aria-hidden />
      </Button>
    </section>
  )
}
