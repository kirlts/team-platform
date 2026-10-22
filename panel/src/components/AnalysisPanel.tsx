import { ChevronDown, Plus, RotateCw, Trash2, X } from '@/components/icons'
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
import { sendPercent } from '@/lib/progress'
import { progressText } from '@/lib/progress-text'
import { useCancelInput, usePublish, useReprocess, useRestoreInput, useSaveProposal, useTemplates, useTray } from '@/lib/queries'
import { firstWords } from '@/lib/first-words'
import { missingRequired, parseTemplateFields, remapFields } from '@/lib/template'
import type { Attachment, InputRecord, InputStatus, Proposal, ProposalMessage, Template } from '@/lib/types'
import { useUndo } from '@/lib/undo'
import { cn } from '@/lib/utils'
import { AiMark } from './AiMark'
import { useAreaStyle } from './AreaChip'
import { SimulatedMark } from './SimulatedMark'
import { AreaPicker } from './AreaPicker'
import { AttachmentPicker } from './AttachmentPicker'
import { MessageFoldRow, MessageTally } from './MessageFold'
import { EditableText } from './EditableText'
import { useLookups } from './lookups'
import { Meter } from './Meter'
import { RecipientsEditor } from './RecipientsEditor'
import { TemplateFields } from './TemplateFields'
import { DeleteSend } from './DeleteSend'
import { UndoButtons } from './UndoButtons'

const STATUS_PHRASE: Partial<Record<InputStatus, MessageKey>> = {
  queued: 'analysis.queued',
  extracting: 'analysis.extracting',
  analyzing: 'analysis.analyzing',
}

/** Discards a send and says so where the person is looking, with the way back (J1-B-26): nothing is lost by one wrong click. */
function useDiscard(input: InputRecord, onDiscarded?: (restore: () => Promise<unknown>) => boolean) {
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
      // The window keeps the place of the discarded send with its own Deshacer, so the detail does not jump to another send (J2-B-22).
      if (onDiscarded?.(() => restore.mutateAsync(input.id))) return
      // The page is not told the send is gone for good (it would hide it for the session): the list simply stops holding it, and Deshacer brings it back.
      notices.show({ text: t('discard.done'), action: { label: t('undo.undo'), run: () => restore.mutateAsync(input.id) } })
    },
  }
}

/**
 * «Análisis» block: progress over SSE while the job runs and, when it finishes, the editable
 * proposal. Nothing reaches the team until the sender presses Enviar (UD-003).
 */
