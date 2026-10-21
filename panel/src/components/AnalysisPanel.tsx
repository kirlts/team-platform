import { ChevronDown, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { attachmentUrl } from '@/lib/api'
import { useJobProgress } from '@/lib/events'
import { useCancelInput, usePublish } from '@/lib/queries'
import type { Attachment, InputRecord, InputStatus, Proposal, ProposalMessage } from '@/lib/types'
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
    <section aria-label="Análisis" className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Análisis</h2>
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
            className="h-2 overflow-hidden rounded-full bg-line"
          >
            <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${progress?.percent ?? 0}%` }} />
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
  const { areas, members, areaTitle, memberName } = useLookups()
  const publish = usePublish()
  const [proposal, setProposal] = useState<Proposal>(initial)
  const [areaChanged, setAreaChanged] = useState(false)

  useEffect(() => {
    setProposal(initial)
    setAreaChanged(false)
  }, [initial])

  const patch = (index: number, change: Partial<ProposalMessage>) =>
    setProposal((p) => ({ ...p, messages: p.messages.map((m, i) => (i === index ? { ...m, ...change } : m)) }))

  const remove = (index: number) => setProposal((p) => ({ ...p, messages: p.messages.filter((_, i) => i !== index) }))

  const send = () =>
    publish.mutate(
      // Al cambiar de área la plantilla elegida deja de corresponder: el servidor decide cuál usar.
      { inputId: input.id, proposal: { ...proposal, template_id: areaChanged ? null : proposal.template_id } },
      { onSuccess: onPublished },
    )

  const required = (v: string) => (v.trim() ? null : 'Obligatorio')

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-[13px]">
          <span className="text-muted">Área</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="secondary" aria-label="Área detectada">
                {areaTitle(proposal.area_id) || 'Sin área'}
                <ChevronDown size={13} aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup
                value={proposal.area_id}
                onValueChange={(v) => {
                  setProposal((p) => ({ ...p, area_id: v }))
                  setAreaChanged(v !== initial.area_id)
                }}
              >
                {areas.map((a) => (
                  <DropdownMenuRadioItem key={a.id} value={a.id}>
                    {a.title}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {proposal.template_name && !areaChanged && <span className="truncate text-muted">{proposal.template_name}</span>}
        </div>
        <span className="text-xs text-muted">{proposal.messages.length === 1 ? '1 mensaje' : `${proposal.messages.length} mensajes`}</span>
      </div>

      <ol className="flex flex-col divide-y divide-line border-y border-line">
        {proposal.messages.map((m, i) => {
          const included = input.attachments.filter((a) => m.attachment_ids.includes(a.id))
          const available = input.attachments.filter((a) => !m.attachment_ids.includes(a.id))
          return (
            <li key={i} className="flex flex-col gap-2 py-3">
              <div className="flex items-start gap-2">
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
                    <Avatar name={memberName(id) || '?'} size={18} className="bg-raised" />
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
                        +
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

function AttachmentThumb({ a, onRemove }: { a: Attachment; onRemove: () => void }) {
  return (
    <Thumb
      item={{ kind: a.kind, src: a.kind === 'link' ? undefined : attachmentUrl(a.id), name: a.name, size: a.size }}
      px={40}
      onRemove={onRemove}
    />
  )
}
