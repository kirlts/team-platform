import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { SettingHint } from '@/components/SettingHint'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useErrorText, useFormat, useT } from '@/i18n'
import { api } from '@/lib/api'
import { useSeedExamples } from '@/lib/queries'

type Scope = 'content' | 'everything'
interface ResetResult {
  scope: Scope
  deleted: Record<string, number>
  files: number
  bytes_freed: number
}

/**
 * «Datos» of Configuración (UD-240): the Editor empties the test data. Each action confirms in place: the button turns into the
 * same verb plus «Cancelar»; «Vaciar todo» also asks for the confirmation word before its button works. The figures of the
 * last reset stay in the section and every query of the panel is invalidated, so the lists reload empty.
 */
export function DataReset() {
  const t = useT()
  const format = useFormat()
  const errorText = useErrorText()
  const queryClient = useQueryClient()
  const [arming, setArming] = useState<Scope | null>(null)
  const [word, setWord] = useState('')
  const [result, setResult] = useState<ResetResult | null>(null)
  const seed = useSeedExamples()
  const reset = useMutation({
    mutationFn: (scope: Scope) => api<ResetResult>('/ops/reset?confirm=true', { method: 'POST', body: { scope } }),
    onSuccess: async (r) => {
      setResult(r)
      setArming(null)
      setWord('')
      await queryClient.invalidateQueries()
    },
  })
  const arm = (scope: Scope) => {
    setArming(scope)
    setWord('')
    reset.reset()
  }
  const cancel = () => {
    setArming(null)
    setWord('')
  }
  const confirmWord = t('data.confirmWord')
  const everythingReady = word.trim().toUpperCase() === confirmWord

  const figures: [string, string][] = result
    ? [
        [t('data.inputs'), String(result.deleted.inputs ?? 0)],
        [t('data.messages'), String(result.deleted.messages ?? 0)],
        [t('data.replies'), String(result.deleted.replies ?? 0)],
        ...(result.scope === 'everything' ? ([[t('data.members'), String(result.deleted.members ?? 0)], [t('data.areas'), String(result.deleted.areas ?? 0)]] as [string, string][]) : []),
        [t('data.files'), String(result.files)],
        [t('data.bytes'), format.fileSize(result.bytes_freed)],
      ]
    : []

  return (
    <section data-data-reset className="flex flex-col gap-3 border-t border-line-strong pt-3">
      <h2>{t('settings.data')}</h2>
      <dl className="flex flex-col gap-3 text-sm">
        <div className="flex flex-col gap-0.5">
          <dt className="text-sm text-muted">{t('data.content')}</dt>
          <dd aria-describedby="hint-data-content" className="flex flex-col items-start gap-1">
            <div className="flex flex-wrap items-center gap-2">
              {arming === 'content' ? (
                <>
                  <Button size="sm" variant="danger" onClick={() => reset.mutate('content')} disabled={reset.isPending}>
                    {t('data.clearContent')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={cancel} disabled={reset.isPending}>
                    {t('common.cancel')}
                  </Button>
                </>
              ) : (
                <Button size="sm" onClick={() => arm('content')} disabled={reset.isPending} aria-describedby="hint-data-content">
                  {t('data.clearContent')}
                </Button>
              )}
            </div>
            <SettingHint id="hint-data-content">{t('hint.data.content')}</SettingHint>
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-sm text-muted">{t('data.everything')}</dt>
          <dd aria-describedby="hint-data-everything" className="flex flex-col items-start gap-1">
            <div className="flex flex-wrap items-center gap-2">
              {arming === 'everything' ? (
                <>
                  <Input
                    value={word}
                    onChange={(e) => setWord(e.target.value)}
                    aria-label={t('data.confirmLabel', { word: confirmWord })}
                    placeholder={confirmWord}
                    autoComplete="off"
                    spellCheck={false}
                    className="w-36 font-mono text-xs uppercase"
                    autoFocus
                  />
                  <Button size="sm" variant="danger" onClick={() => reset.mutate('everything')} disabled={!everythingReady || reset.isPending}>
                    {t('data.clearAll')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={cancel} disabled={reset.isPending}>
                    {t('common.cancel')}
                  </Button>
                </>
              ) : (
                <Button size="sm" onClick={() => arm('everything')} disabled={reset.isPending} aria-describedby="hint-data-everything">
                  {t('data.clearAll')}
                </Button>
              )}
            </div>
            <SettingHint id="hint-data-everything">{t('hint.data.everything', { word: confirmWord })}</SettingHint>
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-sm text-muted">{t('data.examples')}</dt>
          <dd aria-describedby="hint-data-examples" className="flex flex-col items-start gap-1">
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" onClick={() => seed.mutate()} disabled={seed.isPending || reset.isPending} aria-describedby="hint-data-examples">
                {t('data.seed')}
              </Button>
              {seed.data && (
                <span data-seed-figure role="status" className="tabular-nums">
                  {t('data.sent', { n: seed.data.created + seed.data.existing })}
                </span>
              )}
            </div>
            <SettingHint id="hint-data-examples">{t('hint.data.examples')}</SettingHint>
          </dd>
        </div>
      </dl>
      <div role="alert" aria-live="assertive">
        {seed.isError && <p className="break-words text-sm text-danger">{errorText(seed.error)}</p>}
        {reset.isError && <p className="break-words text-sm text-danger">{errorText(reset.error)}</p>}
      </div>
      {result && (
        <dl data-reset-figures aria-label={t('data.deleted')} className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1 self-start text-sm">
          {figures.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted">{label}</dt>
              <dd className="tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}
