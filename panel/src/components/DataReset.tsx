import { useState } from 'react'
import { SettingHint } from '@/components/SettingHint'
import { SettingsBox } from '@/components/SettingsBox'
import { Button } from '@/components/ui/button'
import { useErrorText, useFormat, useT } from '@/i18n'
import type { ResetResult } from '@team-platform/client'
import { useResetData, useSeedExamples } from '@team-platform/client/react'
import { useNotices } from '@/lib/notices'

/**
 * «Datos» of Configuración (UD-240): the Editor empties the test data with one click and no step that confirms it (UD-253).
 * Nothing comes back, so the notice says how much went and the figures of the last reset stay in the section. Every query of
 * the panel is invalidated, so the lists reload empty.
 */
export function DataReset() {
  const t = useT()
  const format = useFormat()
  const errorText = useErrorText()
  const notices = useNotices()
  const [result, setResult] = useState<ResetResult | null>(null)
  const seed = useSeedExamples()
  const reset = useResetData({
    onDone: (r) => {
      setResult(r)
      notices.show({ text: t('data.done', { inputs: r.deleted.inputs ?? 0, messages: r.deleted.messages ?? 0, replies: r.deleted.replies ?? 0 }) })
    },
  })

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
    <SettingsBox fold data-data-reset title={t('settings.data')}>
      <dl className="flex flex-col">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line py-3 first:pt-0">
          <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
            <dt className="text-sm font-semibold">{t('data.content')}</dt>
            <dd>
              <SettingHint visible id="hint-data-content">{t('hint.data.content')}</SettingHint>
            </dd>
          </div>
          <Button size="sm" variant="danger" onClick={() => reset.mutate('content')} disabled={reset.isPending} aria-describedby="hint-data-content">
            {t('data.clearContent')}
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line py-3">
          <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
            <dt className="text-sm font-semibold">{t('data.everything')}</dt>
            <dd>
              <SettingHint visible id="hint-data-everything">{t('hint.data.everything')}</SettingHint>
            </dd>
          </div>
          <Button size="sm" variant="danger" onClick={() => reset.mutate('everything')} disabled={reset.isPending} aria-describedby="hint-data-everything">
            {t('data.clearAll')}
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 last:pb-0">
          <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
            <dt className="text-sm font-semibold">{t('data.examples')}</dt>
            <dd>
              <SettingHint visible id="hint-data-examples">{t('hint.data.examples')}</SettingHint>
            </dd>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {seed.data && (
              <span data-seed-figure role="status" className="text-sm tabular-nums">
                {t('data.sent', { n: seed.data.created + seed.data.existing })}
              </span>
            )}
            <Button size="sm" onClick={() => seed.mutate()} disabled={seed.isPending || reset.isPending} aria-describedby="hint-data-examples">
              {t('data.seed')}
            </Button>
          </div>
        </div>
      </dl>
      <div role="alert" aria-live="assertive" className="empty:-mt-4">
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
    </SettingsBox>
  )
}
