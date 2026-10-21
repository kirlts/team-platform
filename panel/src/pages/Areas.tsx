import { ChevronRight, Plus, Trash2 } from '@/components/icons'
import { useMemo, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { EditableText } from '@/components/EditableText'
import { FitList } from '@/components/FitList'
import { FormDialog } from '@/components/FormDialog'
import { Page } from '@/components/Page'
import { PageHeader } from '@/components/PageHeader'
import { UndoButtons } from '@/components/UndoButtons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { useT } from '@/i18n'
import { useAreas, useDeleteTemplate, useMe, useRestoreTemplate, useSaveArea, useSaveTemplate, useTemplates } from '@/lib/queries'
import { parseTemplateFields } from '@/lib/template'
import type { Area, Template } from '@/lib/types'
import { UndoProvider, useUndo, useUndoStack } from '@/lib/undo'
import { cn } from '@/lib/utils'

/** Áreas y plantillas con edición en el lugar y deshacer. Sólo el Editor entra. Las áreas a la izquierda; las plantillas de la elegida, a la derecha. */
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

  if (me && me.role !== 'editor') return <Navigate to="/" replace />

  return (
    <UndoProvider stack={undo}>
      <Page cols={12}>
        <PageHeader
          title={t('nav.areas')}
          aside={
            <div className="flex items-center gap-2">
              <UndoButtons stack={undo} />
              <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
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
    <section className={cn('flex items-start gap-3 border-b border-line px-4 py-3 last:border-b-0', selected && 'bg-accent-soft/40')}>
      <button
        type="button"
        aria-pressed={selected}
        aria-label={t('areas.show', { title: area.title })}
        onClick={onSelect}
        className="mt-0.5 rounded-sm p-0.5 text-muted hover:bg-hover"
      >
        <ChevronRight size={16} aria-hidden className={cn('transition-transform', selected && 'text-accent')} />
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <EditableText value={area.title} label={t('areas.fieldTitle')} validate={nameRule(t)} onSave={(v) => change('title', v)} displayClassName="font-semibold" />
        <EditableText value={area.description} label={t('areas.fieldDescription')} multiline validate={descriptionRule(t)} onSave={(v) => change('description', v)} displayClassName="text-[13px] text-muted" />
      </div>
      {/* Columna de ancho fijo: lo pendiente queda alineado fila a fila. */}
      <span className="flex w-24 shrink-0 justify-end">
        <Badge tone={pending > 0 ? 'open' : 'neutral'}>{t('areas.pending', { n: pending })}</Badge>
      </span>
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
        <h2>{t('areas.templatesOf', { title: area.title })}</h2>
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
      <FormDialog
        open={creating}
        onOpenChange={setCreating}
        title={t('areas.newTemplate')}
        submitLabel={t('common.create')}
        fields={[
          { name: 'name', label: t('areas.fieldName'), required: true, maxLength: 64 },
          { name: 'description', label: t('areas.fieldDescription'), multiline: true, required: true, maxLength: 1024, rows: 2 },
          { name: 'body_markdown', label: t('areas.fieldContent'), multiline: true, rows: 6, mono: true, initial: t('areas.newTemplateContent') },
        ]}
        onSubmit={(v) => save.mutateAsync({ name: v.name, description: v.description, body_markdown: v.body_markdown })}
      />
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

  // Borrar es reversible: se hace y Deshacer lo restaura (POST /templates/:id/restore).
  const remove = () => undo.run({ label: t('areas.deleted'), redo: () => del.mutateAsync(template.id), undo: () => restore.mutateAsync(template.id) })

  return (
    <article className="flex items-start gap-2 border-b border-line px-4 py-3 last:border-b-0">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <EditableText value={template.name} label={t('areas.fieldName')} validate={nameRule(t)} onSave={(v) => change('name', v)} displayClassName="font-medium" />
        <EditableText value={template.description} label={t('areas.fieldDescription')} multiline validate={descriptionRule(t)} onSave={(v) => change('description', v)} displayClassName="text-[13px] text-muted" />
        <button type="button" onClick={() => setShowContent(true)} className="mt-1 self-start text-xs text-accent hover:underline">
          {t('areas.content', { n: fields.length })}
        </button>
      </div>
      <Button size="icon-sm" variant="ghost" className="-mr-[7px]" aria-label={t('areas.delete', { name: template.name })} onClick={() => void remove()}>
        <Trash2 size={14} aria-hidden />
      </Button>
      <Dialog open={showContent} onOpenChange={setShowContent}>
        <DialogContent title={template.name} className="max-w-2xl">
          <div data-lane="template-content" className="scroll-thin min-h-0 overflow-y-auto p-5">
            <EditableText value={template.body_markdown} label={t('areas.fieldContent')} multiline mono prose validate={(v) => (v ? null : t('common.required'))} onSave={(v) => change('body_markdown', v)} />
          </div>
        </DialogContent>
      </Dialog>
    </article>
  )
}
