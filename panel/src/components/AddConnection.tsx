import { useState, type FormEvent } from 'react'
import { NativeSelect } from '@/components/NativeSelect'
import { FailureLine } from '@/components/ProviderCheck'
import { Segmented } from '@/components/Segmented'
import { Plus } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useT, type MessageKey } from '@/i18n'
import { useAddConnection } from '@/lib/queries'
import type { Connection, NewConnection, Preset, StructuredMode } from '@/lib/types'

const OTHER = 'other'
const MODES: readonly StructuredMode[] = ['json_schema', 'tool', 'json_object']

/**
 * Form in place to add a provider: a preset, or «Otro» with name, base address and structured mode. The server tests the key first
 * and stores nothing when the test fails. As in the key form, the key is cleared from the field before the request leaves.
 */
export function AddConnection({ presets, items }: { presets: Preset[]; items: Connection[] }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <Plus size={13} aria-hidden /> {t('providers.addProvider')}
        </Button>
        <div role="status" aria-live="polite">
          {done && <p className="text-sm font-semibold text-accent-deep">{done}</p>}
        </div>
      </div>
      {open && (
        <AddForm
          presets={presets}
          items={items}
          onCancel={() => setOpen(false)}
          onDone={(text) => {
            setOpen(false)
            setDone(text)
          }}
        />
      )}
    </div>
  )
}

function AddForm({ presets, items, onCancel, onDone }: { presets: Preset[]; items: Connection[]; onCancel: () => void; onDone: (text: string) => void }) {
  const t = useT()
  const add = useAddConnection()
  const offered = presets.filter((p) => p.name !== OTHER && !items.some((c) => c.name === p.name && c.key.source !== null))
  const [choice, setChoice] = useState(offered[0]?.name ?? OTHER)
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [structured, setStructured] = useState<StructuredMode>('json_schema')
  const [key, setKey] = useState('')
  const [model, setModel] = useState('')
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<unknown>(null)
  const custom = choice === OTHER
  const suggested = presets.find((p) => p.name === choice)?.suggested_model ?? ''
  const complete = key.trim() !== '' && (!custom || (name.trim() !== '' && baseUrl.trim() !== ''))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const sent = key.trim()
    if (!complete || pending) return
    const body: NewConnection = custom
      ? { name: name.trim(), label: name.trim(), base_url: baseUrl.trim(), structured, api_key: sent }
      : { preset: choice, api_key: sent }
    if (model.trim()) body.model = model.trim()
    setKey('')
    setFailure(null)
    setPending(true)
    try {
      const r = await add.mutateAsync(body)
      onDone(t('providers.providerAdded', { ms: r.check.duration_ms }))
    } catch (err) {
      setFailure(err)
    } finally {
      add.reset()
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} aria-label={t('providers.addProvider')} data-add-form className="flex flex-col gap-3 rounded-md border border-line bg-hover/50 px-3 py-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex min-w-0 flex-col gap-1 text-sm text-muted">
          {t('providers.preset')}
          <NativeSelect value={choice} onChange={(e) => setChoice(e.target.value)}>
            {offered.map((p) => (
              <option key={p.name} value={p.name}>
                {p.label}
              </option>
            ))}
            <option value={OTHER}>{t('providers.other')}</option>
          </NativeSelect>
        </label>
        {custom && (
          <label className="flex min-w-0 flex-col gap-1 text-sm text-muted">
            {t('providers.name')}
            <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" spellCheck={false} className="font-mono text-xs" />
          </label>
        )}
        {custom && (
          <label className="flex min-w-0 flex-col gap-1 text-sm text-muted sm:col-span-2">
            {t('providers.baseUrl')}
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} type="url" inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://" className="font-mono text-xs" />
          </label>
        )}
        {custom && (
          <div className="flex min-w-0 flex-col gap-1 text-sm text-muted sm:col-span-2">
            <Segmented
              size="sm"
              value={structured}
              onChange={setStructured}
              label={t('providers.structured')}
              options={MODES.map((m) => ({ value: m, label: t(`providers.structured.${m}` as MessageKey) }))}
            />
          </div>
        )}
        <label className="flex min-w-0 flex-col gap-1 text-sm text-muted">
          {t('providers.apiKey')}
          <Input type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} className="font-mono text-xs" />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-sm text-muted">
          {t('providers.modelOptional')}
          <Input value={model} onChange={(e) => setModel(e.target.value)} autoComplete="off" spellCheck={false} placeholder={suggested} className="font-mono text-xs" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={pending || !complete}>
          {pending ? t('providers.testing') : t('providers.testAndSave')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={pending}>
          {t('common.cancel')}
        </Button>
      </div>
      <div role="status" aria-live="polite">
        {failure !== null && <FailureLine error={failure} kept="providers.addFailed" />}
      </div>
    </form>
  )
}
