import { useId, useState, type ReactNode } from 'react'
import { AddConnection } from '@/components/AddConnection'
import { ConnectionStatusMark } from '@/components/ConnectionStatusMark'
import { LoadState } from '@/components/LoadState'
import { EmptyState } from '@/components/EmptyState'
import { causeKey, FailureLine, ProviderCheck } from '@/components/ProviderCheck'
import { ProviderKeyForm } from '@/components/ProviderKeyForm'
import { ProviderRemoval, useProviderRemoval, type RemovalMode } from '@/components/ProviderRemoval'
import { Button } from '@/components/ui/button'
import { useFormat, useT, type MessageKey } from '@/i18n'
import { useNotices } from '@/lib/notices'
import type { Shown } from '@/lib/provider-ui'
import type { Connection, ProviderSlot } from '@team-platform/client'
import { useCheckConnection, useConnections } from '@team-platform/client/react'

/** What a row says about its last action, in a live region: the outcome in a line, or a test with its detail. */
type Outcome = { kind: 'line'; ok: boolean; node: ReactNode } | { kind: 'check'; shown: Shown }

/** One row per provider: state of its key, the functions that use it, the last diagnosis and the actions. */
export function ProviderConnections() {
  const query = useConnections()
  const t = useT()
  if (!query.data) return <LoadState query={query} rows={3} />
  const { items, presets } = query.data
  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 ? (
        <EmptyState>{t('providers.empty')}</EmptyState>
      ) : (
        <ul className="flex flex-col">
          {items.map((c) => (
            <ConnectionRow key={c.name} connection={c} />
          ))}
        </ul>
      )}
      <AddConnection presets={presets} items={items} />
    </div>
  )
}

function ConnectionRow({ connection: c }: { connection: Connection }) {
  const t = useT()
  const { stamp } = useFormat()
  const check = useCheckConnection()
  const [form, setForm] = useState<'add' | 'replace' | null>(null)
  const removal = useProviderRemoval()
  const notices = useNotices()
  /** A removal the server refused because functions use the provider (UD-253: refused, not confirmed). */
  const [blocked, setBlocked] = useState<{ mode: RemovalMode; slots: ProviderSlot[] } | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const resultId = useId()
  const hasKey = c.key.source !== null
  const last = c.last_check

  const diagnose = async () => {
    setOutcome(null)
    try {
      const r = await check.mutateAsync({ name: c.name })
      setOutcome({ kind: 'check', shown: { subject: c.label, check: r.check } })
    } catch (err) {
      setOutcome({ kind: 'line', ok: false, node: <FailureLine error={err} kept="providers.failedKept" /> })
    }
  }

  const remove = async (mode: RemovalMode) => {
    setOutcome(null)
    setBlocked(null)
    const r = await removal.run(c, mode)
    // A deleted provider takes its row with it, so what happened is said in the notice of the screen.
    if (r.ok) (mode === 'delete' ? notices.show({ text: r.text }) : setOutcome({ kind: 'line', ok: true, node: r.text }))
    else if ('blocked' in r) setBlocked({ mode, slots: r.blocked })
    else setOutcome({ kind: 'line', ok: false, node: <p role="alert" className="break-words text-sm text-danger">{r.error}</p> })
  }

  return (
    <li data-connection={c.name} data-status={c.status} role="group" aria-label={c.label} className="flex flex-col gap-3 border-t border-line py-3 first:border-t-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h4 className="min-w-0 break-words text-sm font-semibold">{c.label}</h4>
        <ConnectionStatusMark status={c.status} />
      </div>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        <div className="min-w-0">
          <dt className="text-xs text-muted">{t('providers.key')}</dt>
          <dd className="break-words">
            {c.key.source ? (
              <>
                {t(`providers.source.${c.key.source}` as MessageKey)}
                {c.key.last4 && <span className="tabular-nums font-mono text-xs text-muted"> · {t('providers.endsIn', { last4: c.key.last4 })}</span>}
              </>
            ) : (
              t('providers.status.no_key')
            )}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted">{t('providers.usedBy')}</dt>
          <dd className="break-words">{c.used_by.length ? c.used_by.map((s) => t(`settings.slot.${s}` as MessageKey)).join(', ') : t('providers.unused')}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted">{t('providers.lastCheck')}</dt>
          <dd className="break-words">
            {last ? (
              <>
                <span className={last.ok ? undefined : 'text-danger'}>{last.ok ? t('providers.checkOk') : t(causeKey(last.cause))}</span>
                <span className="text-xs text-muted tabular-nums"> · {t('providers.ms', { ms: last.duration_ms })} · {stamp(last.at)}</span>
              </>
            ) : (
              t('providers.neverChecked')
            )}
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        {hasKey ? (
          <Button size="sm" onClick={() => void diagnose()} disabled={check.isPending} aria-describedby={resultId}>
            {check.isPending ? t('providers.diagnosing') : t('providers.diagnose')}
          </Button>
        ) : (
          <Button size="sm" onClick={() => setForm('add')} aria-expanded={form === 'add'}>
            {t('providers.addKey')}
          </Button>
        )}
        {hasKey && (
          <Button size="sm" variant="ghost" onClick={() => setForm('replace')} aria-expanded={form === 'replace'}>
            {t('providers.replaceKey')}
          </Button>
        )}
        {hasKey && (
          <Button size="sm" variant="ghost" disabled={removal.pending} onClick={() => void remove('retire')}>
            {t('providers.retireKey')}
          </Button>
        )}
        {c.custom && (
          <Button size="sm" variant="ghost" disabled={removal.pending} onClick={() => void remove('delete')}>
            {t('providers.delete')}
          </Button>
        )}
      </div>
      {form && (
        <ProviderKeyForm
          name={c.name}
          replacing={form === 'replace'}
          onCancel={() => setForm(null)}
          onFailed={(err) => setOutcome({ kind: 'line', ok: false, node: <FailureLine error={err} kept={form === 'replace' ? 'providers.keyFailed' : 'providers.addFailed'} /> })}
          onDone={(r) => {
            setForm(null)
            setOutcome({ kind: 'line', ok: true, node: t(form === 'replace' ? 'providers.keyReplaced' : 'providers.keyAdded', { ms: r.check.duration_ms }) })
          }}
        />
      )}
      <div role="status" aria-live="polite">
        {outcome?.kind === 'line' && (outcome.ok ? <p className="text-sm font-semibold text-accent-deep">{outcome.node}</p> : outcome.node)}
      </div>
      <ProviderCheck id={resultId} shown={outcome?.kind === 'check' ? outcome.shown : null} onClose={() => setOutcome(null)} />
      {blocked && <ProviderRemoval connection={c} mode={blocked.mode} blocked={blocked.slots} onClose={() => setBlocked(null)} onDone={(text) => { const mode = blocked.mode; setBlocked(null); if (mode === 'delete') notices.show({ text }); else setOutcome({ kind: 'line', ok: true, node: text }) }} />}
    </li>
  )
}
