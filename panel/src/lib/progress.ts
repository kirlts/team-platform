import type { InputRecord, JobProgress } from '@team-platform/client'

/**
 * The percentage a send shows. Only a job that has started reports one: a send still in the queue has not done any
 * step, so whatever figure the record carries is not progress (it read «18 %» under «En cola»: J2-B-09). With 0 the
 * bar is indeterminate.
 */
export function sendPercent(input: Pick<InputRecord, 'status' | 'job'>, live?: Pick<JobProgress, 'percent'>): number {
  if (input.status === 'queued') return 0
  return Math.round(live?.percent ?? input.job?.percent ?? 0)
}
