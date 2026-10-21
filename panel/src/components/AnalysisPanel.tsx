import { RotateCw, Trash2 } from '@/components/icons'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useErrorText, useI18n, useT, type MessageKey } from '@/i18n'
import { useJobProgress } from '@/lib/events'
import { useCancelInput, usePublish, useReprocess, useSaveProposal, useTemplates } from '@/lib/queries'
import { missingRequired, parseTemplateFields, remapFields } from '@/lib/template'
import type { Attachment, InputRecord, InputStatus, Proposal, ProposalMessage, Template } from '@/lib/types'
import { useUndo } from '@/lib/undo'
import { AreaPicker } from './AreaPicker'
import { AttachmentPicker } from './AttachmentPicker'
import { EditableText } from './EditableText'
import { FitList } from './FitList'
import { RecipientsEditor } from './RecipientsEditor'
import { TemplateFields } from './TemplateFields'
import { UndoButtons } from './UndoButtons'

const STATUS_PHRASE: Partial<Record<InputStatus, MessageKey>> = {
  queued: 'analysis.queued',
  extracting: 'analysis.extracting',
  analyzing: 'analysis.analyzing',
}

/**
 * Bloque «Análisis»: progreso por SSE mientras el trabajo corre y, al terminar, la propuesta
 * editable. Nada llega al equipo hasta que el emisor aprieta Enviar (UD-003).
 */
export function AnalysisPanel({ input, onClose }: { input: InputRecord; onClose: () => void }) {
  const t = useT()
  const { has } = useI18n()
  const undo = useUndo()
  const progress = useJobProgress(input.job_id, input.id)
  const cancel = useCancelInput()
  const reprocess = useReprocess()
  const errorText = useErrorText()
  const processing = input.status === 'queued' || input.status === 'extracting' || input.status === 'analyzing'
  const failureCode = input.error_code ? `analysis.error.${input.error_code}` : ''
  const failureText = failureCode && has(failureCode) ? t(failureCode as MessageKey) : input.error || t('analysis.failed')

  return (
    <section aria-label={t('analysis.title')} className="flex min-h-0 min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2>{t('analysis.title')}</h2>
          {input.status === 'proposed' && <Badge tone="accent">{t('analysis.proposal')}</Badge>}
          {input.status === 'failed' && <Badge tone="danger">{t('analysis.failedBadge')}</Badge>}
        </div>
        {(input.status === 'proposed' || input.status === 'failed') && <UndoButtons stack={undo} />}
      </div>

      {processing && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 text-[13px]">
            <span>{progress?.phrase || (STATUS_PHRASE[input.status] ? t(STATUS_PHRASE[input.status]!) : '')}</span>
            <span className="tabular-nums text-muted">{Math.round(progress?.percent ?? 0)} %</span>
          </div>
          <div role="progressbar" aria-label={t('analysis.progress')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress?.percent ?? 0)} className="meter h-2.5">
            <div className="meter-fill" style={{ width: `${progress?.percent ?? 0}%` }} />
          </div>
          <div>
            <Button size="sm" variant="ghost" disabled={cancel.isPending} onClick={() => cancel.mutate(input.id, { onSuccess: onClose })}>
              {t('analysis.cancel')}
            </Button>
          </div>
        </div>
      )}

      {input.status === 'failed' && (
        <div className="flex flex-col gap-3">
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            {failureText}
          </p>
          {reprocess.isError && (
            <p role="alert" className="text-sm text-danger">
              {errorText(reprocess.error)}
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button variant="primary" disabled={reprocess.isPending} onClick={() => reprocess.mutate(input.id)}>
              <RotateCw size={14} aria-hidden /> {t('common.retry')}
            </Button>
            <Button variant="ghost" onClick={() => cancel.mutate(input.id, { onSuccess: onClose })} disabled={cancel.isPending}>
              {t('analysis.discard')}
            </Button>
          </div>
        </div>
      )}

      {input.status === 'proposed' && input.proposal && <ProposalEditor key={input.id} input={input} initial={input.proposal} onPublished={onClose} onDiscard={() => cancel.mutate(input.id, { onSuccess: onClose })} />}
    </section>
  )
}

