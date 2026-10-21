import { ChevronDown, ChevronRight, Plus, Trash2, X } from '@/components/icons'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { api, attachmentUrl, unwrapList } from '@/lib/api'
import { useJobProgress } from '@/lib/events'
import { useCancelInput, usePublish, useTemplates } from '@/lib/queries'
import type { Attachment, InputRecord, InputStatus, Proposal, ProposalMessage, Template } from '@/lib/types'
import { Avatar } from './Avatar'
import { EditableText } from './EditableText'
import { useLookups } from './lookups'
import { MemberPicker } from './MemberPicker'
import { Thumb } from './Thumb'

const STATUS_PHRASE: Partial<Record<InputStatus, string>> = {
  queued: 'En cola',
  extracting: 'Leyendo adjuntos',
  analyzing: 'Analizando',
}

/**
 * Bloque «Análisis»: progreso por SSE mientras el trabajo corre y, al terminar, la propuesta
 * editable. Nada llega al equipo hasta que el emisor aprieta Enviar (UD-003).
 */
export function AnalysisPanel({ input, onClose }: { input: InputRecord; onClose: () => void }) {
  const progress = useJobProgress(input.job_id, input.id)
  const cancel = useCancelInput()
  const processing = input.status === 'queued' || input.status === 'extracting' || input.status === 'analyzing'

  return (
    <section aria-label="Análisis" className="flex min-w-0 flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2>Análisis</h2>
        {input.status === 'proposed' && <Badge tone="accent">Propuesta</Badge>}
        {input.status === 'failed' && <Badge tone="danger">Falló</Badge>}
      </div>

      {processing && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 text-[13px]">
            <span>{progress?.phrase || STATUS_PHRASE[input.status]}</span>
            <span className="tabular-nums text-muted">{Math.round(progress?.percent ?? 0)} %</span>
          </div>
          <div
            role="progressbar"
            aria-label="Progreso del análisis"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress?.percent ?? 0)}
            className="meter h-2.5"
          >
            <div className="meter-fill" style={{ width: `${progress?.percent ?? 0}%` }} />
          </div>
          <div>
            <Button size="sm" variant="ghost" disabled={cancel.isPending} onClick={() => cancel.mutate(input.id, { onSuccess: onClose })}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {input.status === 'failed' && (
        <div className="flex flex-col gap-2">
          <p role="alert" className="text-sm text-danger">
            {input.error || 'El análisis no terminó'}
          </p>
          <div>
            <Button size="sm" onClick={onClose}>
              Descartar
            </Button>
          </div>
        </div>
      )}

      {input.status === 'proposed' && input.proposal && (
        <ProposalEditor key={input.id} input={input} initial={input.proposal} onPublished={onClose} onDiscard={() => cancel.mutate(input.id, { onSuccess: onClose })} />
      )}
    </section>
  )
}

