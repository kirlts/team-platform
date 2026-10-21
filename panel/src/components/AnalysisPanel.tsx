import { ChevronDown, ChevronRight, RotateCw, Trash2 } from '@/components/icons'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useErrorText, useI18n, useT, type MessageKey } from '@/i18n'
import { useJobProgress } from '@/lib/events'
import { useNotices } from '@/lib/notices'
import { useCancelInput, usePublish, useReprocess, useRestoreInput, useSaveProposal, useTemplates, useTray } from '@/lib/queries'
import { missingRequired, parseTemplateFields, remapFields } from '@/lib/template'
import type { Attachment, InputRecord, InputStatus, Proposal, ProposalMessage, Template } from '@/lib/types'
import { useUndo } from '@/lib/undo'
import { cn } from '@/lib/utils'
import { AiMark } from './AiMark'
import { AreaPicker } from './AreaPicker'
import { AttachmentPicker } from './AttachmentPicker'
import { EditableText } from './EditableText'
import { FitList } from './FitList'
import { useLookups } from './lookups'
import { Meter } from './Meter'
import { RecipientsEditor } from './RecipientsEditor'
import { TemplateFields } from './TemplateFields'
import { UndoButtons } from './UndoButtons'

const STATUS_PHRASE: Partial<Record<InputStatus, MessageKey>> = {
  queued: 'analysis.queued',
  extracting: 'analysis.extracting',
  analyzing: 'analysis.analyzing',
}

/** Discards a send and says so where the person is looking, with the way back (J1-B-26): nothing is lost by one wrong click. */
function useDiscard(input: InputRecord) {
  const t = useT()
  const cancel = useCancelInput()
  const restore = useRestoreInput()
  const notices = useNotices()
  return {
    pending: cancel.isPending,
    // `mutateAsync`, not callbacks of `mutate`: the list refreshes and takes this panel off the screen before they would run.
    run: async () => {
      try {
        await cancel.mutateAsync(input.id)
      } catch {
        return
      }
      // The page is not told the send is gone for good (it would hide it for the session): the list simply stops holding it, and Deshacer brings it back.
      notices.show({ text: t('discard.done'), action: { label: t('undo.undo'), run: () => restore.mutateAsync(input.id) } })
    },
  }
}

/**
 * «Análisis» block: progress over SSE while the job runs and, when it finishes, the editable
 * proposal. Nothing reaches the team until the sender presses Enviar (UD-003).
 */
