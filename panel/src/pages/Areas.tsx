import { ChevronRight, Plus, Trash2 } from '@/components/icons'
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { EditableText } from '@/components/EditableText'
import { FitList } from '@/components/FitList'
import { FormDialog } from '@/components/FormDialog'
import { Page } from '@/components/Page'
import { PageHeader } from '@/components/PageHeader'
import { NewTemplateDialog, TemplateContentDialog } from '@/components/TemplateEditor'
import { UndoButtons } from '@/components/UndoButtons'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import { useAreas, useDeleteTemplate, useMe, useRestoreTemplate, useSaveArea, useSaveTemplate, useTemplates } from '@/lib/queries'
import { parseTemplateFields } from '@/lib/template'
import type { Area, Template } from '@/lib/types'
import { UndoProvider, useUndo, useUndoStack } from '@/lib/undo'
import { cn } from '@/lib/utils'

/** Areas and templates with in-place editing and undo. Only the Editor enters. Areas on the left; the chosen one's templates on the right. */
export function Areas() {
  const t = useT()
  const me = useMe().data
  const areas = useAreas()
  const save = useSaveArea()
  const { areaId } = useParams()
  const navigate = useNavigate()
  const undo = useUndoStack()
  const [creating, setCreating] = useState(false)
  const rows = useMemo(() => areas.data ?? [], [areas.data])
  const selected = rows.find((a) => a.id === areaId) ?? rows[0]

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
        <div className="grid min-h-0 flex-1 md:grid-rows-[minmax(0,1fr)] gap-x-10 gap-y-4 md:grid-cols-[minmax(0,6fr)_minmax(0,6fr)]">
          <FitList
            rows={rows}
            rowKey={(a) => a.id}
            label={t('nav.areas')}
            renderRow={(a) => <AreaRow area={a} selected={a.id === selected?.id} onSelect={() => navigate(`/areas/${a.id}`)} />}
            empty={<p className="px-3 py-8 text-center text-sm text-muted">{areas.isPending ? t('common.loading') : t('areas.none')}</p>}
          />
          {selected ? <Templates area={selected} /> : <div />}
        </div>
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

const nameRule = (t: ReturnType<typeof useT>) => (v: string) => (!v ? t('common.required') : v.length > 64 ? t('form.maxLength', { n: 64 }) : null)
const descriptionRule = (t: ReturnType<typeof useT>) => (v: string) => (!v ? t('common.required') : v.length > 1024 ? t('form.maxLength', { n: 1024 }) : null)

function AreaRow({ area, selected, onSelect }: { area: Area; selected: boolean; onSelect: () => void }) {
  const t = useT()
  const undo = useUndo()
  const save = useSaveArea()
  const pending = area.unresolved_count ?? area.open_count ?? 0

  const change = (field: 'title' | 'description', next: string) => {
    const prev = area[field]
    return undo.run({ label: t('areas.edited'), redo: () => save.mutateAsync({ id: area.id, [field]: next }), undo: () => save.mutateAsync({ id: area.id, [field]: prev }) })
  }

  return (
    <section
      aria-current={selected ? 'true' : undefined}
      // The chosen area is a filled row with an accent bar on its edge (J1-A-33): measured in `npm run contraste`, not only a tint.
      className={cn('flex flex-wrap items-start gap-x-3 gap-y-1.5 border-b border-line px-4 py-3 last:border-b-0', selected && 'bg-selected shadow-[inset_4px_0_0_var(--color-accent)]')}
    >
      <button
        type="button"
        aria-pressed={selected}
        aria-label={t('areas.show', { title: area.title })}
        onClick={onSelect}
        className="mt-0.5 rounded-sm p-0.5 text-muted hover:bg-hover"
      >
        <ChevronRight size={16} aria-hidden className={cn('transition-transform', selected && 'text-accent')} />
      </button>
      <div className="flex min-w-0 flex-1 basis-40 flex-col gap-0.5">
        <EditableText value={area.title} label={t('areas.fieldTitle')} validate={nameRule(t)} onSave={(v) => change('title', v)} displayClassName="font-semibold" />
        <EditableText value={area.description} label={t('areas.fieldDescription')} multiline validate={descriptionRule(t)} onSave={(v) => change('description', v)} displayClassName="text-xs text-muted" />
      </div>
      {/* Fixed-width column: what is pending lines up row by row. A count is text; the colors are for what changes state (J1-A-34). */}
      <span className={cn('flex shrink-0 justify-end text-xs tabular-nums max-sm:ml-9 sm:w-24', pending > 0 ? 'font-semibold text-fg' : 'text-muted')}>{t('areas.pending', { n: pending })}</span>
    </section>
  )
}

function Templates({ area }: { area: Area }) {
  const t = useT()
  const templates = useTemplates(area.id)
  const save = useSaveTemplate(area.id)
  const [creating, setCreating] = useState(false)
  const rows = useMemo(() => (templates.data ?? []).filter((x) => !x.deleted_at), [templates.data])

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
        rowKey={(x) => x.id}
        renderRow={(x) => <TemplateRow template={x} areaId={area.id} />}
        empty={<p className="px-3 py-6 text-center text-sm text-muted">{templates.isPending ? t('common.loading') : t('areas.noTemplates')}</p>}
      />
      <NewTemplateDialog open={creating} onOpenChange={setCreating} onCreate={(v) => save.mutateAsync(v)} />
    </section>
  )
}

function TemplateRow({ template, areaId }: { template: Template; areaId: string }) {
  const t = useT()
  const undo = useUndo()
  const save = useSaveTemplate(areaId)
  const del = useDeleteTemplate(areaId)
  const restore = useRestoreTemplate()
  const [showContent, setShowContent] = useState(false)
  const fields = useMemo(() => parseTemplateFields(template.body_markdown), [template.body_markdown])

  const change = (field: 'name' | 'description' | 'body_markdown', next: string) => {
    const prev = template[field]
    return undo.run({ label: t('areas.edited'), redo: () => save.mutateAsync({ id: template.id, [field]: next }), undo: () => save.mutateAsync({ id: template.id, [field]: prev }) })
  }

  // Deleting is reversible: it is done and Deshacer restores it (POST /templates/:id/restore).
  const remove = () => undo.run({ label: t('areas.deleted'), redo: () => del.mutateAsync(template.id), undo: () => restore.mutateAsync(template.id) })

  return (
    <article className="flex items-start gap-2 border-b border-line px-4 py-3 last:border-b-0">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <EditableText value={template.name} label={t('areas.fieldName')} validate={nameRule(t)} onSave={(v) => change('name', v)} displayClassName="font-medium" />
        <EditableText value={template.description} label={t('areas.fieldDescription')} multiline validate={descriptionRule(t)} onSave={(v) => change('description', v)} displayClassName="text-xs text-muted" />
        <button type="button" onClick={() => setShowContent(true)} className="mt-1 self-start text-xs font-medium text-accent hover:underline">
          {t('areas.content', { n: fields.length })}
        </button>
      </div>
      <Button size="sm" variant="ghost" className="-mr-2 text-muted" aria-label={t('areas.delete', { name: template.name })} onClick={() => void remove()}>
        <Trash2 size={14} aria-hidden /> {t('areas.deleteShort')}
      </Button>
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