function ProposalEditor({
  input,
  initial,
  onPublished,
  onDiscard,
}: {
  input: InputRecord
  initial: Proposal
  onPublished: () => void
  onDiscard: () => void
}) {
  const { members, memberName } = useLookups()
  const publish = usePublish()
  const [proposal, setProposal] = useState<Proposal>(initial)
  const [showDiscarded, setShowDiscarded] = useState(false)

  useEffect(() => setProposal(initial), [initial])

  const patch = (index: number, change: Partial<ProposalMessage>) =>
    setProposal((p) => ({ ...p, messages: p.messages.map((m, i) => (i === index ? { ...m, ...change } : m)) }))

  const remove = (index: number) => setProposal((p) => ({ ...p, messages: p.messages.filter((_, i) => i !== index) }))

  const send = () => publish.mutate({ inputId: input.id, proposal }, { onSuccess: onPublished })

  const required = (v: string) => (v.trim() ? null : 'Obligatorio')
  const unitText = (id: string) => input.units?.find((u) => u.id === id)?.text
  const discarded = proposal.discarded ?? []
  const discardedCount = discarded.reduce((n, d) => n + d.unit_ids.length, 0)

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted">{proposal.messages.length === 1 ? '1 mensaje' : `${proposal.messages.length} mensajes`}</p>

      <ol className="flex flex-col divide-y divide-line border-y border-line">
        {proposal.messages.map((m, i) => {
          const included = input.attachments.filter((a) => m.attachment_ids.includes(a.id))
          const available = input.attachments.filter((a) => !m.attachment_ids.includes(a.id))
          return (
            <li key={i} className="flex flex-col gap-2.5 py-3.5">
              <div className="flex items-start gap-2">
                <MessageArea
                  areaId={m.area_id}
                  templateId={m.template_id}
                  onChange={(area_id, template_id) => patch(i, { area_id, template_id })}
                />
                <EditableText
                  value={m.title}
                  label="Título del mensaje"
                  validate={required}
                  onSave={(v) => patch(i, { title: v })}
                  displayClassName="font-semibold"
                  className="min-w-0 flex-1"
                />
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Quitar el mensaje ${m.title}`}
                  onClick={() => remove(i)}
                  disabled={proposal.messages.length === 1}
                >
                  <Trash2 size={14} aria-hidden />
                </Button>
              </div>
              <EditableText
                value={m.body}
                label="Texto del mensaje"
                multiline
                validate={required}
                onSave={(v) => patch(i, { body: v })}
                displayClassName="text-[13px]"
              />
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                <span className="mr-1">Para</span>
                {m.assignee_ids.map((id) => (
                  <Badge key={id} tone="accent" className="h-6 gap-1 pl-0.5 pr-1">
                    <Avatar name={memberName(id) || '?'} size={18} />
                    {memberName(id)}
                    <button
                      type="button"
                      aria-label={`Quitar a ${memberName(id)}`}
                      className="rounded-sm p-0.5 hover:bg-accent/15"
                      onClick={() => patch(i, { assignee_ids: m.assignee_ids.filter((x) => x !== id) })}
                    >
                      <X size={11} aria-hidden />
                    </button>
                  </Badge>
                ))}
                <MemberPicker members={members} selected={m.assignee_ids} onChange={(ids) => patch(i, { assignee_ids: ids })} />
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <span className="mr-1">Adjuntos</span>
                {included.map((a) => (
                  <AttachmentThumb key={a.id} a={a} onRemove={() => patch(i, { attachment_ids: m.attachment_ids.filter((x) => x !== a.id) })} />
                ))}
                {available.length > 0 && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        aria-label="Agregar adjunto"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-dashed border-line-strong text-muted hover:border-accent hover:text-accent"
                      >
                        <Plus size={14} aria-hidden />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-2">
                      <ul className="flex flex-wrap gap-2">
                        {available.map((a) => (
                          <li key={a.id}>
                            <button type="button" aria-label={`Agregar ${a.name ?? a.kind}`} onClick={() => patch(i, { attachment_ids: [...m.attachment_ids, a.id] })}>
                              <Thumb item={{ kind: a.kind, src: a.kind === 'link' ? undefined : attachmentUrl(a.id), name: a.name, size: a.size }} px={48} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </PopoverContent>
                  </Popover>
                )}
              </div>
            </li>
          )
        })}
      </ol>

      {discardedCount > 0 && (
        <div>
          <button
            type="button"
            aria-expanded={showDiscarded}
            onClick={() => setShowDiscarded((v) => !v)}
            className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg"
          >
            <ChevronRight size={14} aria-hidden className={showDiscarded ? 'rotate-90' : ''} />
            Sin acción <Badge tone="neutral">{discardedCount}</Badge>
          </button>
          {showDiscarded && (
            <ul className="mt-2 flex flex-col gap-2 border-l-2 border-line pl-3">
              {discarded.map((d, i) => (
                <li key={i} className="text-[13px]">
                  <p className="text-xs text-muted">{d.reason}</p>
                  {d.unit_ids.map((id) => (
                    <p key={id} className="whitespace-pre-wrap">
                      {unitText(id) ?? id}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        {publish.isError && (
          <span role="alert" className="mr-auto text-xs text-danger">
            {publish.error.message}
          </span>
        )}
        <Button variant="ghost" onClick={onDiscard} disabled={publish.isPending}>
          Descartar
        </Button>
        <Button variant="primary" onClick={send} disabled={publish.isPending || proposal.messages.length === 0}>
          Enviar
        </Button>
      </div>
    </div>
  )
}

/** Área de un mensaje como insignia cambiable. Al cambiarla, la plantilla pasa a ser la primera de la nueva área. */
function MessageArea({
  areaId,
  templateId,
  onChange,
}: {
  areaId: string
  templateId: string | null
  onChange: (areaId: string, templateId: string | null) => void
}) {
  const { areas, areaTitle } = useLookups()
  const queryClient = useQueryClient()
  const templates = useTemplates(areaId)
  const templateName = templates.data?.find((t) => t.id === templateId)?.name

  const choose = async (next: string) => {
    if (next === areaId) return
    let first: string | null = null
    try {
      const list = await queryClient.fetchQuery({
        queryKey: ['templates', next],
        queryFn: async () => unwrapList<Template>(await api(`/areas/${next}/templates`)),
      })
      first = list[0]?.id ?? null
    } catch {
      // Sin acceso a las plantillas del área, el servidor elige la que corresponde.
    }
    onChange(next, first)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Área: ${areaTitle(areaId) || 'sin área'}${templateName ? `, plantilla ${templateName}` : ''}`}
          title={templateName}
          className="mt-0.5 inline-flex h-6 shrink-0 items-center gap-1 rounded-[3px_9px_3px_9px] border border-edge bg-[linear-gradient(180deg,var(--color-chrome-1),var(--color-chrome-2))] pl-2 pr-1.5 text-xs font-semibold text-fg hover:border-accent"
        >
          {areaTitle(areaId) || 'Sin área'}
          <ChevronDown size={12} aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup value={areaId} onValueChange={(v) => void choose(v)}>
          {areas.map((a) => (
            <DropdownMenuRadioItem key={a.id} value={a.id}>
              {a.title}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function AttachmentThumb({ a, onRemove }: { a: Attachment; onRemove: () => void }) {
  return (
    <Thumb
      item={{ kind: a.kind, src: a.kind === 'link' ? undefined : attachmentUrl(a.id), name: a.name, size: a.size }}
      px={40}
      onRemove={onRemove}
    />
  )
}
