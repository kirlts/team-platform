import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { LoadState } from '@/components/LoadState'
import { DeleteSend } from '@/components/DeleteSend'
import { ExecutionRuns } from '@/components/ExecutionRuns'
import { RotateCw } from '@/components/icons'
import { NativeSelect } from '@/components/NativeSelect'
import { PageControls } from '@/components/PageControls'
import { TraceTree } from '@/components/TraceTree'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { useErrorText, useFormat, useT, type MessageKey } from '@/i18n'
import { useNotices } from '@/lib/notices'
import { invalidate, JOB_STATES, type PurgeState, type QueueInput } from '@team-platform/client'
import { useJobCounts, usePurgeJobs, useQueueInputs, useReprocess, useRunningExecutions } from '@team-platform/client/react'

const PAGE_SIZE = 8
const PURGE_STATES: PurgeState[] = ['done', 'failed', 'cancelled']
const REPROCESSABLE = new Set(['published', 'proposed', 'failed', 'cancelled'])
const SETTLED = new Set(['proposed', 'published', 'failed'])

/**
 * «Cola» of Configuración (UD-251, Editor): the sends of everybody with their state, the count of jobs by state with the
 * purge of the finished ones, and on every send «Reprocesar», «Borrar» and «Traza». Nothing destructive asks for a
 * confirmation (UD-253): one click does it and the figure says what went.
 */
export function QueuePanel() {
  const t = useT()
  const [page, setPage] = useState(1)
  const list = useQueueInputs(page, PAGE_SIZE)
  const rows = list.data?.items ?? []
  return (
    <section data-queue className="flex flex-col gap-3 border-t border-line-strong pt-3">
      <h2>{t('queue.title')}</h2>
      <JobCounts />
      <RunningExecutions />
      <ExecutionRuns />
      <div className="flex flex-col gap-2">
        {/* «Sin envíos» only when the queue answered empty: a failed or pending read draws its own state. */}
        {!list.data ? (
          <LoadState query={list} />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted">{t('queue.empty')}</p>
        ) : (
          <>
            <div aria-hidden className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_5rem_minmax(0,2.2fr)] gap-x-4 border-b border-line pb-1 text-xs text-muted md:grid">
              <span>{t('queue.sender')}</span>
              <span>{t('queue.state')}</span>
              <span>{t('queue.when')}</span>
              <span>{t('queue.seconds')}</span>
              <span />
            </div>
            <ul aria-label={t('queue.list')} className="flex flex-col">
              {rows.map((input) => (
                <QueueRow key={input.id} input={input} />
              ))}
            </ul>
          </>
        )}
        <PageControls page={page} limit={PAGE_SIZE} total={list.data?.total ?? 0} onPage={setPage} />
      </div>
    </section>
  )
}

/** The `execute` jobs running now: the message, the step they are in and how long they have been going (UD-262). */
function RunningExecutions() {
  const t = useT()
  const { duration } = useFormat()
  const running = useRunningExecutions().data ?? []
  if (running.length === 0) return null
  return (
    <ul aria-label={t('queue.executions')} data-running-executions className="flex flex-col gap-0.5 text-sm">
      {running.map((j) => (
        <li key={j.id} data-running-execution={j.id} className="flex flex-wrap items-baseline gap-x-4">
          {j.message_id ? (
            <Link to={`/messages/${j.message_id}`} className="underline-offset-2 hover:underline">
              {t('queue.executionMessage', { id: j.message_id })}
            </Link>
          ) : (
            <span>{j.id}</span>
          )}
          <span data-execution-phase>{j.phase ? t(`timing.phase.${j.phase}` as MessageKey) : t('timing.running')}</span>
          <span data-execution-elapsed className="tabular-nums text-muted">
            {duration(Math.max(0, Date.now() - Date.parse(j.run_at)))}
          </span>
        </li>
      ))}
    </ul>
  )
}

