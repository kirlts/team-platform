import { Fold } from '@/components/Fold'
import { useLookups } from '@/components/lookups'
import { SpanTree } from '@/components/TraceTree'
import { TeamApiError } from '@team-platform/client'
import { useErrorText, useT, type MessageKey } from '@/i18n'
import { useMessageTiming } from '@team-platform/client/react'

const SLOWEST_SHOWN = 5

export const seconds = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : ms < 60000 ? `${Math.round(ms / 100) / 10} s` : `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`)

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
    </div>
  )
}

function TimingBody({ messageId }: { messageId: string }) {
  const t = useT()
  const errorText = useErrorText()
  const timing = useMessageTiming(messageId)
  if (timing.isPending) return <p className="text-sm text-muted">…</p>
  if (timing.isError) {
    const none = timing.error instanceof TeamApiError && timing.error.status === 404
    return <p className={none ? 'text-sm text-muted' : 'break-words text-sm text-danger'}>{none ? t('timing.none') : errorText(timing.error)}</p>
  }
  const d = timing.data
  const figures: [string, string][] = [
    [t('timing.firstReply'), d.first_reply_ms === null ? '—' : seconds(d.first_reply_ms)],
    [t('timing.finalReply'), d.final_reply_ms === null ? '—' : seconds(d.final_reply_ms)],
    [t('timing.total'), d.total_ms === null ? '—' : seconds(d.total_ms)],
    [t('timing.wait'), d.queue_wait_ms === null ? '—' : seconds(d.queue_wait_ms)],
  ]
  return (
    <div className="flex flex-col gap-3 text-sm">
      <dl className="flex flex-wrap gap-x-5 gap-y-0.5">
        {figures.map(([label, value]) => (
          <div key={label} className="flex items-baseline gap-1.5">
            <dt className="text-muted">{label}</dt>
            <dd data-timing-figure={label} className="tabular-nums">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {d.job_status === 'running' && (
        <p data-timing-running className="tabular-nums text-muted">
          {d.phase ? t(`timing.phase.${d.phase}` as MessageKey) : t('timing.running')}
          {d.elapsed_ms !== null && ` · ${seconds(d.elapsed_ms)}`}
        </p>
      )}
      {d.phases.length > 0 && (
        <ul aria-label={t('timing.phases')} className="flex flex-wrap gap-x-5 gap-y-0.5">
          {d.phases.map((p) => (
            <li key={p.name} data-timing-phase={p.name} className="flex items-baseline gap-1.5">
              <span className="text-muted">{t(`timing.phase.${p.name}` as MessageKey)}</span>
              <span className="tabular-nums">{seconds(p.duration_ms)}</span>
            </li>
          ))}
        </ul>
      )}
      {d.slowest.length > 0 && (
        <ol aria-label={t('timing.slowest')} className="flex flex-col gap-0.5">
          {d.slowest.slice(0, SLOWEST_SHOWN).map((s, i) => (
            <li key={i} data-timing-slow className="flex flex-wrap items-baseline gap-x-3">
              <span className={s.success === false ? 'text-danger' : ''}>{s.summary ?? s.name}</span>
              <span className="tabular-nums text-muted">{seconds(s.duration_ms)}</span>
            </li>
          ))}
        </ol>
      )}
      {d.tree && <SpanTree roots={[d.tree]} label={t('trace.tree')} />}
    </div>
  )
}

/** «Detalle técnico» (UD-273): what the agent returned besides its summary (result, zone, cause, verification, branch, files) and the reference of its delivery. The reply of the thread does not carry it. */
function DetailBody({ messageId }: { messageId: string }) {
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
