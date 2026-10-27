import { Check, Clock, Ring, X } from '@/components/icons'
import { useLookups } from '@/components/lookups'
import { Meter } from '@/components/Meter'
import { RetryButton } from '@/components/RetryExecute'
import { useFormat, useT, type MessageKey } from '@/i18n'
import { cn } from '@/lib/utils'
import { workSteps, type StepKey, type StepState } from '@/lib/work-steps'
import type { MessageDetail } from '@team-platform/client'
import { useJobProgress, useMessageTiming, useRetryExecute } from '@team-platform/client/react'

const STEP_LABEL: Record<StepKey, MessageKey> = { machine: 'work.machine', session: 'work.session', deliver: 'work.deliver' }
// A stretch that has not started has no word (UD-041 retired «pendiente»): its empty mark and the muted name already say it.
const STATE_LABEL: Record<Exclude<StepState, 'pending'>, MessageKey> = { done: 'timing.state.done', running: 'timing.state.running', failed: 'timing.state.failed' }

function Mark({ state }: { state: StepState }) {
  if (state === 'done') return <Check size={16} aria-hidden className="shrink-0 text-accent" />
  if (state === 'failed') return <X size={16} aria-hidden className="shrink-0 text-danger" />
  if (state === 'running') return <Clock size={16} aria-hidden className="shrink-0 text-accent" />
  // A stretch not started yet: an empty circle, a shape of its own, so it reads apart from the running one without its color (UD-041: no word).
  return <Ring size={16} aria-hidden className="shrink-0 text-faint" />
}

/**
 * The work of an agent on a message, by stretch (machine, session, delivery), while it is waiting, running or failed: each stretch with its state and
 * its time, the one running with the bar of its job under it, and, when a notice of the thread offers «Reintentar», which stretches the retry repeats (said per row only when it leaves some as they are: «Reintentar trabajo» already says it repeats all); on a phone,
 * where the thread is below the first screen, the same button is also here, next to what it repeats. Once the
 * work ends the stretches are one more figure of «Detalles»; nothing is drawn for a message no agent works.
 */
export function AgentWork({ message }: { message: MessageDetail }) {
  const { members } = useLookups()
  const attended = message.assignee_ids.some((id) => members.find((m) => m.id === id)?.kind === 'agent')
  return attended ? <Work message={message} /> : null
}

function Work({ message }: { message: MessageDetail }) {
  const t = useT()
  const { duration } = useFormat()
  const timing = useMessageTiming(message.id)
  const retryRun = useRetryExecute(message.id)
  const d = timing.data
  const live = d?.deliver && (d.deliver.job_status === 'queued' || d.deliver.job_status === 'running') ? d.deliver.job_id : d?.job_id
  const progress = useJobProgress(live, undefined)
  if (!d) return null
  const failure = message.status === 'closed' ? undefined : message.replies.filter((r) => r.retryable && r.retry_action).at(-1)
  const work = workSteps(d, failure?.retry_action ?? null)
  if (work.state === 'done') return null
  return (
    <section data-testid="agent-work" data-work={work.state} aria-label={t('work.title')} className="glass leaf flex shrink-0 flex-col gap-2 p-3">
      <h2 className="rotulo m-0">{t('work.title')}</h2>
      <ol className="m-0 flex list-none flex-col p-0">
        {work.steps.map((s, i) => (
          // Three columns, always the same: the mark, the name and the time at the right edge. What a stretch adds (the word of a failure, what the retry does) goes under its name, so the time never moves.
          <li key={s.key} data-work-step={s.key} data-state={s.state} className="grid min-h-8 grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 py-0.5">
            <Mark state={s.state} />
            <span className={cn('min-w-0 break-words', s.state === 'pending' && 'text-muted')}>{t(STEP_LABEL[s.key])}</span>
            <span className="text-right tabular-nums text-muted">{s.ms !== null && s.state !== 'pending' ? duration(s.ms) : s.state === 'failed' ? '' : work.state === 'queued' && i === 0 ? t('timing.state.queued') : s.state === 'pending' ? '' : t(STATE_LABEL[s.state])}</span>
            {(s.state === 'failed' || (work.partial && s.repeats !== null)) && (
              <span className="col-start-2 col-end-4 flex flex-wrap gap-x-3 text-xs text-muted">
                {s.state === 'failed' && <span data-work-failed className="text-danger">{t('timing.state.failed')}</span>}
                {work.partial && s.repeats !== null && <span data-work-repeats={String(s.repeats)}>{t(s.repeats ? 'work.repeats' : 'work.kept')}</span>}
              </span>
            )}
            {s.state === 'running' && work.state === 'running' && (
              <div className="col-start-2 col-end-4 flex flex-col gap-1 pt-1">
                <Meter percent={progress?.percent ?? 0} label={t('timing.state.running')} />
                {progress?.phrase && <p role="status" className="m-0 text-xs text-muted">{progress.phrase}</p>}
              </div>
            )}
          </li>
        ))}
      </ol>
      {failure && <RetryButton reply={failure} retry={retryRun} testId="work-retry" className="md:hidden" />}
    </section>
  )
}
