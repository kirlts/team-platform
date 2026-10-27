import { useEffect, useId, useState } from 'react'
import { AlertTriangle } from '@/components/icons'
import { ConnectionStatusMark } from '@/components/ConnectionStatusMark'
import { LoadState } from '@/components/LoadState'
import { NativeSelect } from '@/components/NativeSelect'
import { FailureLine, ProviderCheck } from '@/components/ProviderCheck'
import { ProviderConnections } from '@/components/ProviderConnections'
import { SettingHint } from '@/components/SettingHint'
import { SettingsBox } from '@/components/SettingsBox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useT, type MessageKey } from '@/i18n'
import { compatible, SLOTS, type Shown } from '@/lib/provider-ui'
import type { ProviderSetting, ProviderSlot } from '@team-platform/client'
import { useCheckSlot, useConnections, useProviders, useRememberedModels, useSaveProvider } from '@team-platform/client/react'

/**
 * Section «Proveedores» of Configuración (Editor only): the provider and model of each function, then the connections with the
 * state of their keys. A change of provider or model is tested by the server before it is saved; if the test fails the row goes
 * back to what was saved and says why.
 */
export function ProviderSettings() {
  const t = useT()
  // The folded row carries what fails: a provider that is down, or a read that did not arrive, is seen without opening it.
  const connections = useConnections()
  const failing = (connections.data?.items ?? []).filter((c) => c.status === 'failing')
  const note =
    connections.isError ? (
      <span data-providers-alert className="inline-flex items-center gap-1.5 text-sm font-semibold normal-case tracking-normal text-danger">
        <AlertTriangle size={16} aria-hidden /> {t('common.loadFailedShort')}
      </span>
    ) : failing.length > 0 ? (
      <span data-providers-alert className="inline-flex flex-wrap items-center gap-x-1.5 text-sm font-semibold normal-case tracking-normal text-danger">
        <AlertTriangle size={16} aria-hidden /> {failing.map((c) => c.label).join(', ')} · {t('providers.status.failing')}
      </span>
    ) : null
  return (
    <SettingsBox fold note={note} data-providers title={t('settings.providers')}>
      <ProviderBody />
    </SettingsBox>
  )
}

/** The reads start when the section is opened: the folded row asks the server for nothing. */
function ProviderBody() {
  const t = useT()
  const settings = useProviders(true)
  const connections = useConnections()
  return (
    <>
      <div className="flex flex-col gap-1">
        <h3 className="rotulo flex h-8 items-center border-b border-line">{t('providers.slots')}</h3>
        {settings.data && connections.data ? (
          <ul className="flex flex-col">
            {SLOTS.map((slot) => {
              const saved = settings.data.find((p) => p.slot === slot)
              return saved ? <SlotRow key={slot} slot={slot} saved={saved} /> : null
            })}
          </ul>
        ) : (
          <LoadState query={settings.isError || !connections.isError ? settings : connections} rows={3} />
        )}
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex h-8 items-center justify-between gap-3 border-b border-line">
          <h3 className="rotulo">{t('providers.connections')}</h3>
          <SettingHint id="hint-connections">{t('hint.connections')}</SettingHint>
        </div>
        <ProviderConnections />
      </div>
    </>
  )
}

