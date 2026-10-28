import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronRight, Clock, Ring, X } from '@/components/icons'
import { MediaOpener } from '@/components/MediaOpener'
import { Meter } from '@/components/Meter'
import { useFormat, useT, type MessageKey } from '@/i18n'
import { cn } from '@/lib/utils'
import type { StepState } from '@/lib/work-steps'
import type { Attachment, SessionStep } from '@team-platform/client'
import { useSessionSteps } from '@team-platform/client/react'

export function Mark({ state }: { state: StepState }) {
  if (state === 'done') return <Check size={16} aria-hidden className="shrink-0 text-accent" />
  if (state === 'failed') return <X size={16} aria-hidden className="shrink-0 text-danger" />
  if (state === 'running') return <Clock size={16} aria-hidden className="shrink-0 text-accent" />
  // A stretch not started yet: an empty circle, a shape of its own, so it reads apart from the running one without its color (UD-041: no word).
  return <Ring size={16} aria-hidden className="shrink-0 text-faint" />
}

/** The five columns of a stretch (DISENO.md, «Trabajo de un agente»): mark, name, bar, control to unfold and time. The control is wider for a coarse pointer. */
export const WORK_COLUMNS = 'grid-cols-[16px_6rem_minmax(2rem,1fr)_28px_4.5rem] pointer-coarse:grid-cols-[16px_6rem_minmax(2rem,1fr)_44px_4.5rem]'

/**
 * One stretch of the work of an agent, in ONE line: mark, name, thin bar, the control that unfolds what the stretch has to say, and the time at the right edge.
 * What it unfolds (`panel`) is drawn only while it is open and starts closed, so the box measures the same with or without it. What a stretch adds under its name
 * (`under`: the word of a failure, what the retry does) never moves the time.
 */
