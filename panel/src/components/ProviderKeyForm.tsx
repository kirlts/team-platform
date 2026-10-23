import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useT } from '@/i18n'
import type { ConnectionResult } from '@team-platform/client'
import { useReplaceKey } from '@team-platform/client/react'

/**
 * Form in place to store or replace the key of one provider. The server tests the key before it keeps it, and a failure leaves the
 * previous key active. The key lives in this field only until it is sent: it is cleared before the request leaves, the mutation is
 * reset afterwards and the answer carries only its last four characters.
 */
export function ProviderKeyForm({
  name,
  replacing,
  onDone,
  onFailed,
  onCancel,
}: {
  name: string
  replacing: boolean
  onDone: (result: ConnectionResult) => void
  onFailed: (error: unknown) => void
  onCancel: () => void
}) {
  const t = useT()
  const replace = useReplaceKey()
  const [key, setKey] = useState('')
  const [model, setModel] = useState('')
  const [pending, setPending] = useState(false)
  const idKey = `key-${name}`
  const idModel = `key-model-${name}`

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const sent = key.trim()
    if (!sent || pending) return
    setKey('')
    setPending(true)
    try {
      const result = await replace.mutateAsync({ name, api_key: sent, ...(model.trim() ? { model: model.trim() } : {}) })
      onDone(result)
    } catch (err) {
      onFailed(err)
    } finally {
      replace.reset()
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} data-key-form={name} aria-label={replacing ? t('providers.replaceKey') : t('providers.addKey')} className="flex flex-col gap-3 rounded-md border border-line bg-hover/50 px-3 py-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label htmlFor={idKey} className="flex min-w-0 flex-col gap-1 text-sm text-muted">
          {t('providers.apiKey')}
          <Input id={idKey} type="password" autoComplete="off" spellCheck={false} autoFocus value={key} onChange={(e) => setKey(e.target.value)} className="font-mono text-xs" />
        </label>
        <label htmlFor={idModel} className="flex min-w-0 flex-col gap-1 text-sm text-muted">
          {t('providers.modelOptional')}
          <Input id={idModel} autoComplete="off" spellCheck={false} value={model} onChange={(e) => setModel(e.target.value)} className="font-mono text-xs" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={pending || !key.trim()}>
          {pending ? t('providers.testing') : t('providers.testAndSave')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={pending}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  )
}