function SlotRow({ slot, saved }: { slot: ProviderSlot; saved: ProviderSetting }) {
  const t = useT()
  const connections = useConnections().data
  const save = useSaveProvider()
  const check = useCheckSlot()
  const [provider, setProvider] = useState(saved.provider)
  const [model, setModel] = useState(saved.model)
  const [outcome, setOutcome] = useState<{ ok: true } | { ok: false; error: unknown } | null>(null)
  const [shown, setShown] = useState<Shown | null>(null)
  const ids = useId()
  const slotName = t(`settings.slot.${slot}` as MessageKey)
  const remembered = useRememberedModels(provider)

  // What the server holds is the truth: when it changes (an applied change, a switch made elsewhere) the fields follow.
  useEffect(() => {
    setProvider(saved.provider)
    setModel(saved.model)
  }, [saved.provider, saved.model])

  const items = connections?.items ?? []
  const options: { name: string; label: string }[] = compatible(slot, items)
  // The provider the function uses stays in the list even when its key is gone, so the field never shows a value it does not have.
  if (!options.some((c) => c.name === saved.provider)) options.unshift({ name: saved.provider, label: items.find((c) => c.name === saved.provider)?.label ?? saved.provider })
  const dirty = provider !== saved.provider || model.trim() !== saved.model
  const connection = items.find((c) => c.name === saved.provider)
  const status = saved.status ?? connection?.status ?? 'no_key'
  const last4 = saved.key_last4 ?? connection?.key.last4 ?? null

  const choose = (name: string) => {
    setProvider(name)
    setOutcome(null)
    setModel(name === saved.provider ? saved.model : (connections?.presets.find((p) => p.name === name)?.suggested_model ?? ''))
  }
  const apply = async () => {
    setOutcome(null)
    try {
      await save.mutateAsync({ slot, provider, model: model.trim() })
      setOutcome({ ok: true })
    } catch (error) {
      setProvider(saved.provider)
      setModel(saved.model)
      setOutcome({ ok: false, error })
    }
  }
  const diagnose = async () => {
    setShown(null)
    setOutcome(null)
    try {
      const r = await check.mutateAsync(slot)
      const label = items.find((c) => c.name === r.provider)?.label ?? r.provider
      setShown({ subject: `${slotName} · ${label} · ${r.model}`, check: r.check })
    } catch (error) {
      setOutcome({ ok: false, error })
    }
  }

  return (
    <li data-slot={slot} role="group" aria-label={slotName} className="grid gap-x-4 gap-y-3 border-t border-line py-4 first:border-t-0 md:grid-cols-[11rem_minmax(0,1fr)_minmax(0,1fr)_auto]">
      <div className="flex min-w-0 flex-col gap-1">
        <h4 className="text-sm font-semibold">{slotName}</h4>
        <ConnectionStatusMark status={status} />
        {last4 && <span className="font-mono text-sm tabular-nums text-muted">{t('providers.endsIn', { last4 })}</span>}
      </div>
      <label className="flex min-w-0 flex-col gap-2 text-sm">
        <span className="rotulo">{t('settings.provider')}</span>
        <NativeSelect value={provider} onChange={(e) => choose(e.target.value)} aria-label={t('settings.providerOf', { slot: slotName })}>
          {options.map((c) => (
            <option key={c.name} value={c.name}>
              {c.label}
            </option>
          ))}
        </NativeSelect>
      </label>
      <label className="flex min-w-0 flex-col gap-2 text-sm">
        <span className="rotulo">{t('settings.model')}</span>
        <Input
          value={model}
          onChange={(e) => {
            setModel(e.target.value)
            setOutcome(null)
          }}
          list={`${ids}-models`}
          autoComplete="off"
          spellCheck={false}
          aria-label={t('settings.modelOf', { slot: slotName })}
          className="font-mono text-sm"
        />
        <datalist id={`${ids}-models`}>
          {remembered.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>
      <div className="flex flex-wrap items-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => void diagnose()} disabled={check.isPending}>
          {check.isPending ? t('providers.diagnosing') : t('providers.diagnose')}
        </Button>
        {/* «Aplicar» exists while there is something to apply: a button that is always drawn and off says nothing about what is missing. It comes after «Diagnosticar», so that one does not move. */}
        {dirty && model.trim() !== '' && (
          <Button size="sm" onClick={() => void apply()} disabled={save.isPending}>
            {save.isPending ? t('providers.testing') : t('providers.apply')}
          </Button>
        )}
      </div>
      <div className="-mt-3 md:col-span-full [&>*:not(:empty)]:pt-3">
        <div role="status" aria-live="polite" data-slot-result>
          {outcome?.ok === true && <p className="text-sm font-semibold text-accent-deep">{t('providers.applied')}</p>}
          {outcome?.ok === false && <FailureLine error={outcome.error} kept="providers.failedKept" />}
        </div>
        <ProviderCheck id={`${ids}-check`} shown={shown} onClose={() => setShown(null)} />
      </div>
    </li>
  )
}
