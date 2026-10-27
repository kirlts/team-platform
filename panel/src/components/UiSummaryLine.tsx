import { useT } from '@/i18n'
import { useUiSummary } from '@team-platform/client/react'

/** One line of figures under the switch of «Telemetría de uso» (UD-251); drawn only while the switch is on. */
export function UiSummaryLine({ enabled }: { enabled: boolean }) {
  const t = useT()
  const summary = useUiSummary(enabled).data
  if (!enabled || !summary) return null
  const visits = Object.values(summary.screens ?? {}).reduce((n, s) => n + s.visits, 0)
  const tasks = Object.values(summary.tasks ?? {})
  const started = tasks.reduce((n, x) => n + x.started, 0)
  const abandoned = tasks.reduce((n, x) => n + (x.abandoned ?? 0), 0)
  const errors = summary.errors?.total ?? 0
  if (visits + started + errors === 0) return <p data-ui-summary className="text-sm text-muted">{t('summary.empty')}</p>
  // Each figure is a cell of a grid that fills its row evenly: a count of five that does not fit wraps in equal rows, never leaves one figure alone on a second line.
  const figures: [string, string][] = [
    [t('summary.period'), t('summary.days', { n: summary.days })],
    [t('summary.visits'), String(visits)],
    [t('summary.tasks'), String(started)],
    [t('summary.errors'), String(errors)],
    [t('summary.abandon'), started === 0 ? '—' : `${Math.round((abandoned / started) * 100)} %`],
  ]
  return (
    <dl data-ui-summary aria-label={t('summary.label')} className="grid grid-cols-[repeat(auto-fit,minmax(3.5rem,1fr))] gap-x-3 gap-y-2">
      {figures.map(([label, value]) => (
        <div key={label} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-xs text-muted">{label}</dt>
          <dd className="text-sm tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