interface Row {
  m: ProposalMessage
  i: number
}

function ProposalEditor({ input, initial, onPublished, onDiscard }: { input: InputRecord; initial: Proposal; onPublished: () => void; onDiscard: () => void }) {
  const t = useT()
  const errorText = useErrorText()
  const undo = useUndo()
  const publish = usePublish()
  const saveProposal = useSaveProposal(input.id)
  const queryClient = useQueryClient()
  const [proposal, setProposal] = useState<Proposal>(initial)
  const latest = useRef<Proposal>(initial)
  const chain = useRef<Promise<unknown>>(Promise.resolve())
  const [saveError, setSaveError] = useState<unknown>(null)

  /** Pone la propuesta en pantalla y la guarda como borrador; los guardados salen de a uno y en orden. */
  const apply = (next: Proposal) => {
    latest.current = next
    setProposal(next)
    const run = chain.current.then(() => saveProposal.mutateAsync(next))
    chain.current = run.catch(() => undefined)
    return run.then(
      () => setSaveError(null),
      (err) => {
        setSaveError(err)
        throw err
      },
    )
  }

  /** Cada cambio es una operación que se puede deshacer y rehacer. */
  const change = (label: string, make: (p: Proposal) => Proposal) => {
    const before = latest.current
    const after = make(before)
    return undo.run({ label, redo: () => apply(after), undo: () => apply(before) })
  }

  const patch = (index: number, label: string, fix: Partial<ProposalMessage> | ((m: ProposalMessage) => Partial<ProposalMessage>)) =>
    change(label, (p) => ({ ...p, messages: p.messages.map((m, i) => (i === index ? { ...m, ...(typeof fix === 'function' ? fix(m) : fix) } : m)) }))

  /** Quitar un mensaje no pierde su texto: sus unidades pasan a «Sin acción», que es lo que la publicación exige. */
  const remove = (index: number) =>
    change(t('proposal.removed'), (p) => {
      const gone = p.messages[index]
      return {
        ...p,
        messages: p.messages.filter((_, i) => i !== index),
        discarded: gone.unit_ids.length > 0 ? [...(p.discarded ?? []), { unit_ids: gone.unit_ids, reason: t('proposal.removedReason') }] : (p.discarded ?? []),
      }
    })

  const rows = useMemo<Row[]>(() => proposal.messages.map((m, i) => ({ m, i })), [proposal])
  const discarded = proposal.discarded ?? []
  const discardedCount = discarded.reduce((n, d) => n + d.unit_ids.length, 0)
  const unitText = (id: number) => input.units?.find((u) => u.id === id)?.text

  // Qué falta por mensaje: se calcula con la plantilla de cada uno.
  const [missing, setMissing] = useState<Record<number, string[]>>({})
  const missingTotal = Object.values(missing).reduce((n, list) => n + list.length, 0)

  const send = async () => {
    try {
      await chain.current
    } catch {
      // El error del guardado ya está a la vista; se intenta publicar igual con lo que hay en pantalla.
    }
    publish.mutate({ inputId: input.id, proposal: latest.current }, { onSuccess: onPublished })
  }

  useEffect(
    () => () => {
      void queryClient.invalidateQueries({ queryKey: ['inputs', input.id] })
    },
    [queryClient, input.id],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center justify-between gap-3 text-xs text-muted">
        <p>{t('proposal.count', { n: proposal.messages.length })}</p>
        {discardedCount > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg">
                {t('proposal.noAction')} <Badge tone="neutral">{discardedCount}</Badge>
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-96 p-3">
              <ul data-lane="discarded-units" className="scroll-thin flex max-h-72 flex-col gap-2 overflow-y-auto">
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
            </PopoverContent>
          </Popover>
        )}
      </div>

      <FitList
        bare
        rows={rows}
        rowKey={(r) => String(r.i)}
        label={t('proposal.list')}
        renderRow={({ m, i }) => (
          <ProposalRow
            message={m}
            index={i}
            attachments={input.attachments}
            onlyOne={proposal.messages.length === 1}
            patch={patch}
            remove={remove}
            onMissing={(names) => setMissing((prev) => (prev[i]?.join() === names.join() ? prev : { ...prev, [i]: names }))}
          />
        )}
      />

      {(publish.isError || saveError !== null) && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {errorText(publish.isError ? publish.error : saveError)}
        </p>
      )}

      <div className="flex shrink-0 items-center justify-end gap-2">
        <Button variant="ghost" onClick={onDiscard} disabled={publish.isPending}>
          {t('analysis.discard')}
        </Button>
        <Button variant="primary" onClick={() => void send()} disabled={publish.isPending || proposal.messages.length === 0 || missingTotal > 0} title={missingTotal > 0 ? t('proposal.missing', { n: missingTotal }) : undefined}>
          {t('proposal.send')}
        </Button>
      </div>
    </div>
  )
}

