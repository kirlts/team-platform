import { ChevronRight, Plus, Trash2 } from '@/components/icons'
import { useMemo, useState } from 'react'
import { EditableText } from '@/components/EditableText'
import { FitList } from '@/components/FitList'
import { NewTemplateDialog, TemplateContentDialog } from '@/components/TemplateEditor'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/EmptyState'
import { LoadState } from '@/components/LoadState'
import { useT } from '@/i18n'
import { useDeleteTemplate, useRestoreTemplate, useSaveTemplate, useTemplates } from '@/lib/queries'
import { Markdown } from '@/lib/markdown'
import { parseTemplateFields, templateInstructions } from '@/lib/template'
import type { Area, Template } from '@/lib/types'
import { useUndo } from '@/lib/undo'

export const nameRule = (t: ReturnType<typeof useT>) => (v: string) => (!v ? t('common.required') : v.length > 64 ? t('form.maxLength', { n: 64 }) : null)
export const descriptionRule = (t: ReturnType<typeof useT>) => (v: string) => (!v ? t('common.required') : v.length > 1024 ? t('form.maxLength', { n: 1024 }) : null)

/** A row of the templates list: a template, or the place where one was just deleted, with Deshacer in it (J2-A-23). */
type TemplateItem = { kind: 'template'; template: Template } | { kind: 'removed'; template: Template }

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
  const live = useMemo(() => (templates.data ?? []).filter((x) => !x.deleted_at), [templates.data])
  const showRemoved = removed && removed.template.area_id === area.id && undo.undoCount === removed.mark
  const rows = useMemo<TemplateItem[]>(() => {
    const items: TemplateItem[] = live.map((template) => ({ kind: 'template', template }))
    if (showRemoved) items.splice(Math.min(removed.index, items.length), 0, { kind: 'removed', template: removed.template })
    return items
  }, [live, removed, showRemoved])

  // Deleting is reversible: it is done and Deshacer restores it (POST /templates/:id/restore). The row says so where it was.
  const remove = (template: Template) => {
    const index = live.findIndex((x) => x.id === template.id)
    const mark = undo.undoCount + 1
    return undo
      .run({ label: t('areas.deleted'), redo: () => del.mutateAsync(template.id), undo: () => restore.mutateAsync(template.id) })
      .then(() => setRemoved({ template, index, mark }))
  }

  return (
    <section aria-label={t('areas.templates')} className="flex min-h-0 min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          {t('areas.templates')}
          <span className="break-words text-sm font-semibold normal-case tracking-normal text-accent-deep">{area.title}</span>
        </h2>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus size={14} aria-hidden /> {t('areas.addTemplate')}
        </Button>
      </div>
      <FitList
        rows={rows}
        rowKey={(x) => `${x.kind}-${x.template.id}`}
        reveal={created}
        renderRow={(x) => (x.kind === 'removed' ? <RemovedRow template={x.template} onUndo={() => void undo.undo()} /> : <TemplateRow template={x.template} areaId={area.id} onRemove={() => void remove(x.template)} />)}
        empty={
          templates.isPending || templates.isError ? (
            <LoadState query={templates} />
          ) : (
            <EmptyState
              action={
                <Button size="sm" onClick={() => setCreating(true)}>
                  <Plus size={14} aria-hidden /> {t('areas.addTemplate')}
                </Button>
              }
            >
              {t('areas.noTemplates')}
            </EmptyState>
          )
        }
      />
      <NewTemplateDialog open={creating} onOpenChange={setCreating} onCreate={async (v) => {
          const made = (await save.mutateAsync(v)) as Template | undefined
          if (made?.id) setCreated(`template-${made.id}`)
        }} />
    </section>
  )
}

function RemovedRow({ template, onUndo }: { template: Template; onUndo: () => void }) {
  const t = useT()
  return (
    <article role="status" className="flex items-center justify-between gap-3 border-b border-line bg-hover px-4 py-3 last:border-b-0">
      <span className="min-w-0 break-words text-muted">{t('areas.deletedRow', { name: template.name })}</span>
      <Button size="sm" variant="secondary" onClick={onUndo}>
        {t('undo.undo')}
      </Button>
    </article>
  )
}

/**
 * A template as the person will meet it: its name and description edited in place, the fields it asks for and the
 * instructions it gives the model, folded. The one button names what it opens, «Campos e instrucciones»; deleting is
 * a small icon at the corner, away from the title, and it is undone where it was (J3-A-30, J3-A-31, J3-A-32).
 */
function TemplateRow({ template, areaId, onRemove }: { template: Template; areaId: string; onRemove: () => void }) {
  const t = useT()
  const undo = useUndo()
  const save = useSaveTemplate(areaId)
  const [showContent, setShowContent] = useState(false)
  const fields = useMemo(() => parseTemplateFields(template.body_markdown), [template.body_markdown])
  const instructions = useMemo(() => templateInstructions(template.body_markdown), [template.body_markdown])

  const change = (field: 'name' | 'description' | 'body_markdown', next: string) => {
    const prev = template[field]
    return undo.run({ label: t('areas.edited'), redo: () => save.mutateAsync({ id: template.id, [field]: next }), undo: () => save.mutateAsync({ id: template.id, [field]: prev }) })
  }

  return (
    <article className="flex flex-col gap-3 border-b border-line px-4 py-3 last:border-b-0">
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <EditableText value={template.name} label={t('areas.fieldName')} validate={nameRule(t)} onSave={(v) => change('name', v)} displayClassName="font-medium" />
          <EditableText value={template.description} label={t('areas.fieldDescription')} multiline validate={descriptionRule(t)} onSave={(v) => change('description', v)} displayClassName="text-xs text-muted" />
        </div>
        <Button size="icon-sm" variant="ghost" className="-mr-1.5 shrink-0 text-muted hover:text-danger" aria-label={t('areas.delete', { name: template.name })} title={t('areas.deleteShort')} onClick={onRemove}>
          <Trash2 size={14} aria-hidden />
        </Button>
      </div>
      <dl className="flex flex-col gap-1.5 text-sm">
        <dt className="text-xs font-semibold text-muted">{t('templates.fields')}</dt>
        <dd>
          {fields.length === 0 ? (
            <span className="text-muted">{t('templates.noFields')}</span>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {fields.map((f) => (
                <li key={f.name} className="inline-flex min-h-6 items-center gap-1.5 rounded-full border border-line-strong px-2.5 text-xs">
                  {f.label}
                  {f.required && <span className="text-muted">{t('templates.required')}</span>}
                </li>
              ))}
            </ul>
          )}
        </dd>
      </dl>
      {/* The instructions can be as long as a method section: they fold, and the window below is where they are edited. */}
      <details className="group text-sm">
        <summary data-repeat-ok="per-template" className="inline-flex cursor-pointer list-none items-center gap-1 text-xs font-semibold text-muted hover:text-fg [&::-webkit-details-marker]:hidden">
          <ChevronRight size={13} aria-hidden className="transition-transform group-open:rotate-90" />
          {t('templates.instructions')}
        </summary>
        <div data-lane="template-instructions" data-repeat-ok="per-template" className="scroll-thin mt-2 max-h-48 overflow-y-auto pr-1">
          <Markdown source={instructions} />
        </div>
      </details>
      <div>
        <Button size="sm" data-repeat-ok="per-template" onClick={() => setShowContent(true)}>
          {t('areas.content')}
        </Button>
      </div>
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
