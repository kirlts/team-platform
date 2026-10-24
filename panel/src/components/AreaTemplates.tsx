import { Plus, Trash2 } from '@/components/icons'
import { useMemo, useRef, useState } from 'react'
import { EditableText } from '@/components/EditableText'
import { FitList } from '@/components/FitList'
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
import { RowCheck, SelectionBar } from '@/components/SelectionBar'
import { parseTemplateFields, parseTemplateOutput } from '@/lib/template'
import { useUndo } from '@/lib/undo'

export const nameRule = (t: ReturnType<typeof useT>) => (v: string) => (!v ? t('common.required') : v.length > 64 ? t('form.maxLength', { n: 64 }) : null)
export const descriptionRule = (t: ReturnType<typeof useT>) => (v: string) => (!v ? t('common.required') : v.length > 1024 ? t('form.maxLength', { n: 1024 }) : null)

/** A row of the templates list: a template, or the place where one was just deleted, with Deshacer in it (J2-A-23). */
type TemplateItem = { kind: 'template'; template: Template } | { kind: 'removed'; template: Template } | { kind: 'deleted'; template: Template }

/** The templates of one area, edited in place (UD-017). */
export function Templates({ area }: { area: Area }) {
  const t = useT()
  const undo = useUndo()
  const templates = useTemplates(area.id)
  const save = useSaveTemplate(area.id)
  const del = useDeleteTemplate(area.id)
  const restore = useRestoreTemplate()
  const [creating, setCreating] = useState(false)
  /** The template just created: the list pages to it, since in a small frame it lands on a later page. */
  const [created, setCreated] = useState<string | undefined>()
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
    if (showDeleted) for (const template of deleted.data ?? []) if (!(showRemoved && removed.template.id === template.id)) items.push({ kind: 'deleted', template })
    return items
  }, [live, removed, showRemoved, showDeleted, deleted.data])

  // Several at once (UD-253): the marked templates are deleted without asking; the history and the notice carry Deshacer.
  const selection = useSelection()
  const notices = useNotices()
  const delMany = useDeleteTemplates(area.id)
  const restoreMany = useRestoreTemplates()
  const page = useRef<readonly string[]>([])
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
        <section aria-label={t('areas.templates')} className="flex h-[min(22rem,30dvh)] min-h-0 min-w-0 flex-col max-md:h-auto">
          <FitList
            bare
            rows={rows}
            rowKey={(x) => `${x.kind}-${x.template.id}`}
            reveal={created}
            renderRow={(x) => (x.kind === 'deleted' ? <DeletedTemplateRow template={x.template} /> : x.kind === 'removed' ? <RemovedRow template={x.template} onUndo={() => void undo.undo()} /> : <TemplateRow template={x.template} areaId={area.id} selection={selection} onRemove={() => void remove(x.template)} />)}
            onShown={(keys) => (page.current = keys.filter((k) => k.startsWith('template-')).map((k) => k.slice(9)))}
            header={marked.length > 0 ? <SelectionBar selection={selection} busy={delMany.isPending} onAll={() => selection.add(page.current)} onDelete={() => void removeMarked()} /> : undefined}
            empty={templates.isPending || templates.isError ? <LoadState query={templates} /> : <EmptyState action={create}>{t('areas.noTemplates')}</EmptyState>}
          />
        </section>
      </Fold>
      <NewTemplateDialog open={creating} onOpenChange={setCreating} onCreate={async (v) => {
          const made = (await save.mutateAsync(v)) as Template | undefined
          if (made?.id) setCreated(`template-${made.id}`)
        }} />
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

/** A tag of the fields a template asks for or delivers: information, so it is not a pill (a pill is what is touched). */
function FieldTag({ label, required, fixed = false }: { label: string; required?: boolean; fixed?: boolean }) {
  const t = useT()
  return (
    <li className={`inline-flex min-h-6 items-center gap-1.5 rounded-md bg-hover px-2.5 text-xs ${fixed ? 'text-muted' : ''}`}>
      {label}
      {required && <span className="text-muted">{t('templates.required')}</span>}
    </li>
  )
}

/**
 * A template as the person will meet it: its name and description edited in place, and the fields it asks for and delivers. The window
 * with the fields and the instructions opens with «Campos e instrucciones»; deleting is a quiet button that names itself, and it is undone where it was.
 */
function TemplateRow({ template, areaId, selection, onRemove }: { template: Template; areaId: string; selection: Selection; onRemove: () => void }) {
  const t = useT()
  const undo = useUndo()
  const save = useSaveTemplate(areaId)
  const [showContent, setShowContent] = useState(false)
  const fields = useMemo(() => parseTemplateFields(template.body_markdown), [template.body_markdown])
  const output = useMemo(() => parseTemplateOutput(template.body_markdown), [template.body_markdown])

  const change = (field: 'name' | 'description' | 'body_markdown', next: string) => {
    const prev = template[field]
    return undo.run({ label: t('areas.edited'), redo: () => save.mutateAsync({ id: template.id, [field]: next }), undo: () => save.mutateAsync({ id: template.id, [field]: prev }) })
  }

  return (
    <article data-marked={selection.isMarked(template.id) || undefined} className="relative flex flex-col gap-3 border-b border-line py-4 pl-10 pr-5 last:border-b-0 data-[marked]:bg-selected">
      <RowCheck id={template.id} title={template.name} selection={selection} />
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
          <EditableText value={template.name} label={t('areas.fieldName')} validate={nameRule(t)} onSave={(v) => change('name', v)} displayClassName="font-semibold" />
          <EditableText value={template.description} label={t('areas.fieldDescription')} multiline validate={descriptionRule(t)} onSave={(v) => change('description', v)} displayClassName="text-sm text-muted" />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" data-repeat-ok="per-template" onClick={() => setShowContent(true)}>
            {t('areas.content')}
          </Button>
          <Button size="sm" variant="ghost" className="text-muted hover:text-danger" aria-label={t('areas.delete', { name: template.name })} title={t('areas.deleteShort')} data-repeat-ok="per-template" onClick={onRemove}>
            <Trash2 size={16} aria-hidden /> {t('areas.deleteShort')}
          </Button>
        </div>
      </div>
      <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2">
        <dt className="rotulo">{t('templates.fields')}</dt>
        <dd>
          {fields.length === 0 ? (
            <span className="text-sm text-muted">{t('templates.noFields')}</span>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {fields.map((f) => (
                <FieldTag key={f.name} label={f.label} required={f.required} />
              ))}
            </ul>
          )}
        </dd>
        <dt className="rotulo">{t('templates.output')}</dt>
        <dd data-template-output>
          {output === null ? (
            <span className="text-sm text-muted">{t('templates.noOutput')}</span>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {output.map((f) => (
                <FieldTag key={f.name} label={f.label} required={f.required} />
              ))}
              {(['outcome', 'summary'] as const).map((fixed) => (
                <FieldTag key={fixed} label={t(`templates.output.${fixed}`)} fixed />
              ))}
            </ul>
          )}
        </dd>
      </dl>
      <TemplateContentDialog
        open={showContent}
        onOpenChange={setShowContent}
        title={template.name}
        name={template.name}
        description={template.description}
        markdown={template.body_markdown}
        onSave={(next) => change('body_markdown', next)}
      />
    </article>
  )
}