export function AnalysisPanel({ input, onClose, onDiscarded, onDeleted }: { input: InputRecord; onClose: () => void; onDiscarded?: (restore: () => Promise<unknown>) => boolean; onDeleted?: (id: string) => void }) {
  const t = useT()
  const { has } = useI18n()
  const undo = useUndo()
  const progress = useJobProgress(input.job_id, input.id)
  const reprocess = useReprocess()
  const discard = useDiscard(input, onDiscarded)
  const errorText = useErrorText()
  const [confirmAgain, setConfirmAgain] = useState(false)
  /** The area of the message in view: the whole box of the analysis wears its color (UD-045) and changes with it. */
  const [activeArea, setActiveArea] = useState<string | undefined>(input.proposal?.messages[0]?.area_id)
  const areaStyle = useAreaStyle(activeArea)
  const tinted = input.status === 'proposed' && !!activeArea
  const processing = input.status === 'queued' || input.status === 'extracting' || input.status === 'analyzing'
  const failureCode = input.error_code ? `analysis.error.${input.error_code}` : ''
  const failureText = failureCode && has(failureCode) ? t(failureCode as MessageKey) : input.error || t('analysis.failed')
  const percent = sendPercent(input, progress)
  // What can be redone is also work the new analysis would take: asking is skipped only when the history is empty on both sides (J3-B-05).
  const edited = undo.undoCount > 0 || undo.redoCount > 0

  /** Analyzing again drops the proposal, with what was edited in it: that is the one step here that cannot be taken back. */
  const again = () => {
    setConfirmAgain(false)
    // The old proposal is gone: its history would restore edits of a proposal that no longer exists (J3-B-05).
    undo.clear()
    reprocess.mutate(input.id)
  }

  return (
    // Only a proposal fills the frame; waiting or failing, the surface is as tall as what it says (J1-B-07).
    <section
      aria-label={t('analysis.title')}
      data-testid="analysis-box"
      data-ui-stage={input.status === 'proposed' ? 'analysis' : undefined}
      data-area-id={tinted ? activeArea : undefined}
      style={tinted ? areaStyle : undefined}
      className={cn('@container flex min-h-0 min-w-0 flex-col gap-3 p-3 pl-4', tinted ? 'area-tint area-box' : 'ai-surface', input.status === 'proposed' ? 'flex-1' : 'w-full self-start')}
    >
      {/* «Volver a analizar» keeps the right edge of the first row whatever the history has: the left group wraps inside its own space and never pushes it down (J2-B-14). */}
      <div className="flex min-h-8 items-start justify-between gap-x-2 gap-y-1">
        <div className="flex min-h-8 min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          <div className="flex items-center gap-2">
            <h2>{t('analysis.title')}</h2>
            <AiMark />
            <SimulatedMark proposal={input.proposal} />
          </div>
          {/* The history beside the title and «Volver a analizar» alone at the right edge: the step that drops the proposal is not one of the pair that takes a step back (J3-B-27); neither moves the other (J2-B-15). */}
          {input.status === 'proposed' && <UndoButtons stack={undo} />}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {input.status === 'proposed' && (
            <Button size="sm" variant="ghost" className="hit" disabled={reprocess.isPending} onClick={() => (edited ? setConfirmAgain(true) : again())}>
              <RotateCw size={13} aria-hidden /> {t('analysis.again')}
            </Button>
          )}
          {/* Deleting is not discarding: nothing comes back, and one click does it (UD-240, UD-253). */}
          <DeleteSend input={input} onDeleted={onDeleted} />
        </div>
      </div>

      {processing && (
        <div data-ui-stage="progress" className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span>{progress?.phrase || progress?.code ? progressText(progress, t) : STATUS_PHRASE[input.status] ? t(STATUS_PHRASE[input.status]!) : ''}</span>
            {percent > 0 && <span className="tabular-nums text-muted">{percent} %</span>}
          </div>
          <Meter percent={percent} label={t('analysis.progress')} className="h-2.5" />
          <div>
            <Button size="sm" variant="secondary" className="hit" disabled={discard.pending} onClick={() => void discard.run()}>
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
            {/* What reassures is not an error: it goes in the ink of the text (J3-B-29). */}
            <p className="text-fg">{t('analysis.kept')}</p>
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
            <Button variant="secondary" className="hit" onClick={() => void discard.run()} disabled={discard.pending}>
              {t('analysis.discard')}
            </Button>
          </div>
        </div>
      )}

      {input.status === 'proposed' && input.proposal && <ProposalEditor key={input.id} input={input} initial={input.proposal} onActiveArea={setActiveArea} onPublished={onClose} onDiscard={() => void discard.run()} discarding={discard.pending} />}

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
  onActiveArea,
  onPublished,
  onDiscard,
  discarding,
}: {
  input: InputRecord
  initial: Proposal
  onActiveArea: (areaId: string | undefined) => void
  onPublished: () => void
  onDiscard: () => void
  discarding: boolean
}) {
  const t = useT()
  const errorText = useErrorText()
  const undo = useUndo()
  const notices = useNotices()
  const { memberName, areas } = useLookups()
  const publish = usePublish()
  const waiting = (useTray().data ?? []).filter((i) => i.id !== input.id).length
  const saveProposal = useSaveProposal(input.id)
  const queryClient = useQueryClient()
  const [proposal, setProposal] = useState<Proposal>(initial)
  /** The message that is open, or none (-1, the start): every other is one line, so the list reads at a glance (J1-B-11, UD-257). */
  const [openIndex, setOpenIndex] = useState(-1)
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
    setOpenIndex((open) => (open === index ? -1 : open > index ? open - 1 : open))
    // The way back is the history above (one mechanism, J2-B-21): the notice only says what happened.
    notices.show({ text: t('proposal.removedNotice', { title }) })
  }

  const unitText = (id: number) => input.units?.find((u) => u.id === id)?.text

  /**
   * A part the analysis left without a message becomes one (J3-B-09), one part at a time: its text is the body, its first words the title (the person
   * edits it right there), the area is the one of the first message or, with none, the first of the catalog. Nobody is assigned and
   * the template is the area's own: the person fills those in. The units leave «Partes sin mensaje» and go with the new message.
   */
  const createFrom = async (at: number, unitId: number) => {
    const part = latest.current.discarded?.[at]
    if (!part) return
    const text = unitText(unitId) ?? ''
    const area_id = latest.current.messages[0]?.area_id ?? areas[0]?.id
    if (!area_id) return
    // The new message opens at once, not after the draft is saved.
    setOpenIndex(latest.current.messages.length)
    await change(t('proposal.created'), (p) => ({
      ...p,
      messages: [...p.messages, { area_id, template_id: null, title: firstWords(text, 8), body: text, fields: null, assignee_ids: [], attachment_ids: [], unit_ids: [unitId] }],
      discarded: (p.discarded ?? []).flatMap((d, i) => (i !== at ? [d] : d.unit_ids.length > 1 ? [{ ...d, unit_ids: d.unit_ids.filter((u) => u !== unitId) }] : [])),
    }))
  }

  const rows = useMemo<Row[]>(() => proposal.messages.map((m, i) => ({ m, i })), [proposal])
  // The box of the analysis takes the area of the message that is open, and changing that message's area changes the box.
  const activeId = proposal.messages[openIndex]?.area_id ?? proposal.messages[0]?.area_id
  useEffect(() => onActiveArea(activeId), [activeId]) // eslint-disable-line react-hooks/exhaustive-deps
  const discarded = proposal.discarded ?? []
  const discardedCount = discarded.reduce((n, d) => n + d.unit_ids.length, 0)
  const count = proposal.messages.length

  // What is missing per message: computed with each one's template.
  const [missing, setMissing] = useState<Record<number, string[]>>({})
  const missingTotal = Object.values(missing).reduce((n, list) => n + list.length, 0)

  /** «Ana, Beto y Carla»: the people the messages go to, each once. */
  const recipientsText = (messages: ProposalMessage[]) => {
    const names = [...new Set(messages.flatMap((m) => m.assignee_ids))].map(memberName).filter(Boolean)
    if (names.length === 0) return t('publish.nobody')
    // One person by name, several by count: the notice stays one line however many people the messages go to (J2-B-25).
    return t('publish.to', { names: names.length === 1 ? names[0] : t('publish.people', { n: names.length }) })
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
      text: waiting > 0 ? `${said}; ${t('publish.next')}` : said,
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
      {/* The system did not publish this proposal by itself (UD-070): the reason is said, and publishing by hand is the way on. */}
      {input.error_code === 'publish_blocked' && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          <span className="font-semibold">{t('analysis.error.publish_blocked')}</span> {input.error}
        </p>
      )}
      {/* The messages of the proposal are read whole: a text has no maximum length, so the list is as tall as it is and the page scrolls (UD-110); no frame cuts the open message. */}
      <MessageTally areaIds={proposal.messages.map((m) => m.area_id)} />
      <ul aria-label={t('proposal.list')} className="flex flex-1 flex-col">
        {rows.map(({ m, i }) => (
          <ProposalRow
            key={i}
            message={m}
            index={i}
            total={count}
            open={i === openIndex}
            onToggle={() => setOpenIndex((open) => (open === i ? -1 : i))}
            attachments={input.attachments}
            patch={patch}
            remove={remove}
            onMissing={(names) => setMissing((prev) => (prev[i]?.join() === names.join() ? prev : { ...prev, [i]: names }))}
            missingCount={missing[i]?.length ?? 0}
          />
        ))}
      </ul>

      {(publish.isError || saveError !== null) && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {errorText(publish.isError ? publish.error : saveError)}
        </p>
      )}

      {/* On a phone the actions stay on screen whatever the length of the list (J1-B-29). */}
      <div data-actions className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 max-md:sticky max-md:bottom-0 max-md:z-10 max-md:-mx-3 max-md:-mb-3 max-md:rounded-b-[10px] max-md:border-t max-md:border-line max-md:bg-surface max-md:px-3 max-md:py-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Button variant="ghost" className="hit text-danger" onClick={onDiscard} disabled={publish.isPending || discarding}>
            <Trash2 size={14} aria-hidden /> {t('analysis.discard')}
          </Button>
          {discardedCount > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <Button size="sm" variant="secondary" className="hit">
                  {t('proposal.noAction')} <Badge tone="neutral">{discardedCount}</Badge>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-96 p-3">
                <p className="mb-2 text-xs font-semibold">{t('proposal.noActionTitle', { n: discardedCount })}</p>
                <ul data-lane="discarded-units" className="scroll-thin flex max-h-72 flex-col overflow-y-auto">
                  {discarded.map((d, i) => (
                    <li key={i} className="flex flex-col items-start gap-1.5 border-b border-line py-2 text-sm first:pt-0 last:border-b-0 last:pb-0">
                      <p className="text-xs text-muted">{d.reason}</p>
                      {d.unit_ids.map((id) => (
                        <div key={id} className="flex w-full flex-col items-start gap-1.5 border-t border-line pt-2 first:border-t-0 first:pt-0">
                          <p className="whitespace-pre-wrap">{unitText(id) ?? id}</p>
                          <Button size="sm" variant="secondary" className="hit" onClick={() => void createFrom(i, id)}>
                            <Plus size={13} aria-hidden /> {t('proposal.create')}
                          </Button>
                        </div>
                      ))}
                    </li>
                  ))}
                </ul>
              </PopoverContent>
            </Popover>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          {missingTotal > 0 && (
            <span role="status" className="text-xs font-semibold text-danger">
              {t('proposal.missing', { n: missingTotal })}
            </span>
          )}
          <Button variant="primary" data-testid="proposal-send" onClick={() => void send()} disabled={publish.isPending || count === 0 || missingTotal > 0}>
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
  onToggle,
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
  onToggle: () => void
  attachments: Attachment[]
  patch: (index: number, label: string, fix: Partial<ProposalMessage> | ((m: ProposalMessage) => Partial<ProposalMessage>)) => Promise<void>
  remove: (index: number) => Promise<void>
  onMissing: (names: string[]) => void
  missingCount: number
}) {
  const t = useT()
  const templates = useTemplates(m.area_id)
  const template: Template | undefined = templates.data?.find((x) => x.id === m.template_id) ?? templates.data?.[0]
  const required = (v: string) => (v.trim() ? null : t('common.required'))
  const fieldDefs = useMemo(() => parseTemplateFields(template?.body_markdown ?? ''), [template?.body_markdown])
  const missingNames = missingRequired(m.fields, fieldDefs).join(',')
  useEffect(() => onMissing(missingNames ? missingNames.split(',') : []), [missingNames]) // eslint-disable-line react-hooks/exhaustive-deps
  const only = total === 1

  // Folded by default (UD-257): the row says the area, the title in one line and who it is for; opened, everything that is edited here.
  return (
    <MessageFoldRow index={index} areaId={m.area_id} title={m.title} assigneeIds={m.assignee_ids} open={open} onToggle={onToggle} aside={missingCount > 0 ? <Badge tone="danger">{t('proposal.missingShort')}</Badge> : undefined}>
      <div className="flex flex-wrap items-start gap-x-2 gap-y-1.5 px-0.5">
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
        <EditableText value={m.title} label={t('proposal.title')} validate={required} onSave={(v) => patch(index, t('proposal.titleEdited'), { title: v })} displayClassName="text-read font-bold" className="min-w-0 flex-1 basis-40" />
        {/* The only message cannot be removed: Descartar is the way out, so the button is not drawn instead of drawn off. */}
        {!only && (
          <Button size="sm" variant="ghost" className="hit shrink-0 text-muted" onClick={() => void remove(index)} aria-label={t('proposal.remove', { title: m.title })}>
            <X size={13} aria-hidden /> {t('proposal.removeShort')}
          </Button>
        )}
      </div>
      <EditableText value={m.body} label={t('proposal.body')} multiline prose validate={required} onSave={(v) => patch(index, t('proposal.bodyEdited'), { body: v })} displayClassName="text-read text-fg" className="py-1" />
      <TemplateFields boxed={false} template={template} values={m.fields} onSave={(name, value) => patch(index, t('proposal.fieldEdited'), (cur) => ({ fields: { ...(cur.fields ?? {}), [name]: value } }))} />
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
        <RecipientsEditor ids={m.assignee_ids} onChange={(ids) => void patch(index, t('proposal.recipientsChanged'), { assignee_ids: ids })} />
        <AttachmentPicker all={attachments} selected={m.attachment_ids} onChange={(ids) => void patch(index, t('proposal.attachmentsChanged'), { attachment_ids: ids })} />
      </div>
    </MessageFoldRow>
  )
}