function JobCounts() {
  const t = useT()
  const errorText = useErrorText()
  const counts = useJobCounts().data
  const purge = usePurgeJobs()
  const [state, setState] = useState<PurgeState>('done')
  const [purged, setPurged] = useState<number | null>(null)
  const run = async () => {
    setPurged(null)
    const r = await purge.mutateAsync(state)
    setPurged(r.purged)
  }
  return (
    <div className="flex flex-col gap-2">
      <dl aria-label={t('queue.jobs')} data-job-counts className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {JOB_STATES.map((s) => (
          <div key={s} className="flex items-baseline gap-1.5">
            <dt className="text-muted">{t(`queue.job.${s}` as MessageKey)}</dt>
            <dd data-job-count={s} className="tabular-nums">
              {counts?.[s] ?? 0}
            </dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-40">
          <NativeSelect aria-label={t('queue.purgeState')} value={state} disabled={purge.isPending} onChange={(e) => setState(e.target.value as PurgeState)}>
            {PURGE_STATES.map((s) => (
              <option key={s} value={s}>
                {t(`queue.job.${s}` as MessageKey)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button size="sm" className="hover:border-[var(--control-hover-edge)] hover:text-danger" onClick={() => void run().catch(() => undefined)} disabled={purge.isPending}>
          {t('queue.purge')}
        </Button>
        {purged !== null && (
          <span role="status" data-purged className="text-sm tabular-nums text-muted">
            {t('queue.purged', { n: purged })}
          </span>
        )}
      </div>
      <div role="alert">{purge.isError && <p className="break-words text-sm text-danger">{errorText(purge.error)}</p>}</div>
    </div>
  )
}

function QueueRow({ input }: { input: QueueInput }) {
  const t = useT()
  const format = useFormat()
  const errorText = useErrorText()
  const notices = useNotices()
  const qc = useQueryClient()
  const reprocess = useReprocess()
  const [tracing, setTracing] = useState(false)
  const seconds = SETTLED.has(input.status) && input.updated_at ? Math.max(0, (Date.parse(input.updated_at) - Date.parse(input.created_at)) / 1000) : null
  const refresh = () => invalidate(qc, 'purgeJobs')
  const run = async () => {
    try {
      const done = await reprocess.mutateAsync(input.id)
      if (done.set_aside) notices.show({ text: t('send.reprocessed', { n: done.set_aside.messages }), link: { to: '/messages?f=deleted:eq:si', label: t('restore.messages') } })
      await refresh()
    } catch (err) {
      notices.show({ tone: 'danger', text: errorText(err) })
    }
  }
  return (
    <li data-queue-row={input.id} className="flex flex-col gap-1.5 border-b border-line py-2 last:border-b-0">
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-sm md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_5rem_minmax(0,2.2fr)] md:items-center">
        <span className="min-w-0 break-words font-medium">{input.author_name ?? '—'}</span>
        <span data-queue-state>{t(`queue.status.${input.status}` as MessageKey)}</span>
        <span className="tabular-nums text-muted">{format.stamp(input.created_at)}</span>
        <span className="tabular-nums text-muted">{seconds === null ? t('queue.none') : t('queue.secondsValue', { n: Math.round(seconds * 10) / 10 })}</span>
        <span className="col-span-2 flex flex-wrap items-center gap-1 md:col-span-1 md:justify-end">
          <Button size="sm" variant="ghost" className="hit" disabled={!REPROCESSABLE.has(input.status) || reprocess.isPending} onClick={() => void run()}>
            <RotateCw size={13} aria-hidden /> {t('queue.reprocess')}
          </Button>
          <DeleteSend input={input} onDeleted={() => void refresh()} />
          <Button size="sm" variant="ghost" className="hit" aria-expanded={tracing} disabled={!input.job_id} onClick={() => setTracing((v) => !v)}>
            {t('queue.trace')}
          </Button>
        </span>
      </div>
      {tracing && input.job_id && <TraceTree jobId={input.job_id} />}
    </li>
  )
}
