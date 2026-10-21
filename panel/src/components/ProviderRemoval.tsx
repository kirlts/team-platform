import { useState } from 'react'
import { FailureLine } from '@/components/ProviderCheck'
import { NativeSelect } from '@/components/NativeSelect'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useErrorText, useT, type MessageKey } from '@/i18n'
import { compatible, usedByOf } from '@/lib/provider-ui'
import { useConnections, useDeleteConnection, useRetireKey, useSaveProvider } from '@/lib/queries'
import type { Connection, ProviderSlot } from '@/lib/types'

/**
 * Confirmation to retire the key of a provider, or to delete a custom one. When the server answers `provider_in_use` the window lists
 * the functions that depend on it, each with the switch to another provider, and the removal is tried again.
 */
export function ProviderRemoval({ connection, mode, onClose, onDone }: { connection: Connection; mode: 'retire' | 'delete'; onClose: () => void; onDone: (text: string) => void }) {
  const t = useT()
  const errorText = useErrorText()
  const retire = useRetireKey()
  const remove = useDeleteConnection()
  const [blocked, setBlocked] = useState<ProviderSlot[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const title = mode === 'retire' ? t('providers.retireTitle', { name: connection.label }) : t('providers.deleteTitle', { name: connection.label })

  const run = async () => {
    setPending(true)
    setError(null)
    try {
      await (mode === 'retire' ? retire.mutateAsync(connection.name) : remove.mutateAsync(connection.name))
      onDone(mode === 'retire' ? t('providers.retired') : t('providers.deleted'))
    } catch (err) {
      const used = usedByOf(err)
      if (used) setBlocked(used)
      else setError(errorText(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={title} data-removal={mode}>
        <div className="flex min-h-0 flex-col gap-4 p-5 text-sm">
          <p>{mode === 'retire' ? t('providers.retireBody') : t('providers.deleteBody')}</p>
          {blocked && blocked.length > 0 && (
            <div role="group" aria-label={t('providers.inUse')} className="flex flex-col gap-3">
              <p className="font-semibold">{t('providers.inUse')}</p>
              <ul className="flex flex-col gap-3">
                {blocked.map((slot) => (
                  <SwitchRow key={slot} slot={slot} leaving={connection.name} onSwitched={() => setBlocked((list) => (list ?? []).filter((s) => s !== slot))} />
                ))}
              </ul>
            </div>
          )}
          <div role="alert" aria-live="assertive">
            {error && <p className="break-words text-danger">{error}</p>}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={() => void run()} disabled={pending || (blocked !== null && blocked.length > 0)}>
              {blocked ? t('providers.retry') : mode === 'retire' ? t('providers.retire') : t('providers.delete')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
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
        <label className="flex min-w-0 flex-col gap-1 text-xs font-medium">
          {t('providers.switchTo')}
          <NativeSelect value={provider} onChange={(e) => choose(e.target.value)} aria-label={`${t('providers.switchTo')}: ${slotName}`}>
            {options.map((c) => (
              <option key={c.name} value={c.name}>
                {c.label}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs font-medium">
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
