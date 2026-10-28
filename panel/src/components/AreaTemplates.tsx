import { ChevronRight, Plus, Trash2 } from '@/components/icons'
import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { EditableText } from '@/components/EditableText'
import { NewTemplateDialog, TemplateContentDialog } from '@/components/TemplateEditor'
import { Fold } from '@/components/Fold'
import { MoreMenu } from '@/components/MoreMenu'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/EmptyState'
import { LoadState } from '@/components/LoadState'
import { useT } from '@/i18n'
import type { Area, Template } from '@team-platform/client'
import { useDeletedTemplates, useDeleteTemplate, useDeleteTemplates, useRestoreTemplate, useRestoreTemplates, useSaveTemplate, useTemplates } from '@team-platform/client/react'
import { useNotices } from '@/lib/notices'
import { useSelection, type Selection } from '@/lib/selection'
import { RowCheck, SelectionBar, SelectionFoot } from '@/components/SelectionBar'
import { parseTemplateFields, parseTemplateOutput } from '@/lib/template'
import { useUndo } from '@/lib/undo'

export const nameRule = (t: ReturnType<typeof useT>) => (v: string) => (!v ? t('common.required') : v.length > 64 ? t('form.maxLength', { n: 64 }) : null)
export const descriptionRule = (t: ReturnType<typeof useT>) => (v: string) => (!v ? t('common.required') : v.length > 1024 ? t('form.maxLength', { n: 1024 }) : null)

/** A row of the templates list: a template, or the place where one was just deleted, with Deshacer in it (J2-A-23). */
type TemplateItem = { kind: 'template'; template: Template } | { kind: 'removed'; template: Template } | { kind: 'deleted'; template: Template }

/**
 * The columns of the list, from 640 px: name, then three figures on the right (fields, outputs, progress notices) and the row's action.
 * The header of labels and every row use the same ones, so each figure sits under its label and the name starts at the same x in every row.
 */
const GRID = 'sm:grid-cols-[minmax(10rem,1fr)_5rem_5rem_6rem_6rem]'

/** Labels of the columns: 12 px capitals, 32 px tall. Hidden on a phone, where each figure carries its own word. */
function TemplateColumns() {
  const t = useT()
  return (
    <div aria-hidden data-testid="template-columns" className={`rotulo hidden min-h-8 items-center gap-x-3 border-b border-line pl-10 pr-4 sm:grid ${GRID}`}>
      <span>{t('areas.fieldName')}</span>
      <span className="pr-2 text-right">{t('templates.fields')}</span>
      <span className="pr-2 text-right">{t('templates.outputs')}</span>
      <span className="pr-2 text-right">{t('templates.columnProgress')}</span>
      <span />
    </div>
  )
}

