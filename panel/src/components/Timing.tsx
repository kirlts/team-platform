import { Fold } from '@/components/Fold'
import { useLookups } from '@/components/lookups'
import { SpanTree } from '@/components/TraceTree'
import { EXECUTE_MODELS, TeamApiError, type MessageTiming } from '@team-platform/client'
import { FailedMark } from '@/components/FailedMark'
import { X } from '@/components/icons'
import { useErrorText, useFormat, useI18n, useT, type MessageKey } from '@/i18n'
import { useMessageTiming } from '@team-platform/client/react'

const SLOWEST_SHOWN = 5

/** «Tiempos» of the sheet of a message worked by an agent (UD-262): folded; the figures load when it opens. */
export function Timing({ messageId, assigneeIds }: { messageId: string; assigneeIds: string[] }) {
  const t = useT()
  const { members } = useLookups()
  const attended = assigneeIds.some((id) => members.find((m) => m.id === id)?.kind === 'agent')
  if (!attended) return null
  return (
    <div data-timing className="flex flex-col gap-3">
      <Fold title={t('timing.title')} className="shrink-0">
        <TimingBody messageId={messageId} />
      </Fold>
      <Fold title={t('timing.detail')} className="shrink-0">
        <DetailBody messageId={messageId} />
      </Fold>
      <Fold title={t('judgment.title')} className="shrink-0">
        <JudgmentBody messageId={messageId} />
      </Fold>
    </div>
  )
}

const STATES = ['queued', 'running', 'done', 'failed']

/** Whether the times of a message have anything to show: a figure, a run in progress, phases, slow steps or the tree. */
export function hasTiming(d: MessageTiming | undefined): boolean {
  if (!d) return false
  return STATES.includes(d.job_status) || [d.first_reply_ms, d.final_reply_ms, d.total_ms, d.queue_wait_ms].some((v) => v !== null) || !!d.model || typeof d.cost_usd === 'number' || d.job_status === 'running' || d.phases.length > 0 || d.slowest.length > 0 || !!d.tree
}

export function TimingBody({ messageId }: { messageId: string }) {
  const t = useT()
  const { duration, usd } = useFormat()
  const errorText = useErrorText()
  const timing = useMessageTiming(messageId)
  if (timing.isPending) return <p className="text-sm text-muted">…</p>
  if (timing.isError) {
    const none = timing.error instanceof TeamApiError && timing.error.status === 404
    return <p className={none ? 'text-sm text-muted' : 'break-words text-sm text-danger'}>{none ? t('timing.none') : errorText(timing.error)}</p>
  }
  const d = timing.data
  // Only the figures that exist: a dash is a placeholder, and «Detalles» shows what has data.
  const figures = ([
    [t('timing.firstReply'), d.first_reply_ms === null ? null : duration(d.first_reply_ms)],
    [t('timing.finalReply'), d.final_reply_ms === null ? null : duration(d.final_reply_ms)],
    [t('timing.total'), d.total_ms === null ? null : duration(d.total_ms)],
    [t('timing.wait'), d.queue_wait_ms === null ? null : duration(d.queue_wait_ms)],
    // UD-295: the model of the session and what it has cost.
    [t('timing.model'), d.model ? (EXECUTE_MODELS.find((m) => m.id === d.model)?.label ?? d.model) : null],
    [t('timing.cost'), typeof d.cost_usd === 'number' ? usd(d.cost_usd) : null],
    [t('timing.state'), STATES.includes(d.job_status) ? t(`timing.state.${d.job_status}` as MessageKey) : null],
  ] as [string, string | null][]).filter((f): f is [string, string] => f[1] !== null)
  return (
    <div className="flex flex-col gap-3 text-sm">
      {figures.length > 0 && <dl className="flex flex-wrap gap-x-5 gap-y-0.5">
        {figures.map(([label, value]) => (
          <div key={label} className="flex items-baseline gap-1.5">
            <dt className="text-muted">{label}</dt>
            <dd data-timing-figure={label} className="tabular-nums">
              {value}
            </dd>
          </div>
        ))}
      </dl>}
      {d.job_status === 'running' && (
        // The same shape as every other figure: the name, then the time.
        <p data-timing-running className="m-0 flex items-baseline gap-1.5">
          <span className="text-muted">{d.phase ? t(`timing.phase.${d.phase}` as MessageKey) : t('timing.running')}</span>
          {d.elapsed_ms !== null && <span className="tabular-nums">{duration(d.elapsed_ms)}</span>}
        </p>
      )}
      {d.phases.length > 0 && (
        <ul aria-label={t('timing.phases')} className="flex flex-wrap gap-x-5 gap-y-0.5">
          {d.phases.map((p) => (
            <li key={p.name} data-timing-phase={p.name} className="flex items-baseline gap-1.5">
              <span className="text-muted">{t(`timing.phase.${p.name}` as MessageKey)}</span>
              <span className="tabular-nums">{duration(p.duration_ms)}</span>
            </li>
          ))}
        </ul>
      )}
      {/* With the tree the slowest steps are in it, in their place: the list stands alone only when the spans are gone and the run row kept the slowest tools (UD-262). */}
      {d.slowest.length > 0 && !d.tree && (
        <ol aria-label={t('timing.slowest')} className="flex flex-col gap-0.5">
          {d.slowest.slice(0, SLOWEST_SHOWN).map((s, i) => (
            <li key={i} data-timing-slow className="flex flex-wrap items-baseline gap-x-3">
              <span className={s.success === false ? 'text-danger' : ''}>{s.summary ?? s.name}</span>
              <span className="tabular-nums text-muted">{duration(s.duration_ms)}</span>
              {s.success === false && <FailedMark />}
            </li>
          ))}
        </ol>
      )}
      {d.tree && <SpanTree roots={[d.tree]} label={t('trace.tree')} />}
    </div>
  )
}

