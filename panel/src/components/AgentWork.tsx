import { useLookups } from '@/components/lookups'
import { RetryButton } from '@/components/RetryExecute'
import { SessionStepList, WorkRow } from '@/components/WorkRow'
import { useFormat, useT, type MessageKey } from '@/i18n'
import { workSteps, type StepKey } from '@/lib/work-steps'
import type { MessageDetail } from '@team-platform/client'
import { useJobProgress, useMessageTiming, useRetryExecute } from '@team-platform/client/react'

const STEP_LABEL: Record<StepKey, MessageKey> = { machine: 'work.machine', session: 'work.session', deliver: 'work.deliver' }
// A stretch that has not started has no word (UD-041 retired «pendiente»): its empty mark and the muted name already say it.
const STATE_LABEL = { done: 'timing.state.done', running: 'timing.state.running', failed: 'timing.state.failed' } as const

/**
 * The work of an agent on a message, by stretch (machine, session, delivery), while it is waiting, running or failed: each stretch in ONE line (mark, name, thin bar, the control that unfolds
 * its detail, time), with its state and, when a notice of the thread offers «Reintentar», which stretches the retry repeats (said per row only when it leaves some as they are: «Reintentar trabajo»
 * already says it repeats all). Session unfolds the history of the calls it made; Publicación, its detailed state. Both are closed until someone opens them, so the box does not grow.
 * On a phone, where the thread is below the first screen, the same button is also here, next to what it repeats. Once the work ends the history is in «Detalles» › «Tiempos»;
 * nothing is drawn for a message no agent works.
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
  // The detailed state of the delivery: what the job says it is doing now («Entrega: verificación», «En espera…»), else the phase it is in.
  const deliverPhase = d.deliver?.phase ?? (d.phase && d.phase.startsWith('deliver') ? d.phase : null)
  const deliverText = progress?.phrase || (deliverPhase ? t(`timing.phase.${deliverPhase}` as MessageKey) : '')
  // The host answered «not now» (exit 75): the delivery waits and tries again. The row says it in the time column, its bar stands still, and the detail says why and when.
  const holding = (d.deliver?.job_status === 'queued' || progress?.code === 'deliverWait') && !progress?.done
  const waitDetail = progress?.code === 'deliverWait' ? [t('work.waiting.cause'), t('work.waiting.retry', { seconds: progress.vars?.seconds ?? 30 })].join('. ') : deliverText
  return (
    <section data-testid="agent-work" data-work={work.state} aria-label={t('work.title')} className="glass leaf flex shrink-0 flex-col gap-2 p-3">
      <h2 className="rotulo m-0">{t('work.title')}</h2>
      <ol className="m-0 flex list-none flex-col p-0">
        {work.steps.map((s, i) => {
          const running = s.state === 'running' && work.state === 'running'
          const waiting = holding && s.key === 'deliver' && running
          const time = waiting ? t('work.waiting') : s.ms !== null && s.state !== 'pending' ? duration(s.ms) : s.state === 'failed' ? '' : work.state === 'queued' && i === 0 ? t('timing.state.queued') : s.state === 'pending' ? '' : t(STATE_LABEL[s.state])
          const unfolds = s.key === 'session' ? s.state !== 'pending' : s.key === 'deliver' ? (s.state === 'running' || s.state === 'failed') && deliverText !== '' : false
          return (
            <WorkRow
              key={s.key}
              stepKey={s.key}
              state={s.state}
              label={t(STEP_LABEL[s.key])}
              time={time}
              waiting={waiting}
              percent={running ? (progress?.percent ?? 0) : undefined}
              progressLabel={t('timing.state.running')}
              toggleLabel={unfolds ? t(s.key === 'session' ? 'work.history' : 'work.status') : undefined}
              panel={s.key === 'session' ? <SessionStepList messageId={message.id} live={running} /> : s.key === 'deliver' ? <p role="status" data-work-status className="m-0 break-words text-sm">{waitDetail}</p> : undefined}
              under={
                (s.state === 'failed' || (work.partial && s.repeats !== null)) && (
                  <span className="col-start-2 col-end-[-1] flex flex-wrap gap-x-3 text-xs text-muted">
                    {s.state === 'failed' && <span data-work-failed className="text-danger">{t('timing.state.failed')}</span>}
                    {work.partial && s.repeats !== null && <span data-work-repeats={String(s.repeats)}>{t(s.repeats ? 'work.repeats' : 'work.kept')}</span>}
                  </span>
                )
              }
            />
          )
        })}
      </ol>
      {failure && <RetryButton reply={failure} retry={retryRun} testId="work-retry" className="md:hidden" />}
    </section>
  )
}
