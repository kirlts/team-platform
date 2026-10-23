import { useState } from 'react'
import { FailureLine } from '@/components/ProviderCheck'
import { NativeSelect } from '@/components/NativeSelect'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useErrorText, useT, type MessageKey } from '@/i18n'
import { compatible, usedByOf } from '@/lib/provider-ui'
import type { Connection, ProviderSlot } from '@team-platform/client'
import { useConnections, useDeleteConnection, useRetireKey, useSaveProvider } from '@team-platform/client/react'

export type RemovalMode = 'retire' | 'delete'
export type RemovalResult = { ok: true; text: string } | { ok: false; blocked: ProviderSlot[] } | { ok: false; error: string }

/**
 * Retiring the key of a provider, or deleting a custom one, happens with one click (UD-253): no window and no step that confirms it.
 * What the server refuses is not a confirmation: with `provider_in_use` the answer carries the functions that depend on it.
 */
export function useProviderRemoval() {
  const t = useT()
  const errorText = useErrorText()
  const retire = useRetireKey()
  const remove = useDeleteConnection()
  const run = async (connection: Connection, mode: RemovalMode): Promise<RemovalResult> => {
    try {
      await (mode === 'retire' ? retire.mutateAsync(connection.name) : remove.mutateAsync(connection.name))
      return { ok: true, text: mode === 'retire' ? t('providers.retired') : t('providers.deleted') }
    } catch (err) {
      const used = usedByOf(err)
      return used ? { ok: false, blocked: used } : { ok: false, error: errorText(err) }
    }
  }
  return { run, pending: retire.isPending || remove.isPending }
}

/**
 * The removal the server refused because functions use the provider: in the row, each function with the switch to another
 * provider, and «Reintentar» once none is left.
 */
export function ProviderRemoval({ connection, mode, blocked: initial, onClose, onDone }: { connection: Connection; mode: RemovalMode; blocked: ProviderSlot[]; onClose: () => void; onDone: (text: string) => void }) {
  const t = useT()
  const removal = useProviderRemoval()
  const [blocked, setBlocked] = useState<ProviderSlot[]>(initial)
  const [error, setError] = useState<string | null>(null)

  const retry = async () => {
    setError(null)
    const r = await removal.run(connection, mode)
    if (r.ok) onDone(r.text)
    else if ('blocked' in r) setBlocked(r.blocked)
    else setError(r.error)
  }

  return (
    <div role="group" aria-label={t('providers.inUse')} data-removal={mode} className="flex flex-col gap-3 text-sm">
      <p className="font-semibold">{t('providers.inUse')}</p>
      <ul className="flex flex-col gap-3">
        {blocked.map((slot) => (
          <SwitchRow key={slot} slot={slot} leaving={connection.name} onSwitched={() => setBlocked((list) => list.filter((s) => s !== slot))} />
        ))}
      </ul>
      <div role="alert" aria-live="assertive">
        {error && <p className="break-words text-danger">{error}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="danger" onClick={() => void retry()} disabled={removal.pending || blocked.length > 0}>
          {t('providers.retry')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  )
}

/** One function that depends on the provider: another provider and model for it, tested by the server before it applies. */
function SwitchRow({ slot, leaving, onSwitched }: { slot: ProviderSlot; leaving: string; onSwitched: () => void }) {
  const t = useT()
  const view = useConnections().data
  const save = useSaveProvider()
  const options = compatible(slot, view?.items ?? [], leaving)
  const [provider, setProvider] = useState(options[0]?.name ?? '')
  const [model, setModel] = useState(() => view?.presets.find((p) => p.name === options[0]?.name)?.suggested_model ?? '')
  const [failure, setFailure] = useState<unknown>(null)
  const slotName = t(`settings.slot.${slot}` as MessageKey)

  if (options.length === 0) {
    return (
      <li className="flex flex-col gap-1">
        <span className="font-semibold">{slotName}</span>
        <span className="text-muted">{t('providers.noAlternative')}</span>
      </li>
    )
  }
  const choose = (name: string) => {
    setProvider(name)
    setModel(view?.presets.find((p) => p.name === name)?.suggested_model ?? '')
  }
  const apply = async () => {
    setFailure(null)
    try {
      await save.mutateAsync({ slot, provider, model: model.trim() })
      onSwitched()
    } catch (err) {
      setFailure(err)
    }
  }
  return (
    <li data-switch={slot} className="flex flex-col gap-2">
      <span className="font-semibold">{slotName}</span>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex min-w-0 flex-col gap-1 text-sm text-muted">
          {t('providers.switchTo')}
          <NativeSelect value={provider} onChange={(e) => choose(e.target.value)} aria-label={`${t('providers.switchTo')}: ${slotName}`}>
            {options.map((c) => (
              <option key={c.name} value={c.name}>
                {c.label}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-sm text-muted">
          {t('providers.model')}
          <Input value={model} onChange={(e) => setModel(e.target.value)} autoComplete="off" spellCheck={false} aria-label={t('settings.modelOf', { slot: slotName })} className="font-mono text-xs" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void apply()} disabled={save.isPending || !model.trim()} aria-label={`${t('providers.apply')}: ${slotName}`}>
          {t('providers.apply')}
        </Button>
        <div role="status" aria-live="polite" className="min-w-0">
          {failure !== null && <FailureLine error={failure} kept="providers.failedKept" />}
        </div>
      </div>
    </li>
  )
}
