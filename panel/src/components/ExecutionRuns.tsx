import { useId, useState } from 'react'
import { ChevronRight } from '@/components/icons'
import { NativeSelect } from '@/components/NativeSelect'
import { useErrorText, useFormat, useT, type MessageKey } from '@/i18n'
import { PHASE_KEYS, type RunPhase } from '@team-platform/client'
import { useExecuteRunsSummary } from '@team-platform/client/react'
import { cn } from '@/lib/utils'

const PERIODS = [
  { days: 7, key: 'runs.last7' },
  { days: 30, key: 'runs.last30' },
  { days: 90, key: 'runs.last90' },
  { days: 0, key: 'runs.all' },
] as const
const SLOWEST_SHOWN = 5
const LABELS: Record<RunPhase, MessageKey> = {
  queue_wait_ms: 'timing.wait',
  first_reply_ms: 'timing.firstReply',
  final_reply_ms: 'timing.finalReply',
  total_ms: 'timing.total',
  create_ms: 'timing.phase.create',
  run_ms: 'timing.phase.run',
  destroy_ms: 'timing.phase.destroy',
  tools_ms: 'runs.tools',
  judge_ms: 'runs.judge',
  delivery_ms: 'runs.deliveryTime',
  wait_ms: 'runs.waiting',
}
const percent = (rate: number | null) => (rate === null ? '—' : `${Math.round(rate * 100)} %`)

/** «Ejecuciones» of the Cola (UD-262, Editor): folded; the figures of GET /ops/execute-runs/summary load when it opens. */
export function ExecutionRuns() {
  const t = useT()
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <div data-execution-runs className="flex flex-col gap-2">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)} className="flex min-h-8 pointer-coarse:min-h-11 items-center gap-2 self-start text-left text-sm hover:text-accent">
        <ChevronRight size={16} aria-hidden className={cn('shrink-0 text-muted transition-transform', open && 'rotate-90 text-accent')} />
        <span>{t('runs.title')}</span>
      </button>
      {open && (
        <div id={id}>
          <RunsBody />
        </div>
      )}
    </div>
  )
}

function RunsBody() {
  const t = useT()
  const { duration, usd } = useFormat()
  const errorText = useErrorText()
  const [days, setDays] = useState<number>(30)
  const summary = useExecuteRunsSummary(days)
  const d = summary.data
  const figures: [string, string][] = d
    ? [
        [t('runs.count'), String(d.runs)],
        [t('runs.failed'), String(d.failed)],
        [t('runs.costAvg'), d.cost.avg_usd === null ? '—' : usd(d.cost.avg_usd)],
        [t('runs.costTotal'), usd(d.cost.total_usd)],
        [t('runs.delivery'), percent(d.delivery.rate)],
        [t('runs.resolved'), percent(d.resolved.rate)],
      ]
    : []
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="w-40">
        <NativeSelect aria-label={t('runs.period')} value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {PERIODS.map((p) => (
            <option key={p.days} value={p.days}>
              {t(p.key)}
            </option>
          ))}
        </NativeSelect>
      </div>
      {summary.isPending && <p className="text-muted">…</p>}
      {summary.isError && <p className="break-words text-danger">{errorText(summary.error)}</p>}
      {d && d.runs === 0 && <p className="text-muted">{t('queue.noExecutions')}</p>}
      {d && d.runs > 0 && (
        <>
          <dl className="flex flex-wrap gap-x-5 gap-y-0.5">
            {figures.map(([label, value]) => (
              <div key={label} className="flex items-baseline gap-1.5">
                <dt className="text-muted">{label}</dt>
                <dd data-runs-figure={label} className="tabular-nums">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          <table className="w-full max-w-xl border-collapse text-left tabular-nums" aria-label={t('runs.phases')}>
            <thead>
              <tr>
                <th className="rotulo h-8 pr-4 text-left">{t('runs.phase')}</th>
                <th className="rotulo h-8 pr-4 text-right">{t('runs.avg')}</th>
                <th className="rotulo h-8 pr-4 text-right">p50</th>
                <th className="rotulo h-8 text-right">p95</th>
              </tr>
            </thead>
            <tbody>
              {PHASE_KEYS.filter((k) => d.phases[k].n > 0).map((k) => (
                <tr key={k} data-runs-phase={k} className="border-t border-line">
                  <td className="h-12 pr-4">{t(LABELS[k])}</td>
                  <td className="h-12 pr-4 text-right">{duration(d.phases[k].avg ?? 0)}</td>
                  <td className="h-12 pr-4 text-right">{duration(d.phases[k].p50 ?? 0)}</td>
                  <td className="h-12 text-right">{duration(d.phases[k].p95 ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {d.slowest_tools.length > 0 && (
            <ol aria-label={t('timing.slowest')} className="flex flex-col gap-0.5">
              {d.slowest_tools.slice(0, SLOWEST_SHOWN).map((s, i) => (
                <li key={i} data-runs-slow className="flex flex-wrap items-baseline gap-x-3">
                  <span className={s.success === false ? 'text-danger' : ''}>{s.summary ?? s.name}</span>
                  <span className="tabular-nums text-muted">{duration(s.duration_ms)}</span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  )
}
