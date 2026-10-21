import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Segmented } from '@/components/Segmented'
import { useT } from '@/i18n'
import { api } from '@/lib/api'
import { useMe } from '@/lib/queries'

/** Owner's switch of interface telemetry (UD-061). It sits in Configuración and only the Editor sees it. */
export function UiTelemetrySetting() {
  const t = useT()
  const queryClient = useQueryClient()
  const enabled = useMe().data?.ui_telemetry?.enabled ?? false
  const save = useMutation({
    mutationFn: (value: boolean) => api('/settings/telemetry', { method: 'PATCH', body: { ui_enabled: value } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['me'] }),
  })
  return (
    <section className="flex flex-col gap-3 border-t border-line-strong pt-3">
      <h2>{t('settings.telemetry')}</h2>
      <Segmented
        value={enabled ? 'on' : 'off'}
        onChange={(v) => save.mutate(v === 'on')}
        label={t('settings.telemetry')}
        options={[
          { value: 'on', label: t('settings.telemetryOn') },
          { value: 'off', label: t('settings.telemetryOff') },
        ]}
      />
    </section>
  )
}