/** «Detalle técnico» (UD-276): what the agent returned besides its summary (result, zone, cause, verification, branch, files) and the reference of its delivery. The reply of the thread does not carry it. */
export function DetailBody({ messageId }: { messageId: string }) {
  const t = useT()
  const errorText = useErrorText()
  const timing = useMessageTiming(messageId)
  if (timing.isPending) return <p className="text-sm text-muted">…</p>
  if (timing.isError) return <p className="break-words text-sm text-danger">{errorText(timing.error)}</p>
  const detail = timing.data.detail
  const rows = [...(detail?.entries ?? []), ...(detail?.delivery_ref ? [{ label: t('timing.detail.delivery'), value: detail.delivery_ref }] : [])]
  if (rows.length === 0) return <p className="text-sm text-muted">{t('timing.detail.none')}</p>
  return (
    <dl data-timing-detail className="flex flex-col gap-2 text-sm">
      {rows.map((row, i) => (
        <div key={`${row.label}-${i}`} className="flex flex-col gap-0.5">
          <dt className="text-muted">{row.label}</dt>
          <dd className="m-0 whitespace-pre-wrap break-words">{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * «Adecuación» (UD-295): the judgement of the finished job, by a cheap model: the four axes with their score against the target of the task, and the twelve KPI that could be observed,
 * each with the quote that supports it. It answers how adequate what the model did was, which is what says whether the light model was enough.
 */
export function JudgmentBody({ messageId }: { messageId: string }) {
  const t = useT()
  const { has } = useI18n()
  const { decimal } = useFormat()
  const errorText = useErrorText()
  const timing = useMessageTiming(messageId)
  if (timing.isPending) return <p className="text-sm text-muted">…</p>
  if (timing.isError) return <p className="break-words text-sm text-danger">{errorText(timing.error)}</p>
  const j = timing.data.judgment
  if (!j) return <p className="text-sm text-muted">{t('judgment.none')}</p>
  // The sign is part of the figure of an indicator: «+1», «0», «−1». The scale of both lists is said once, above them.
  const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0')
  return (
    <div data-testid="judgment" className="flex flex-col gap-3 text-sm">
      <p className="m-0 text-muted">{EXECUTE_MODELS.find((m) => m.id === j.worked_with)?.label ?? j.worked_with ?? ''}{j.calibrated === true ? '' : ` · ${t('judgment.uncalibrated')}`}</p>
      <div className="flex flex-col gap-1">
        <p data-testid="judgment-scale" className="m-0 text-xs text-muted">{t('judgment.scale')}</p>
        <ul aria-label={t('judgment.axes')} className="m-0 flex list-none flex-col gap-1 p-0">
          {j.axes.map((a) => (
            <li key={a.axis} data-testid="judgment-axis" data-meets={a.meets === null ? undefined : String(a.meets)} className="flex flex-wrap items-baseline gap-x-3">
              <span className="min-w-0 flex-1">{t(`judgment.axis.${a.axis}` as MessageKey)}</span>
              <span className="tabular-nums">{a.score === null ? '—' : decimal(a.score, 1)}</span>
              <span className="tabular-nums text-muted">{t('judgment.target', { n: a.target })}</span>
              <span className={a.meets === false ? 'inline-flex items-center gap-1 text-danger' : 'text-muted'}>
                {a.meets === false && <X size={14} aria-hidden className="shrink-0" />}
                {a.meets === null ? '' : t(a.meets ? 'judgment.meets' : 'judgment.misses')}
              </span>
            </li>
          ))}
        </ul>
      </div>
      {j.summary && <p className="m-0 break-words">{j.summary}</p>}
      <ol aria-label={t('judgment.kpis')} className="m-0 flex list-none flex-col gap-2 p-0">
        {j.kpis.filter((k) => k.applies).map((k) => (
          <li key={k.id} data-testid="judgment-kpi" className="flex flex-col gap-0.5">
            <span className="flex flex-wrap items-baseline gap-x-3">
              <span className="min-w-0 flex-1 font-medium">{has(`judgment.kpi.${k.id}`) ? t(`judgment.kpi.${k.id}` as MessageKey) : k.id}</span>
              <span className="tabular-nums">{signed(k.score)}</span>
            </span>
            <span className="break-words">{k.claim}</span>
            {k.quote && <span className="break-words text-muted">«{k.quote}»</span>}
          </li>
        ))}
      </ol>
    </div>
  )
}