function ProposalRow({
  message: m,
  index,
  attachments,
  onlyOne,
  patch,
  remove,
  onMissing,
}: {
  message: ProposalMessage
  index: number
  attachments: Attachment[]
  onlyOne: boolean
  patch: (index: number, label: string, fix: Partial<ProposalMessage> | ((m: ProposalMessage) => Partial<ProposalMessage>)) => Promise<void>
  remove: (index: number) => Promise<void>
  onMissing: (names: string[]) => void
}) {
  const t = useT()
  const templates = useTemplates(m.area_id)
  const template: Template | undefined = templates.data?.find((x) => x.id === m.template_id) ?? templates.data?.[0]
  const required = (v: string) => (v.trim() ? null : t('common.required'))
  const fieldDefs = useMemo(() => parseTemplateFields(template?.body_markdown ?? ''), [template?.body_markdown])
  const missingNames = missingRequired(m.fields, fieldDefs).join(',')
  useEffect(() => onMissing(missingNames ? missingNames.split(',') : []), [missingNames]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <li className="flex list-none flex-col gap-2 border-b border-line px-1 py-3 last:border-b-0">
      <div className="flex items-start gap-2">
        <AreaPicker
          areaId={m.area_id}
          templateName={template?.name}
          onChange={(area_id, next) =>
            patch(index, t('proposal.areaChanged'), (cur) => ({
              area_id,
              template_id: next?.id ?? null,
              // Los campos de la plantilla anterior no valen en la nueva: se conservan los que se llaman igual.
              fields: remapFields(cur.fields, parseTemplateFields(next?.body_markdown ?? '')),
            }))
          }
        />
        <EditableText value={m.title} label={t('proposal.title')} validate={required} onSave={(v) => patch(index, t('proposal.titleEdited'), { title: v })} displayClassName="font-semibold" className="min-w-0 flex-1" />
        <Button size="sm" variant="ghost" className="shrink-0 text-muted" onClick={() => void remove(index)} disabled={onlyOne} aria-label={t('proposal.remove', { title: m.title })}>
          <Trash2 size={13} aria-hidden /> {t('proposal.removeShort')}
        </Button>
      </div>
      <EditableText value={m.body} label={t('proposal.body')} multiline prose validate={required} onSave={(v) => patch(index, t('proposal.bodyEdited'), { body: v })} displayClassName="text-[13px]" />
      <TemplateFields template={template} values={m.fields} onSave={(name, value) => patch(index, t('proposal.fieldEdited'), (cur) => ({ fields: { ...(cur.fields ?? {}), [name]: value } }))} />
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
        <RecipientsEditor ids={m.assignee_ids} onChange={(ids) => void patch(index, t('proposal.recipientsChanged'), { assignee_ids: ids })} />
        <AttachmentPicker all={attachments} selected={m.attachment_ids} onChange={(ids) => void patch(index, t('proposal.attachmentsChanged'), { attachment_ids: ids })} />
      </div>
    </li>
  )
}
