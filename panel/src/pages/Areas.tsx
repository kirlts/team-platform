import { ChevronRight, Plus, Trash2 } from '@/components/icons'
import { useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { AreaColorPicker } from '@/components/AreaColorPicker'
import { descriptionRule } from '@/components/AreaTemplates'
import { MoreMenu } from '@/components/MoreMenu'
import { FitList } from '@/components/FitList'
import { FoldedText } from '@/components/FoldedText'
import { StateIcon, useCountsLabel } from '@/components/NotifyBadge'
import { FormDialog } from '@/components/FormDialog'
import { Page } from '@/components/Page'
import { PageHeader } from '@/components/PageHeader'
import { UndoButtons } from '@/components/UndoButtons'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/EmptyState'
import { LoadState } from '@/components/LoadState'
import { useT, type MessageKey } from '@/i18n'
import { AreaNotFound, AreaView } from '@/pages/AreaView'
import { areaCounts, areaMessagesPath } from '@/lib/pending'
import { useNotices } from '@/lib/notices'
import type { Area } from '@team-platform/client'
import { useAreas, useDeleteAreas, useDeletedAreas, useDeleteArea, useMe, useRestoreArea, useRestoreAreas, useSaveArea, useSummary, useTemplates } from '@team-platform/client/react'
import { useSelection, type Selection } from '@/lib/selection'
import { RowCheck, SelectionBar, SelectionFoot } from '@/components/SelectionBar'
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
        <PageHeader reserve title={t('nav.areas')} />
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

/**
 * The columns of the list, from 640 px: color, name, the two counts and the templates (numbers on the right), description, and the row's action.
 * The header of labels and every row use the same ones, so each figure sits under its label. On a phone each row stacks.
 */
const GRID = 'sm:grid-cols-[1.5rem_minmax(8rem,12rem)_5rem_6.5rem_5.5rem_minmax(0,1fr)_6rem]'

const COUNT_WORD: Record<'open' | 'answered', MessageKey> = { open: 'state.open', answered: 'state.answered' }

/** Labels of the columns: 12 px capitals, 32 px tall. Hidden on a phone, where each figure carries its own word. */
function AreaColumns() {
  const t = useT()
  return (
    <div aria-hidden data-testid="area-columns" className={`rotulo hidden min-h-8 items-center gap-x-3 border-b border-line pl-10 pr-4 sm:grid ${GRID}`}>
      <span className="col-span-2">{t('areas.columnArea')}</span>
      <span className="pr-2 text-right">{t('areas.columnOpen')}</span>
      <span className="pr-2 text-right">{t('areas.columnAnswered')}</span>
      <span className="pr-2 text-right">{t('areas.columnTemplates')}</span>
      <span>{t('areas.fieldDescription')}</span>
      <span />
    </div>
  )
}

/** A deleted area: muted, with no counts and no edits, and the one action that brings it back (UD-250). */
function DeletedAreaRow({ area }: { area: Area }) {
  const t = useT()
  const restore = useRestoreArea()
  return (
    <section data-deleted="true" className="flex min-h-12 items-center gap-3 border-b border-line py-2 pl-10 pr-4 text-muted last:border-b-0">
      <span aria-hidden className="size-4 shrink-0 rounded-full opacity-50" style={{ backgroundColor: area.color }} />
      <span className="min-w-0 flex-1 break-words font-semibold">{area.title}</span>
      <Button size="sm" variant="secondary" disabled={restore.isPending} aria-label={t('restore.of', { title: area.title })} data-testid="area-restore" data-repeat-ok="per-area" onClick={() => restore.mutate(area.id)}>
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
  // The two lists are refetched separately after a restore, and the live one can land first: an area in the live list is not also shown as deleted.
  const rows = useMemo<AreaItem[]>(() => {
    const liveIds = new Set((areas.data ?? []).map((area) => area.id))
    return [...(areas.data ?? []).map((area): AreaItem => ({ kind: 'live', area })), ...(showDeleted ? (deleted.data ?? []).filter((area) => !liveIds.has(area.id)).map((area): AreaItem => ({ kind: 'deleted', area })) : [])]
  }, [areas.data, deleted.data, showDeleted])
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
  // With nothing to list, the empty state carries the one button that creates; the header does not repeat it.
  const none = !areas.isPending && !areas.isError && rows.length === 0
  const create = (
    <Button variant="primary" size="lg" data-testid="area-create" onClick={() => setCreating(true)}>
      <Plus size={16} aria-hidden /> {t('areas.add')}
    </Button>
  )

  return (
    <UndoProvider stack={undo}>
      <Page cols={12}>
        <PageHeader
          reserve
          title={t('nav.areas')}
          aside={
            <div className="flex flex-wrap items-center gap-2">
              <UndoButtons stack={undo} compact />
              <MoreMenu items={[{ key: 'deleted', label: t('restore.areas'), checked: showDeleted, onCheckedChange: setShowDeleted, testId: 'show-deleted' }]} />
              {!none && create}
            </div>
          }
        />
        <FitList
          rows={rows}
          rowKey={(x) => `${x.kind}-${x.area.id}`}
          label={t('nav.areas')}
          renderRow={(x) => (x.kind === 'live' ? <AreaRow area={x.area} selection={selection} /> : <DeletedAreaRow area={x.area} />)}
          onShown={(keys) => (page.current = keys.filter((k) => k.startsWith('live-')).map((k) => k.slice(5)))}
          header={<AreaColumns />}
          footer={
            marked.length > 0 ? (
              <SelectionFoot>
                <SelectionBar className="border-b-0" selection={selection} busy={delMany.isPending} onAll={() => selection.add(page.current)} onDelete={() => void removeMarked()} />
              </SelectionFoot>
            ) : undefined
          }
          empty={areas.isPending || areas.isError ? <LoadState query={areas} /> : <EmptyState action={create}>{t('areas.none')}</EmptyState>}
        />
        <FormDialog
          open={creating}
          onOpenChange={setCreating}
          title={t('areas.new')}
          submitLabel={t('areas.add')}
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

/** A figure of the table: its shape and the number, on the right. Its word is read by the screen reader and, on a phone, where the labels are not drawn, it is seen. */
function Figure({ status, n }: { status: 'open' | 'answered'; n: number }) {
  const t = useT()
  const word = t(COUNT_WORD[status], { n }).replace(/^\S+\s*/, '')
  return (
    <span data-status={status} data-weight="quiet" data-plain data-zero={n === 0 || undefined} data-testid="state-mark" className="inline-flex min-h-6 items-center justify-end gap-1.5 whitespace-nowrap rounded-full px-2 text-sm font-semibold">
      <StateIcon status={status} size={16} />
      <span className="tabular-nums">{n}</span>
      <span className="sm:sr-only"> {word}</span>
    </span>
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
    <section data-marked={selection.isMarked(area.id) || undefined} className={`relative grid min-h-12 shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-line py-2 pl-10 pr-4 last:border-b-0 data-[marked]:bg-selected ${GRID}`}>
      <RowCheck id={area.id} title={area.title} selection={selection} align="row" />
      <AreaColorPicker title={area.title} color={area.color} onChange={changeColor} />
      {/* The name leads to the area; the chevron is glued to its last word, so a name on several lines keeps it at full size next to it. */}
      <Link to={`/areas/${area.id}`} aria-label={t('areas.open', { title: area.title })} className="py-1 text-sm font-semibold hover:text-accent-deep hover:underline pointer-coarse:py-[11px]">
        {head}
        <span className="whitespace-nowrap">
          {tail}
          <ChevronRight size={16} aria-hidden className="ml-1 inline-block shrink-0 align-[-0.2em] text-muted" />
        </span>
      </Link>
      {/* The counts of every area are drawn, zero included (UD-211): the column is never blank. A count above zero leads to Mensajes filtered by the area and that state. */}
      <span className="col-start-2 col-span-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 sm:contents">
        {(['open', 'answered'] as const).map((status) =>
          counts[status] > 0 ? (
            <Link key={status} to={areaMessagesPath(area.id, status)} aria-label={t('areas.countOf', { title: area.title, count: label({ [status]: counts[status] }) })} title={t('areas.countOf', { title: area.title, count: label({ [status]: counts[status] }) })} className="justify-self-end rounded-full hover:bg-hover pointer-coarse:flex pointer-coarse:min-h-11 pointer-coarse:items-center">
              <Figure status={status} n={counts[status]} />
            </Link>
          ) : (
            <span key={status} className="justify-self-end text-muted">
              <Figure status={status} n={0} />
            </span>
          ),
        )}
        <Link to={`/areas/${area.id}#plantillas`} aria-label={t('areas.templatesOf', { title: area.title })} className="inline-flex min-h-6 items-center gap-1 justify-self-end rounded-full px-2 text-sm font-semibold text-accent-deep hover:underline pointer-coarse:min-h-11">
          <span className="tabular-nums">{templateCount}</span>
          <span className="sm:sr-only"> {t('areas.templateCount', { n: templateCount }).replace(/^\S+\s*/, '')}</span>
        </Link>
      </span>
      <div className="col-start-2 col-span-2 min-w-0 sm:col-auto">
        <FoldedText value={area.description} label={t('areas.fieldDescription')} validate={descriptionRule(t)} onSave={change} displayClassName="text-sm text-muted pointer-coarse:min-h-11" />
      </div>
      <Button size="sm" variant="ghost" className="max-sm:col-start-3 max-sm:row-start-1 justify-self-end text-muted hover:text-danger" disabled={del.isPending} title={t('areas.deleteArea')} aria-label={t('areas.deleteAreaOf', { title: area.title })} data-testid="area-delete" data-repeat-ok="per-area" onClick={() => void remove()}>
        <Trash2 size={16} aria-hidden /> {t('bulk.delete')}
      </Button>
    </section>
  )
}
