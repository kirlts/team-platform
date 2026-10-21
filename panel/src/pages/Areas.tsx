import { ChevronRight, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import { EditableText } from '@/components/EditableText'
import { FormDialog } from '@/components/FormDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog'
import { useAreas, useDeleteTemplate, useMe, useSaveArea, useSaveTemplate, useTemplates } from '@/lib/queries'
import type { Area, Template } from '@/lib/types'
import { cn } from '@/lib/utils'

const nameRule = (v: string) => (!v ? 'Obligatorio' : v.length > 64 ? 'Máximo 64 caracteres' : null)
const descriptionRule = (v: string) => (v.length > 1024 ? 'Máximo 1.024 caracteres' : null)

/** Áreas y plantillas con edición en el lugar. Sólo el Editor entra. */
export function Areas() {
  const me = useMe().data
  const areas = useAreas()
  const { areaId } = useParams()
  const [open, setOpen] = useState<Set<string>>(() => new Set(areaId ? [areaId] : []))

  useEffect(() => {
    if (areaId) setOpen((prev) => new Set(prev).add(areaId))
  }, [areaId])

  if (me && me.role !== 'editor') return <Navigate to="/" replace />

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 p-4 md:p-6">
      <h1 className="text-xl font-semibold">Áreas</h1>
      <div className="overflow-hidden rounded-lg border border-line">
        {areas.isPending ? (
          <p className="px-3 py-8 text-center text-sm text-muted">Cargando</p>
        ) : (areas.data ?? []).length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted">Sin áreas</p>
        ) : (
          (areas.data ?? []).map((a) => <AreaSection key={a.id} area={a} expanded={open.has(a.id)} onToggle={() => toggle(a.id)} highlighted={a.id === areaId} />)
        )}
      </div>
    </div>
  )
}

function AreaSection({ area, expanded, onToggle, highlighted }: { area: Area; expanded: boolean; onToggle: () => void; highlighted: boolean }) {
  const save = useSaveArea()
  return (
    <section className={cn('border-b border-line last:border-b-0', highlighted && 'bg-accent-soft/40')}>
      <div className="flex items-start gap-2 px-3 py-2.5">
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? `Plegar ${area.title}` : `Desplegar ${area.title}`}
          onClick={onToggle}
          className="mt-0.5 rounded-sm p-0.5 text-muted hover:bg-hover"
        >
          <ChevronRight size={16} aria-hidden className={cn('transition-transform', expanded && 'rotate-90')} />
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <EditableText
            value={area.title}
            label="Título del área"
            validate={nameRule}
            onSave={(title) => save.mutateAsync({ id: area.id, title })}
            displayClassName="font-semibold"
          />
          <EditableText
            value={area.description}
            label="Descripción del área"
            multiline
            rows={2}
            validate={(v) => (v ? descriptionRule(v) : 'Obligatorio')}
            onSave={(description) => save.mutateAsync({ id: area.id, description })}
            displayClassName="text-[13px] text-muted"
          />
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          {(area.template_count ?? 0) > 0 && (
            <span className="hidden text-xs text-muted sm:inline">{area.template_count === 1 ? '1 plantilla' : `${area.template_count} plantillas`}</span>
          )}
          <Link to={`/messages?f=area:eq:${area.id}&f=status:neq:closed`} aria-label={`Mensajes abiertos de ${area.title}`}>
            <Badge tone={(area.open_count ?? 0) > 0 ? 'open' : 'neutral'}>{area.open_count ?? 0} abiertos</Badge>
          </Link>
        </div>
      </div>
      {expanded && <Templates areaId={area.id} />}
    </section>
  )
}

function Templates({ areaId }: { areaId: string }) {
  const templates = useTemplates(areaId)
  const save = useSaveTemplate(areaId)
  const [creating, setCreating] = useState(false)

  return (
    <div className="border-t border-line bg-surface/50 py-1 pl-9 pr-3">
      {templates.isPending ? (
        <p className="py-3 text-sm text-muted">Cargando</p>
      ) : (
        <ul className="flex flex-col">
          {(templates.data ?? []).map((t) => (
            <TemplateRow key={t.id} template={t} areaId={areaId} />
          ))}
        </ul>
      )}
      {templates.data?.length === 0 && <p className="py-2 text-sm text-muted">Sin plantillas</p>}
      <div className="py-2">
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus size={14} aria-hidden /> Plantilla
        </Button>
      </div>
      <FormDialog
        open={creating}
        onOpenChange={setCreating}
        title="Nueva plantilla"
        submitLabel="Crear"
        fields={[
          { name: 'name', label: 'Nombre', required: true, maxLength: 64 },
          { name: 'description', label: 'Descripción', multiline: true, required: true, maxLength: 1024, rows: 2 },
          { name: 'body_markdown', label: 'Contenido', multiline: true, rows: 6, mono: true, initial: '## Método\n\n## Formato de salida\n' },
        ]}
        onSubmit={(v) => save.mutateAsync({ name: v.name, description: v.description, body_markdown: v.body_markdown })}
      />
    </div>
  )
}

function TemplateRow({ template, areaId }: { template: Template; areaId: string }) {
  const save = useSaveTemplate(areaId)
  const del = useDeleteTemplate(areaId)
  const [expanded, setExpanded] = useState(false)
  const [confirming, setConfirming] = useState(false)

  return (
    <li className="border-b border-line py-2 last:border-b-0">
      <div className="flex items-start gap-2">
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? `Plegar ${template.name}` : `Ver el contenido de ${template.name}`}
          onClick={() => setExpanded((v) => !v)}
          className="mt-0.5 rounded-sm p-0.5 text-muted hover:bg-hover"
        >
          <ChevronRight size={15} aria-hidden className={cn('transition-transform', expanded && 'rotate-90')} />
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <EditableText
            value={template.name}
            label="Nombre de la plantilla"
            validate={nameRule}
            onSave={(name) => save.mutateAsync({ id: template.id, name })}
            displayClassName="font-medium"
          />
          <EditableText
            value={template.description}
            label="Descripción de la plantilla"
            multiline
            rows={2}
            validate={(v) => (v ? descriptionRule(v) : 'Obligatorio')}
            onSave={(description) => save.mutateAsync({ id: template.id, description })}
            displayClassName="text-[13px] text-muted"
          />
          {expanded && (
            <div className="mt-1.5">
              <EditableText
                value={template.body_markdown}
                label="Contenido de la plantilla"
                multiline
                mono
                rows={16}
                placeholder="Sin contenido"
                onSave={(body_markdown) => save.mutateAsync({ id: template.id, body_markdown })}
              />
            </div>
          )}
        </div>
        <Button size="icon-sm" variant="ghost" aria-label={`Eliminar ${template.name}`} onClick={() => setConfirming(true)}>
          <Trash2 size={14} aria-hidden />
        </Button>
      </div>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent title={`Eliminar «${template.name}»`}>
          <div className="flex flex-col gap-3 p-4">
            <p className="text-sm">Se pierde su contenido y no se puede recuperar.</p>
            {del.isError && (
              <p role="alert" className="text-xs text-danger">
                {del.error.message}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button variant="ghost">Cancelar</Button>
              </DialogClose>
              <Button variant="danger" disabled={del.isPending} onClick={() => del.mutate(template.id, { onSuccess: () => setConfirming(false) })}>
                Eliminar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </li>
  )
}