export function WorkRow({ stepKey, state, label, time, percent, waiting, progressLabel, toggleLabel, panel, under, className }: {
  stepKey: string
  state: StepState
  label: string
  time: string
  /** Advance of the stretch that runs (0 = it travels); the others draw their own state. */
  percent?: number
  /** The stretch runs but is held (the host has no capacity): its bar stands still and empty, it does not advance. */
  waiting?: boolean
  progressLabel: string
  /** The name of the control; without it the stretch has nothing to unfold. */
  toggleLabel?: string
  panel?: ReactNode
  under?: ReactNode
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const bar =
    state === 'running' && !waiting ? <Meter thin percent={percent ?? 0} label={progressLabel} className="self-center" /> : <Meter thin decorative still danger={state === "failed"} percent={state === "pending" || waiting ? 0 : 100} label={progressLabel} className="self-center" />
  return (
    <li data-work-step={stepKey} data-state={state} className={cn('grid min-h-8 items-center gap-x-2 gap-y-0.5 py-0.5', WORK_COLUMNS, className)}>
      <Mark state={state} />
      <span className={cn('min-w-0 break-words', state === 'pending' && 'text-muted')}>{label}</span>
      {bar}
      {toggleLabel ? (
        <button type="button" data-work-toggle={stepKey} aria-expanded={open} aria-controls={panelId} aria-label={toggleLabel} title={toggleLabel} onClick={() => setOpen((v) => !v)} className="inline-flex size-7 items-center justify-center justify-self-center rounded-md text-muted hover:bg-hover pointer-coarse:size-11">
          <ChevronRight size={16} aria-hidden className={cn('transition-transform', open && 'rotate-90 text-accent')} />
        </button>
      ) : (
        <span aria-hidden />
      )}
      <span data-work-time className="text-right tabular-nums text-muted">{time}</span>
      {under}
      {open && panel && (
        <div id={panelId} data-work-panel={stepKey} className="col-start-2 col-end-[-1] pt-1">
          {panel}
        </div>
      )}
    </li>
  )
}

/** A path or a command that wraps after its separators, so a long one breaks between segments and not in the middle of a word (J3-B-20). */
function breakable(text: string) {
  return text.split(/(?<=[/\\?&=#])/).map((part, i) => (
    <Fragment key={i}>
      {i > 0 && <wbr />}
      <span>{part}</span>
    </Fragment>
  ))
}

const ACTION_KEY: Record<SessionStep['action'], MessageKey> = {
  read: 'work.step.read',
  edit: 'work.step.edit',
  command: 'work.step.command',
  search: 'work.step.search',
  subagent: 'work.step.subagent',
  web: 'work.step.web',
  plan: 'work.step.plan',
  capture: 'work.step.capture',
  other: 'work.step.other',
}

/**
 * The calls the session made to its tools, in order, with the time, what each one did in plain words and, muted under it, the technical name of the tool and its detail
 * (file, command, pattern). A screenshot says what it shows from the moment the session takes it and offers its file once the thread holds it. `live` marks the last call as
 * the one in progress while it has not returned, and keeps the lane at its end as new calls arrive. The list is a lane with a scroll of its own (DISENO.md, «Cada vista
 * cabe en una pantalla»): a session makes hundreds of calls and none is cut or paged.
 */
export function SessionStepList({ messageId, live }: { messageId: string; live: boolean }) {
  const t = useT()
  const format = useFormat()
  const history = useSessionSteps(messageId)
  const lane = useRef<HTMLOListElement>(null)
  const pinned = useRef(true)
  // Which edges of the lane have more steps beyond them: they fade, so a lane that scrolls reads as one even where the scrollbar is overlaid and thin.
  const [edges, setEdges] = useState({ top: false, bottom: false })
  const measure = () => {
    const el = lane.current
    if (el) setEdges({ top: el.scrollTop > 4, bottom: el.scrollHeight - el.scrollTop - el.clientHeight > 4 })
  }
  const steps = history.data?.steps ?? []
  useEffect(() => {
    const el = lane.current
    if (live && el && pinned.current) el.scrollTop = el.scrollHeight
    measure()
  }, [steps.length, live])
  if (history.isPending) return <p className="m-0 text-sm text-muted">…</p>
  if (steps.length === 0) return <p className="m-0 text-sm text-muted">{t('work.steps.none')}</p>
  return (
    <div className="flex flex-col gap-1">
      <p data-step-count className="m-0 text-xs tabular-nums text-muted">{t('work.steps.count', { n: steps.length })}</p>
      {/* The lane of the steps: a session makes hundreds of calls, so the list scrolls inside its own box and never pushes the sheet (data-lane, DISENO.md «Cada vista cabe en una pantalla»). */}
      <ol
        ref={lane}
        data-lane="session-steps"
        aria-label={t('work.history')}
        onScroll={(e) => {
          const el = e.currentTarget
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
          measure()
        }}
        style={{ maskImage: `linear-gradient(to bottom, ${edges.top ? 'transparent 0, #000 1.25rem' : '#000 0'}, ${edges.bottom ? '#000 calc(100% - 1.25rem), transparent 100%' : '#000 100%'})` }}
        className="scroll-thin m-0 flex max-h-[min(16rem,40dvh)] list-none flex-col overflow-y-auto p-0"
      >
        {steps.map((s, i) => {
          const current = live && i === steps.length - 1 && s.ended_at === null
          return <StepItem key={s.id} step={s} current={current} when={format.clockSeconds(new Date(s.at))} />
        })}
      </ol>
      {history.data?.capped && <p className="m-0 text-xs text-muted">{t('work.steps.capped', { n: history.data.max_steps })}</p>}
    </div>
  )
}

function StepItem({ step: s, current, when }: { step: SessionStep; current: boolean; when: string }) {
  const t = useT()
  const file = s.capture?.attachment
  return (
    <li data-step-action={s.action} data-step-current={current ? '' : undefined} aria-current={current ? 'step' : undefined} className="grid grid-cols-[4rem_16px_minmax(0,1fr)_auto] items-start gap-x-2 py-1">
      <time dateTime={s.at} className="pt-0.5 text-xs tabular-nums text-muted">{when}</time>
      {s.failed ? <X size={16} aria-label={t('timing.state.failed')} className="mt-0.5 text-danger" /> : current ? <Clock size={16} aria-label={t('timing.state.running')} className="mt-0.5 text-accent" /> : <span aria-hidden />}
      <div className="min-w-0">
        <span className={cn('block text-sm', current && 'font-semibold')}>{t(ACTION_KEY[s.action])}</span>
        <span className="block text-xs text-muted [overflow-wrap:break-word]">
          <span data-step-tool>{s.tool}</span>
          {s.capture ? ` ${s.capture.alt}` : s.detail ? <>{' '}<span className="font-mono">{breakable(s.detail)}</span></> : null}
        </span>
      </div>
      {file ? <MediaOpener attachments={[{ id: file.id, kind: file.kind as Attachment['kind'], mime: file.mime, size: file.size, name: file.name }]} scope="reply" px={36} /> : <span aria-hidden />}
    </li>
  )
}
