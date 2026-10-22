import { useT } from '@/i18n'
import { useUiSummary } from '@/lib/queries'

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
  const figures: [string, string][] = [
    [t('summary.visits'), String(visits)],
    [t('summary.tasks'), String(started)],
    [t('summary.errors'), String(errors)],
    [t('summary.abandon'), started === 0 ? '—' : `${Math.round((abandoned / started) * 100)} %`],
    [t('summary.days', { n: summary.days }), ''],
  ]
  return (
    <dl data-ui-summary aria-label={t('summary.label')} className="flex flex-wrap gap-x-5 gap-y-0.5 text-sm">
      {figures.map(([label, value]) =>
        value === '' ? (
          <div key={label} className="text-muted">{label}</div>
        ) : (
          <div key={label} className="flex items-baseline gap-1.5">
            <dt className="text-muted">{label}</dt>
            <dd className="tabular-nums">{value}</dd>
          </div>
        ),
      )}
    </dl>
  )
}