/** The templates of one area: every one is a row of the list, and each opens in a window (UD-017). */
export function Templates({ area }: { area: Area }) {
  const t = useT()
  const undo = useUndo()
  const templates = useTemplates(area.id)
  const save = useSaveTemplate(area.id)
  const del = useDeleteTemplate(area.id)
  const restore = useRestoreTemplate()
  const [creating, setCreating] = useState(false)
  /** The template just deleted, where it was, and the size of the history after deleting it: it stays while nothing else was done. */
  const [removed, setRemoved] = useState<{ template: Template; index: number; mark: number } | null>(null)
  // «Borradas» adds the deleted templates under the live ones, muted and with Restaurar (UD-250).
  const [showDeleted, setShowDeleted] = useState(false)
  const deleted = useDeletedTemplates(area.id, showDeleted)
  const live = useMemo(() => (templates.data ?? []).filter((x) => !x.deleted_at), [templates.data])
  const showRemoved = removed && removed.template.area_id === area.id && undo.undoCount === removed.mark
  const rows = useMemo<TemplateItem[]>(() => {
    const items: TemplateItem[] = live.map((template) => ({ kind: 'template', template }))
    if (showRemoved) items.splice(Math.min(removed.index, items.length), 0, { kind: 'removed', template: removed.template })
    if (showDeleted) for (const template of deleted.data ?? []) if (!(showRemoved && removed.template.id === template.id) && !live.some((x) => x.id === template.id)) items.push({ kind: 'deleted', template })
    return items
  }, [live, removed, showRemoved, showDeleted, deleted.data])

  // Several at once (UD-253): the marked templates are deleted without asking; the history and the notice carry Deshacer.
  const selection = useSelection()
  const notices = useNotices()
  const delMany = useDeleteTemplates(area.id)
  const restoreMany = useRestoreTemplates()
  const liveIds = useMemo(() => new Set(live.map((x) => x.id)), [live])
  const marked = [...selection.marked].filter((id) => liveIds.has(id))
  const removeMarked = async () => {
    const ids = marked
    const text = t('bulk.templatesDeleted', { n: ids.length })
    await undo.run({ label: text, redo: () => delMany.mutateAsync(ids), undo: () => restoreMany.mutateAsync(ids) })
    selection.clear()
    notices.show({ text, action: { label: t('undo.undo'), run: () => undo.undo() } })
  }

  // Deleting is reversible: it is done and Deshacer restores it (POST /templates/:id/restore). The row says so where it was.
  const remove = (template: Template) => {
    const index = live.findIndex((x) => x.id === template.id)
    const mark = undo.undoCount + 1
    return undo
      .run({ label: t('areas.deleted'), redo: () => del.mutateAsync(template.id), undo: () => restore.mutateAsync(template.id) })
      .then(() => setRemoved({ template, index, mark }))
  }

  // With nothing to list, the empty state carries the one button that creates; the header does not repeat it.
  const none = !templates.isPending && !templates.isError && rows.length === 0
  const create = (
    <Button variant="primary" data-testid="template-create" onClick={() => setCreating(true)}>
      <Plus size={16} aria-hidden /> {t('areas.addTemplate')}
    </Button>
  )

  return (
    <>
      {/* The fold names the section and counts its templates; what acts on the list sits on the same line, at the right. */}
      <Fold
        title={t('areas.templates')}
        note={templates.isSuccess ? live.length : undefined}
        defaultOpen
        anchor="plantillas"
        action={
          none ? undefined : (
            <>
              <MoreMenu items={[{ key: 'deleted', label: t('restore.templates'), checked: showDeleted, onCheckedChange: setShowDeleted, testId: 'show-deleted' }]} />
              {create}
            </>
          )
        }
      >
        {/* Every template is drawn: the list is not paged, so the count in the fold is the number of rows under it. */}
        <section aria-label={t('areas.templates')} className="flex min-w-0 flex-col border-y border-line">
          {rows.length > 0 && <TemplateColumns />}
          {rows.length === 0
            ? templates.isPending || templates.isError
              ? <LoadState query={templates} />
              : <EmptyState action={create}>{t('areas.noTemplates')}</EmptyState>
            : rows.map((x) => (
                <Fragment key={`${x.kind}-${x.template.id}`}>
                  {x.kind === 'deleted' ? <DeletedTemplateRow template={x.template} /> : x.kind === 'removed' ? <RemovedRow template={x.template} onUndo={() => void undo.undo()} /> : <TemplateRow template={x.template} areaId={area.id} selection={selection} onRemove={() => void remove(x.template)} />}
                </Fragment>
              ))}
          {marked.length > 0 && (
            <SelectionFoot>
              <SelectionBar className="border-b-0" selection={selection} busy={delMany.isPending} onAll={() => selection.add([...liveIds])} onDelete={() => void removeMarked()} />
            </SelectionFoot>
          )}
        </section>
      </Fold>
      <NewTemplateDialog open={creating} onOpenChange={setCreating} onCreate={async (v) => { await save.mutateAsync(v) }} />
    </>
  )
}

/** A deleted template: its name muted and the one action that brings it back (UD-250). */
function DeletedTemplateRow({ template }: { template: Template }) {
  const t = useT()
  const restore = useRestoreTemplate()
  return (
    <article data-deleted="true" className="flex min-h-12 items-center justify-between gap-3 border-b border-line py-2 pl-10 pr-4 text-muted last:border-b-0">
      <span className="min-w-0 break-words">{template.name}</span>
      <Button size="sm" variant="secondary" disabled={restore.isPending} aria-label={t('restore.of', { title: template.name })} data-testid="template-restore" data-repeat-ok="per-template" onClick={() => restore.mutate(template.id)}>
        {t('restore.action')}
      </Button>
    </article>
  )
}

function RemovedRow({ template, onUndo }: { template: Template; onUndo: () => void }) {
  const t = useT()
  return (
    <article role="status" className="flex min-h-12 items-center justify-between gap-3 border-b border-line bg-hover py-2 pl-10 pr-4 last:border-b-0">
      <span className="min-w-0 break-words text-muted">{t('areas.deletedRow', { name: template.name })}</span>
      <Button size="sm" variant="secondary" data-repeat-ok="per-template" onClick={onUndo}>
        {t('undo.undo')}
      </Button>
    </article>
  )
}

