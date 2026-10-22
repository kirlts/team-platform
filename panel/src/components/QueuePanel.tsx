import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { DeleteSend } from '@/components/DeleteSend'
import { RotateCw } from '@/components/icons'
import { NativeSelect } from '@/components/NativeSelect'
import { PageControls } from '@/components/PageControls'
import { SettingHint } from '@/components/SettingHint'
import { TraceTree } from '@/components/TraceTree'
import { Button } from '@/components/ui/button'
import { useErrorText, useFormat, useT, type MessageKey } from '@/i18n'
import { useNotices } from '@/lib/notices'
import { JOB_STATES, useJobCounts, usePurgeJobs, useQueueInputs, useReprocess, type PurgeState, type QueueInput } from '@/lib/queries'

const PAGE_SIZE = 8
const PURGE_STATES: PurgeState[] = ['done', 'failed', 'cancelled']
const REPROCESSABLE = new Set(['proposed', 'failed', 'cancelled'])
const SETTLED = new Set(['proposed', 'published', 'failed'])

/**
 * «Cola» of Configuración (UD-251, Editor): the sends of everybody with their state, the count of jobs by state with the
 * purge of the finished ones, and on every send «Reprocesar», «Borrar» and «Traza». Every destructive step confirms in
 * its place, with no window over the page.
 */
export function QueuePanel() {
  const t = useT()
  const [page, setPage] = useState(1)
  const list = useQueueInputs(page, PAGE_SIZE)
  const rows = list.data?.items ?? []
  return (
    <section data-queue className="flex flex-col gap-3 border-t border-line-strong pt-3">
      <div className="flex flex-col gap-0.5">
        <h2>{t('queue.title')}</h2>
        <SettingHint id="hint-queue">{t('hint.queue')}</SettingHint>
      </div>
      <JobCounts />
      <div aria-describedby="hint-queue" className="flex flex-col gap-2">
        {rows.length === 0 ? (
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

function JobCounts() {
  const t = useT()
  const errorText = useErrorText()
  const counts = useJobCounts().data
  const purge = usePurgeJobs()
  const [state, setState] = useState<PurgeState>('done')
  const [arming, setArming] = useState(false)
  const [purged, setPurged] = useState<number | null>(null)
  const run = async () => {
    const r = await purge.mutateAsync(state)
    setPurged(r.purged)
    setArming(false)
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
          <NativeSelect aria-label={t('queue.purgeState')} value={state} disabled={arming || purge.isPending} onChange={(e) => setState(e.target.value as PurgeState)}>
            {PURGE_STATES.map((s) => (
              <option key={s} value={s}>
                {t(`queue.job.${s}` as MessageKey)}
              </option>
            ))}
          </NativeSelect>
        </div>
        {arming ? (
          <>
            <Button size="sm" variant="danger" onClick={() => void run().catch(() => undefined)} disabled={purge.isPending}>
              {t('queue.purge')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setArming(false)} disabled={purge.isPending}>
              {t('common.cancel')}
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            onClick={() => {
              setArming(true)
              setPurged(null)
              purge.reset()
            }}
          >
            {t('queue.purge')}
          </Button>
        )}
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
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['jobs'] }), qc.invalidateQueries({ queryKey: ['audit'] })])
  const run = async () => {
    try {
      await reprocess.mutateAsync(input.id)
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
