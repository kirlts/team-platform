import { useId, useState } from 'react'
import { AlertTriangle, Check as CheckIcon, ChevronRight, X } from '@/components/icons'
import { Input } from '@/components/ui/input'
import { useErrorText, useT, type MessageKey } from '@/i18n'
import { failureOf, MODELS_SHOWN, type Shown } from '@/lib/provider-ui'
import type { Cause } from '@team-platform/client'
import { cn } from '@/lib/utils'

export const causeKey = (cause: Cause | null): MessageKey => `cause.${cause ?? 'unknown'}` as MessageKey

/** «HTTP 401 · 371 ms»: what the provider answered and how long it took. */
export function CheckFacts({ status, durationMs, className }: { status: number | null; durationMs: number | null; className?: string }) {
  const t = useT()
  const parts = [status !== null ? t('providers.http', { status }) : null, durationMs !== null ? t('providers.ms', { ms: durationMs }) : null].filter(Boolean)
  if (!parts.length) return null
  return <span className={cn('tabular-nums', className)}>{parts.join(' · ')}</span>
}

/**
 * The result of a diagnosis, in a live region that exists before the result does so a screen reader announces it:
 * mark and cause, status and duration, and the models the provider lists, folded with their count.
 */
export function ProviderCheck({ id, shown, onClose }: { id: string; shown: Shown | null; onClose: () => void }) {
  return (
    <div id={id} role="status" aria-live="polite" data-check-result={shown ? (shown.check.ok ? 'ok' : 'failed') : undefined}>
      {shown && <Result shown={shown} onClose={onClose} />}
    </div>
  )
}

function Result({ shown, onClose }: { shown: Shown; onClose: () => void }) {
  const t = useT()
  const { check, subject } = shown
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-hover/50 px-3 py-2 text-sm">
      <div className="flex items-start gap-2">
        {check.ok ? <CheckIcon size={16} aria-hidden className="mt-0.5 shrink-0 text-accent" /> : <AlertTriangle size={16} aria-hidden className="mt-0.5 shrink-0 text-danger" />}
        <p className="min-w-0 flex-1 break-words">
          <span className="font-semibold">{subject}</span>
          <span className="text-muted"> · </span>
          <span className={cn('font-semibold', !check.ok && 'text-danger')}>{check.ok ? t('providers.checkOk') : t(causeKey(check.cause))}</span>
          <span className="text-muted"> · </span>
          <CheckFacts status={check.status} durationMs={check.duration_ms} className="text-muted" />
          {check.model && <span className="ml-2 break-all font-mono text-xs text-muted">{check.model}</span>}
        </p>
        <button type="button" onClick={onClose} aria-label={t('providers.closeResult')} className="inline-flex min-h-6 min-w-6 items-center justify-center rounded-full text-muted hover:bg-hover">
          <X size={14} aria-hidden />
        </button>
      </div>
      {check.models && check.models.length > 0 && <Models models={check.models} />}
    </div>
  )
}

/** Folded list of models: the first ones and, past the cap, a field to narrow the rest. No inner scrolling. */
function Models({ models }: { models: string[] }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const panel = useId()
  const matching = filter.trim() ? models.filter((m) => m.toLowerCase().includes(filter.trim().toLowerCase())) : models
  const shown = matching.slice(0, MODELS_SHOWN)
  return (
    <div className="flex flex-col gap-2">
      <button type="button" aria-expanded={open} aria-controls={panel} onClick={() => setOpen((v) => !v)} className="inline-flex min-h-6 items-center gap-1.5 self-start text-xs font-semibold text-accent-deep hover:underline">
        <ChevronRight size={13} aria-hidden className={cn('transition-transform', open && 'rotate-90')} />
        {t('providers.models', { n: models.length })}
      </button>
      {open && (
        <div id={panel} className="flex flex-col gap-2">
          {models.length > MODELS_SHOWN && (
            <label className="flex flex-col gap-1 text-xs font-medium sm:max-w-xs">
              {t('providers.modelsFilter')}
              <Input value={filter} onChange={(e) => setFilter(e.target.value)} autoComplete="off" spellCheck={false} />
            </label>
          )}
          <ul className="flex flex-wrap gap-1.5">
            {shown.map((m) => (
              <li key={m} className="rounded-md border border-line-strong px-1.5 py-0.5 font-mono text-xs break-all">
                {m}
              </li>
            ))}
          </ul>
          {models.length > MODELS_SHOWN && (
            <p className="text-xs text-muted">{t('providers.modelsOf', { shown: shown.length, total: matching.length })}</p>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * A failed request in one line: the classified cause of a provider test, with what the provider answered, followed by what stays
 * as it was (`kept` is the catalogue key of the sentence, which takes `{cause}`). Any other error reads as its own text.
 */
export function FailureLine({ error, kept, className }: { error: unknown; kept: MessageKey; className?: string }) {
  const t = useT()
  const errorText = useErrorText()
  const failure = failureOf(error)
  return (
    <p className={cn('flex min-w-0 flex-wrap items-start gap-x-2 gap-y-0.5 break-words text-sm text-danger', className)}>
      <AlertTriangle size={16} aria-hidden className="mt-0.5 shrink-0" />
      <span className="min-w-0">{failure ? t(kept, { cause: t(causeKey(failure.cause)) }) : errorText(error)}</span>
      {failure && <CheckFacts status={failure.status} durationMs={failure.durationMs} className="text-xs text-muted" />}
    </p>
  )
}