/** A figure of the row: the number on the right, aligned under its column. On a phone the columns are not drawn, so the figure carries its word. */
function Figure({ word, children, quiet = false }: { word: string; children: ReactNode; quiet?: boolean }) {
  return (
    <span data-figure={word} className={`flex min-w-0 flex-col items-start gap-0.5 text-sm tabular-nums sm:flex-row sm:items-baseline sm:justify-end sm:gap-1.5 sm:pr-2 ${quiet ? 'text-muted' : 'font-semibold'}`}>
      <span className="text-xs font-normal text-muted sm:sr-only">{word}</span>
      <span>{children}</span>
    </span>
  )
}

/**
 * A template as a row of the list: its name, how many fields it asks for, how many outputs it declares and the minutes between progress notices.
 * The name opens the window of the template, where its description, fields, outputs and instructions are read and edited; deleting is the
 * quiet button at the right, and it is undone where it was. The description and the field tags are not in the row (the window shows them whole).
 */
function TemplateRow({ template, areaId, selection, onRemove }: { template: Template; areaId: string; selection: Selection; onRemove: () => void }) {
  const t = useT()
  const undo = useUndo()
  const save = useSaveTemplate(areaId)
  const [open, setOpen] = useState(false)
  const fields = useMemo(() => parseTemplateFields(template.body_markdown), [template.body_markdown])
  const output = useMemo(() => parseTemplateOutput(template.body_markdown), [template.body_markdown])
  const interval = template.progress_interval_min ?? 0
  const cut = template.name.lastIndexOf(' ') + 1
  const [head, tail] = [template.name.slice(0, cut), template.name.slice(cut)]

  const change = <F extends 'name' | 'description' | 'body_markdown' | 'progress_interval_min'>(field: F, next: Template[F]) => {
    const prev = template[field]
    return undo.run({ label: t('areas.edited'), redo: () => save.mutateAsync({ id: template.id, [field]: next }), undo: () => save.mutateAsync({ id: template.id, [field]: prev }) })
  }

  return (
    <article data-marked={selection.isMarked(template.id) || undefined} data-template-row className={`relative grid min-h-12 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-line py-2 pl-10 pr-4 last:border-b-0 data-[marked]:bg-selected ${GRID}`}>
      <RowCheck id={template.id} title={template.name} selection={selection} align="row" />
      {/* The name opens the window; the chevron is glued to its last word, like the name of an area. */}
      <button type="button" aria-label={t('areas.open', { title: template.name })} data-testid="template-open" data-repeat-ok="per-template" onClick={() => setOpen(true)} className="min-w-0 py-1 text-left text-sm font-semibold pointer-coarse:min-h-11 hover:text-accent-deep hover:underline max-sm:col-span-2">
        {head}
        <span className="whitespace-nowrap">
          {tail}
          <ChevronRight size={16} aria-hidden className="ml-1 inline-block shrink-0 align-[-0.2em] text-muted" />
        </span>
      </button>
      <span className="grid grid-cols-3 gap-x-2 max-sm:min-w-0 sm:contents">
        <Figure word={t('templates.fields')} quiet={fields.length === 0}>{fields.length}</Figure>
        <Figure word={t('templates.outputs')} quiet={!output?.length}>{output?.length ?? 0}</Figure>
        <Figure word={t('templates.columnProgress')} quiet={interval === 0}>
          {interval === 0 ? t('templates.progressOff') : `${interval} ${t('templates.progressUnit')}`}
        </Figure>
      </span>
      <Button size="sm" variant="ghost" className="max-sm:col-start-2 max-sm:row-start-2 justify-self-end text-muted hover:text-danger" aria-label={t('areas.delete', { name: template.name })} title={t('bulk.delete')} data-repeat-ok="per-template" onClick={onRemove}>
        <Trash2 size={16} aria-hidden /> {t('bulk.delete')}
      </Button>
      <TemplateContentDialog
        open={open}
        onOpenChange={setOpen}
        title={template.name}
        lead={
          <dl className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <dt className="rotulo">{t('areas.fieldName')}</dt>
              <dd>
                <EditableText value={template.name} label={t('areas.fieldName')} validate={nameRule(t)} onSave={(v) => change('name', v)} displayClassName="font-semibold" />
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="rotulo">{t('areas.fieldDescription')}</dt>
              <dd>
                <EditableText value={template.description} label={t('areas.fieldDescription')} multiline validate={descriptionRule(t)} onSave={(v) => change('description', v)} displayClassName="text-sm" />
              </dd>
            </div>
          </dl>
        }
        name={template.name}
        description={template.description}
        markdown={template.body_markdown}
        onSave={(next) => change('body_markdown', next)}
        progressInterval={interval}
        onProgressInterval={(next) => change('progress_interval_min', next)}
      />
    </article>
  )
}
