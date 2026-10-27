import type { MessageTiming } from '@team-platform/client'

/** The three stretches of the work of an agent on a message, in the order they run. */
export type StepKey = 'machine' | 'session' | 'deliver'
export type StepState = 'done' | 'running' | 'pending' | 'failed'
export type WorkState = 'queued' | 'running' | 'failed' | 'done'

export interface WorkStep {
  key: StepKey
  state: StepState
  /** Time spent in the stretch, in ms: the figure of a finished one, the elapsed time of the one running. */
  ms: number | null
  /** What «Reintentar» does with the stretch: `true` runs it again, `false` keeps what exists. `null` when nothing can be retried. */
  repeats: boolean | null
}

const ORDER: StepKey[] = ['machine', 'session', 'deliver']

/** The stretch a phase code of the job belongs to: copying the transcript and destroying the machine close the session. */
export function stepOfPhase(phase: string | null | undefined): StepKey | null {
  if (!phase) return null
  if (phase === 'create') return 'machine'
  if (phase === 'run' || phase === 'collect' || phase === 'destroy') return 'session'
  if (phase === 'deliver' || phase.startsWith('deliver')) return 'deliver'
  return null
}

/**
 * The state of the work of the agent on a message, by stretch (machine, session, delivery), read from the timing of the API. Nothing is decided
 * here: the job status and the phase are the server's; this only orders them. `retry` is the `retry_action` of the retryable notice of the thread:
 * `publish` repeats only the delivery, `work` repeats every stretch.
 */
export function workSteps(d: MessageTiming, retry: 'publish' | 'work' | null = null): { state: WorkState; steps: WorkStep[] } {
  const deliverFailed = d.deliver?.job_status === 'failed'
  const failed = d.job_status === 'failed' || deliverFailed
  const state: WorkState = failed ? 'failed' : d.job_status === 'queued' ? 'queued' : d.job_status === 'running' ? 'running' : 'done'
  const current = state === 'running' ? stepOfPhase(d.phase) : null

  const spent: Partial<Record<StepKey, number>> = {}
  const errored = new Set<StepKey>()
  const seen = new Set<StepKey>()
  for (const p of d.phases) {
    const key = stepOfPhase(p.name)
    if (!key) continue
    seen.add(key)
    spent[key] = (spent[key] ?? 0) + (p.duration_ms ?? 0)
    if (p.status === 'error') errored.add(key)
  }
  if (current) seen.add(current)
  if (d.deliver) seen.add('deliver')
  seen.add('session')
  // A retry that only publishes shows the delivery it will run even when the failed job never reached one.
  if (failed && retry === 'publish') seen.add('deliver')

  const present = ORDER.filter((k) => seen.has(k))
  // The stretch where it stopped: the one marked with an error, or the last one that has time; a delivery that failed is the delivery.
  let stopped: StepKey | null = null
  if (state === 'failed') {
    stopped = deliverFailed ? 'deliver' : (present.find((k) => errored.has(k)) ?? [...present].reverse().find((k) => spent[k] !== undefined) ?? present[0] ?? null)
  }
  const at = (k: StepKey | null) => (k ? present.indexOf(k) : -1)

  const steps = present.map<WorkStep>((key, i) => {
    let s: StepState
    if (state === 'queued') s = 'pending'
    else if (state === 'done') s = 'done'
    else if (state === 'running') s = current ? (i < at(current) ? 'done' : i === at(current) ? 'running' : 'pending') : i === 0 ? 'running' : 'pending'
    else s = i < at(stopped) ? 'done' : i === at(stopped) ? 'failed' : 'pending'
    const ms = s === 'running' && key === (current ?? present[0]) && d.elapsed_ms !== null ? d.elapsed_ms : (spent[key] ?? null)
    const repeats = state !== 'failed' || !retry ? null : retry === 'work' ? true : key === 'deliver'
    return { key, state: s, ms, repeats }
  })
  return { state, steps }
}
