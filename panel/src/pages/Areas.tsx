import { ChevronRight, Plus } from '@/components/icons'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { AreaColorPicker } from '@/components/AreaColorPicker'
import { descriptionRule } from '@/components/AreaTemplates'
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
import { useAreas, useMe, useSaveArea, useSummary } from '@/lib/queries'
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

function AreaList() {
  const t = useT()
  const areas = useAreas()
  const save = useSaveArea()
  const undo = useUndoStack()
  const [creating, setCreating] = useState(false)
  const rows = useMemo(() => areas.data ?? [], [areas.data])

  return (
    <UndoProvider stack={undo}>
      <Page cols={12}>
        <PageHeader
          title={t('nav.areas')}
          aside={
            <div className="flex items-center gap-2">
              <UndoButtons stack={undo} />
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus size={14} aria-hidden /> {t('areas.add')}
              </Button>
            </div>
          }
        />
        <FitList
          rows={rows}
          rowKey={(a) => a.id}
          label={t('nav.areas')}
          renderRow={(a) => <AreaRow area={a} />}
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
function AreaRow({ area }: { area: Area }) {
  const t = useT()
  const undo = useUndo()
  const save = useSaveArea()
  const summary = useSummary().data
  const label = useCountsLabel()
  const counts = areaCounts(summary, area.id)
  const cut = area.title.lastIndexOf(' ') + 1
  const [head, tail] = [area.title.slice(0, cut), area.title.slice(cut)]

  const change = (next: string) => {
    const prev = area.description
    return undo.run({ label: t('areas.edited'), redo: () => save.mutateAsync({ id: area.id, description: next }), undo: () => save.mutateAsync({ id: area.id, description: prev }) })
  }

  const changeColor = (next: string) => {
    const prev = area.color
    return undo.run({ label: t('areas.colorEdited'), redo: () => save.mutateAsync({ id: area.id, color: next }), undo: () => save.mutateAsync({ id: area.id, color: prev }) })
  }

  return (
    <section className="grid grid-cols-[auto_minmax(0,1fr)_7.5rem] items-start gap-x-3 gap-y-1 border-b border-line px-4 py-3 last:border-b-0 sm:grid-cols-[auto_minmax(10rem,14rem)_8rem_minmax(0,1fr)]">
      <AreaColorPicker title={area.title} color={area.color} onChange={changeColor} />
      {/* The name leads to the area; the chevron is glued to its last word, so a name on several lines keeps it at full size next to it. */}
      <Link to={`/areas/${area.id}`} aria-label={t('areas.open', { title: area.title })} className="self-start font-semibold hover:text-accent-deep hover:underline">
        {head}
        <span className="whitespace-nowrap">
          {tail}
          <ChevronRight size={15} aria-hidden className="ml-1 inline-block shrink-0 align-[-0.2em] text-muted" />
        </span>
      </Link>
      {/* Fixed-width column right after the name: the counts line up row by row, and an area with none says nothing (J3-A-33). Each count leads to Mensajes filtered by the area and that state. */}
      <span className="col-start-3 row-span-2 row-start-1 flex flex-col items-start self-center sm:row-span-1">
        {(['open', 'answered'] as const).map(
          (status) =>
            counts[status] > 0 && (
              <Link key={status} to={areaMessagesPath(area.id, status)} aria-label={t('areas.countOf', { title: area.title, count: label({ [status]: counts[status] }) })} className="rounded-full hover:bg-hover">
                <StateMark status={status} n={counts[status]} plain />
              </Link>
            ),
        )}
      </span>
      <div className="col-start-2 min-w-0 sm:col-start-4 sm:row-start-1">
        <FoldedText value={area.description} label={t('areas.fieldDescription')} validate={descriptionRule(t)} onSave={change} displayClassName="text-xs text-muted" />
      </div>
    </section>
  )
}