export function AnalysisPanel({ input, onClose }: { input: InputRecord; onClose: () => void }) {
  const t = useT()
  const { has } = useI18n()
  const undo = useUndo()
  const progress = useJobProgress(input.job_id, input.id)
  const reprocess = useReprocess()
  const discard = useDiscard(input)
  const errorText = useErrorText()
  const [confirmAgain, setConfirmAgain] = useState(false)
  const processing = input.status === 'queued' || input.status === 'extracting' || input.status === 'analyzing'
  const failureCode = input.error_code ? `analysis.error.${input.error_code}` : ''
  const failureText = failureCode && has(failureCode) ? t(failureCode as MessageKey) : input.error || t('analysis.failed')
  const percent = Math.round(progress?.percent ?? input.job?.percent ?? 0)
  const edited = undo.undoCount > 0

  /** Analyzing again drops the proposal, with what was edited in it: that is the one step here that cannot be taken back. */
  const again = () => {
    setConfirmAgain(false)
    reprocess.mutate(input.id)
  }

  return (
    // Only a proposal fills the frame; waiting or failing, the surface is as tall as what it says (J1-B-07).
    <section aria-label={t('analysis.title')} className={cn('@container ai-surface flex min-h-0 min-w-0 flex-col gap-3 p-3 pl-4', input.status !== 'proposed' && 'w-full self-start')}>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <div className="flex items-center gap-2">
          <h2>{t('analysis.title')}</h2>
          <AiMark />
        </div>
        <div className="flex items-center gap-1.5">
          {input.status === 'proposed' && (
            <Button size="sm" variant="ghost" className="hit" disabled={reprocess.isPending} onClick={() => (edited ? setConfirmAgain(true) : again())}>
              <RotateCw size={13} aria-hidden /> {t('analysis.again')}
            </Button>
          )}
          <UndoButtons stack={undo} compact />
        </div>
      </div>

      {processing && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span>{progress?.phrase || (STATUS_PHRASE[input.status] ? t(STATUS_PHRASE[input.status]!) : '')}</span>
            {percent > 0 && <span className="tabular-nums text-muted">{percent} %</span>}
          </div>
          <Meter percent={percent} label={t('analysis.progress')} className="h-2.5" />
          <div>
            <Button size="sm" variant="ghost" className="hit" disabled={discard.pending} onClick={() => void discard.run()}>
              {t('analysis.cancel')}
            </Button>
          </div>
        </div>
      )}

      {input.status === 'failed' && (
        <div className="flex flex-col gap-3">
          <div role="alert" className="flex flex-col gap-0.5 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            <p className="font-semibold">{t('analysis.failed')}</p>
            <p>{failureText}.</p>
            <p>{t('analysis.kept')}</p>
          </div>
          {reprocess.isError && (
            <p role="alert" className="text-sm text-danger">
              {errorText(reprocess.error)}
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button variant="primary" disabled={reprocess.isPending} onClick={() => reprocess.mutate(input.id)}>
              <RotateCw size={14} aria-hidden /> {t('common.retry')}
            </Button>
            <Button variant="ghost" className="hit" onClick={() => void discard.run()} disabled={discard.pending}>
              {t('analysis.discard')}
            </Button>
          </div>
        </div>
      )}

      {input.status === 'proposed' && input.proposal && <ProposalEditor key={input.id} input={input} initial={input.proposal} onPublished={onClose} onDiscard={() => void discard.run()} discarding={discard.pending} />}

      <Dialog open={confirmAgain} onOpenChange={setConfirmAgain}>
        <DialogContent title={t('analysis.again')}>
          <div className="flex flex-col gap-4 p-5">
            <p className="text-sm">{t('analysis.againWarning')}</p>
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button variant="ghost">{t('common.cancel')}</Button>
              </DialogClose>
              <Button variant="primary" onClick={again}>
                {t('analysis.again')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}

interface Row {
  m: ProposalMessage
  i: number
}

function ProposalEditor({
  input,
  initial,
  onPublished,
  onDiscard,
  discarding,
}: {
  input: InputRecord
  initial: Proposal
  onPublished: () => void
  onDiscard: () => void
  discarding: boolean
}) {
  const t = useT()
  const { language } = useI18n()
  const errorText = useErrorText()
  const undo = useUndo()
  const notices = useNotices()
  const { memberName } = useLookups()
  const publish = usePublish()
  const waiting = (useTray().data ?? []).filter((i) => i.id !== input.id).length
  const saveProposal = useSaveProposal(input.id)
  const queryClient = useQueryClient()
  const [proposal, setProposal] = useState<Proposal>(initial)
  /** The message that is open: the others are one line each, so all of them are in view at once (J1-B-11). */
  const [openIndex, setOpenIndex] = useState(0)
  const latest = useRef<Proposal>(initial)
  const chain = useRef<Promise<unknown>>(Promise.resolve())
  const [saveError, setSaveError] = useState<unknown>(null)

  /** Puts the proposal on screen and saves it as a draft; saves go out one at a time and in order. */
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

  /** Each change is an operation that can be undone and redone. */
  const change = (label: string, make: (p: Proposal) => Proposal) => {
    const before = latest.current
    const after = make(before)
    return undo.run({ label, redo: () => apply(after), undo: () => apply(before) })
  }

  const patch = (index: number, label: string, fix: Partial<ProposalMessage> | ((m: ProposalMessage) => Partial<ProposalMessage>)) =>
    change(label, (p) => ({ ...p, messages: p.messages.map((m, i) => (i === index ? { ...m, ...(typeof fix === 'function' ? fix(m) : fix) } : m)) }))

  /** Removing a message does not lose its text: its units move to «Sin mensaje», which is what publishing requires. The notice offers the way back. */
  const remove = async (index: number) => {
    const title = latest.current.messages[index]?.title ?? ''
    await change(t('proposal.removed'), (p) => {
      const gone = p.messages[index]
      return {
        ...p,
        messages: p.messages.filter((_, i) => i !== index),
        discarded: gone.unit_ids.length > 0 ? [...(p.discarded ?? []), { unit_ids: gone.unit_ids, reason: t('proposal.removedReason') }] : (p.discarded ?? []),
      }
    })
    setOpenIndex((open) => Math.max(0, Math.min(open > index ? open - 1 : open, latest.current.messages.length - 1)))
    notices.show({ text: t('proposal.removedNotice', { title }), action: { label: t('undo.undo'), run: () => undo.undo() } })
  }

  const rows = useMemo<Row[]>(() => proposal.messages.map((m, i) => ({ m, i })), [proposal])
  const discarded = proposal.discarded ?? []
  const discardedCount = discarded.reduce((n, d) => n + d.unit_ids.length, 0)
  const unitText = (id: number) => input.units?.find((u) => u.id === id)?.text
  const count = proposal.messages.length

  // What is missing per message: computed with each one's template.
  const [missing, setMissing] = useState<Record<number, string[]>>({})
  const missingTotal = Object.values(missing).reduce((n, list) => n + list.length, 0)

  /** «Ana, Beto y Carla»: the people the messages go to, each once. */
  const recipientsText = (messages: ProposalMessage[]) => {
    const names = [...new Set(messages.flatMap((m) => m.assignee_ids))].map(memberName).filter(Boolean)
    if (names.length === 0) return t('publish.nobody')
    const shown = names.slice(0, 3)
    const rest = names.length - shown.length
    return t('publish.to', { names: new Intl.ListFormat(language, { style: 'long', type: 'conjunction' }).format(rest > 0 ? [...shown, t('publish.andMore', { n: rest })] : shown) })
  }

  const send = async () => {
    try {
      await chain.current
    } catch {
      // The save error is already on screen; publishing is attempted anyway with what is on screen.
    }
    const sent = latest.current
    let res
    try {
      // `mutateAsync`: the list refreshes and takes this editor off the screen before callbacks of `mutate` would run.
      res = await publish.mutateAsync({ inputId: input.id, proposal: sent })
    } catch {
      return // the error is on screen through `publish.isError`
    }
    const first = res?.message_ids?.[0]
    const who = recipientsText(sent.messages)
    // The most silent moment of the flow, said out loud: what went out, to whom and where to see it (J1-B-25).
    // When other sends wait, the review moves on by itself: the notice says so, so the change of content is not taken for an error (J1-B-27).
    const said = sent.messages.length === 1 ? t('publish.one', { title: sent.messages[0].title, who }) : t('publish.many', { n: sent.messages.length, who })
    notices.show({
      text: waiting > 0 ? `${said} ${t('publish.next')}` : said,
      link: first ? { to: sent.messages.length === 1 ? `/messages/${first}` : '/messages', label: sent.messages.length === 1 ? t('publish.viewOne') : t('publish.viewMany') } : undefined,
    })
    onPublished()
  }

  useEffect(
    () => () => {
      void queryClient.invalidateQueries({ queryKey: ['inputs', input.id] })
    },
    [queryClient, input.id],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {discardedCount > 0 && (
        <div className="flex items-center justify-end gap-3 text-xs text-muted">
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className="hit inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
                {t('proposal.noAction')} <Badge tone="neutral">{discardedCount}</Badge>
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-96 p-3">
              <p className="mb-2 text-xs font-semibold">{t('proposal.noActionTitle', { n: discardedCount })}</p>
              <ul data-lane="discarded-units" className="scroll-thin flex max-h-72 flex-col gap-2 overflow-y-auto">
                {discarded.map((d, i) => (
                  <li key={i} className="text-sm">
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
        </div>
      )}

      <FitList
        bare
        rows={rows}
        rowKey={(r) => String(r.i)}
        label={t('proposal.list')}
        renderRow={({ m, i }) => (
          <ProposalRow
            message={m}
            index={i}
            total={count}
            open={count === 1 || i === openIndex}
            onOpen={() => setOpenIndex(i)}
            attachments={input.attachments}
            patch={patch}
            remove={remove}
            onMissing={(names) => setMissing((prev) => (prev[i]?.join() === names.join() ? prev : { ...prev, [i]: names }))}
            missingCount={missing[i]?.length ?? 0}
          />
        )}
      />

      {(publish.isError || saveError !== null) && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {errorText(publish.isError ? publish.error : saveError)}
        </p>
      )}

      {/* On a phone the actions stay on screen whatever the length of the list (J1-B-29). */}
      <div data-actions className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 max-md:sticky max-md:bottom-0 max-md:z-10 max-md:-mx-3 max-md:-mb-3 max-md:rounded-b-[10px] max-md:border-t max-md:border-line max-md:bg-surface max-md:px-3 max-md:py-2">
        <Button variant="ghost" className="hit text-muted" onClick={onDiscard} disabled={publish.isPending || discarding}>
          <Trash2 size={14} aria-hidden /> {t('analysis.discard')}
        </Button>
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          {missingTotal > 0 && (
            <span role="status" className="text-xs font-semibold text-danger">
              {t('proposal.missing', { n: missingTotal })}
            </span>
          )}
          <Button variant="primary" onClick={() => void send()} disabled={publish.isPending || count === 0 || missingTotal > 0}>
            {t('proposal.sendN', { n: count })}
          </Button>
        </div>
      </div>
    </div>
  )
}

function ProposalRow({
  message: m,
  index,
  total,
  open,
  onOpen,
  attachments,
  patch,
  remove,
  onMissing,
  missingCount,
}: {
  message: ProposalMessage
  index: number
  total: number
  open: boolean
  onOpen: () => void
  attachments: Attachment[]
  patch: (index: number, label: string, fix: Partial<ProposalMessage> | ((m: ProposalMessage) => Partial<ProposalMessage>)) => Promise<void>
  remove: (index: number) => Promise<void>
  onMissing: (names: string[]) => void
  missingCount: number
}) {
  const t = useT()
  const { areaTitle, memberName } = useLookups()
  const templates = useTemplates(m.area_id)
  const template: Template | undefined = templates.data?.find((x) => x.id === m.template_id) ?? templates.data?.[0]
  const required = (v: string) => (v.trim() ? null : t('common.required'))
  const fieldDefs = useMemo(() => parseTemplateFields(template?.body_markdown ?? ''), [template?.body_markdown])
  const missingNames = missingRequired(m.fields, fieldDefs).join(',')
  useEffect(() => onMissing(missingNames ? missingNames.split(',') : []), [missingNames]) // eslint-disable-line react-hooks/exhaustive-deps
  const only = total === 1

  if (!open) {
    const to = m.assignee_ids.map(memberName).filter(Boolean).join(', ')
    return (
      <li className="list-none border-b border-line last:border-b-0">
        <button type="button" aria-expanded={false} aria-label={t('proposal.open', { n: index + 1, title: m.title })} onClick={onOpen} className="hit flex w-full items-start gap-2 px-1 py-2 text-left hover:bg-hover">
          <ChevronRight size={14} aria-hidden className="mt-0.5 shrink-0 text-muted" />
          <span className="mt-px w-4 shrink-0 text-xs font-semibold tabular-nums text-muted">{index + 1}</span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="break-words text-sm font-semibold">{m.title}</span>
            <span className="break-words text-xs text-muted">{[areaTitle(m.area_id), to ? t('proposal.to', { names: to }) : t('proposal.noRecipients')].join(' · ')}</span>
          </span>
          {missingCount > 0 && <Badge tone="danger">{t('proposal.missingShort')}</Badge>}
        </button>
      </li>
    )
  }

  return (
    <li className="flex list-none flex-col gap-2 border-b border-line px-1 py-3 last:border-b-0">
      <div className="flex flex-wrap items-start gap-x-2 gap-y-1.5">
        {!only && (
          <span className="flex shrink-0 items-center gap-1 self-center text-xs font-semibold tabular-nums text-muted">
            <ChevronDown size={14} aria-hidden />
            {index + 1}
          </span>
        )}
        <AreaPicker
          areaId={m.area_id}
          templateName={template?.name}
          onChange={(area_id, next) =>
            patch(index, t('proposal.areaChanged'), (cur) => ({
              area_id,
              template_id: next?.id ?? null,
              // The previous template's fields do not apply to the new one: those with the same name are kept.
              fields: remapFields(cur.fields, parseTemplateFields(next?.body_markdown ?? '')),
            }))
          }
        />
        {(templates.data?.length ?? 0) > 1 && template && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label={t('template.pick', { name: template.name })} className="hit inline-flex max-w-full items-center gap-1 rounded-md px-1.5 text-left text-xs font-semibold text-muted hover:bg-hover hover:text-accent">
                {template.name}
                <ChevronDown size={12} aria-hidden className="shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" collisionPadding={8}>
              <DropdownMenuRadioGroup
                value={template.id}
                onValueChange={(id) => {
                  const next = templates.data?.find((x) => x.id === id)
                  if (next) void patch(index, t('proposal.templateChanged'), (cur) => ({ template_id: next.id, fields: remapFields(cur.fields, parseTemplateFields(next.body_markdown ?? '')) }))
                }}
              >
                {templates.data?.map((x) => (
                  <DropdownMenuRadioItem key={x.id} value={x.id}>
                    {x.name}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <EditableText value={m.title} label={t('proposal.title')} validate={required} onSave={(v) => patch(index, t('proposal.titleEdited'), { title: v })} displayClassName="text-sm font-semibold" className="min-w-0 flex-1 basis-40" />
        {/* The only message cannot be removed: Descartar is the way out, so the button is not drawn instead of drawn off. */}
        {!only && (
          <Button size="sm" variant="ghost" className="hit shrink-0 text-muted" onClick={() => void remove(index)} aria-label={t('proposal.remove', { title: m.title })}>
            <Trash2 size={13} aria-hidden /> {t('proposal.removeShort')}
          </Button>
        )}
      </div>
      <EditableText value={m.body} label={t('proposal.body')} multiline prose validate={required} onSave={(v) => patch(index, t('proposal.bodyEdited'), { body: v })} displayClassName="text-read text-fg" className="py-1" />
      <TemplateFields template={template} values={m.fields} onSave={(name, value) => patch(index, t('proposal.fieldEdited'), (cur) => ({ fields: { ...(cur.fields ?? {}), [name]: value } }))} />
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
        <RecipientsEditor ids={m.assignee_ids} onChange={(ids) => void patch(index, t('proposal.recipientsChanged'), { assignee_ids: ids })} />
        <AttachmentPicker all={attachments} selected={m.attachment_ids} onChange={(ids) => void patch(index, t('proposal.attachmentsChanged'), { attachment_ids: ids })} />
      </div>
    </li>
  )
}
