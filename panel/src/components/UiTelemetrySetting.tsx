import { Segmented } from '@/components/Segmented'
import { SettingsBox } from '@/components/SettingsBox'
import { UiSummaryLine } from '@/components/UiSummaryLine'
import { useT } from '@/i18n'
import { useMe, useSaveUiTelemetry } from '@team-platform/client/react'

/** Owner's switch of interface telemetry (UD-091). It sits in Configuración and only the Editor sees it. */
export function UiTelemetrySetting() {
  const t = useT()
  const enabled = useMe().data?.ui_telemetry?.enabled ?? false
  const save = useSaveUiTelemetry()
  return (
    <SettingsBox
      title={t('settings.telemetry')}
      hint={t('hint.telemetry')}
      hintId="hint-telemetry"
      aside={
        <Segmented
          value={enabled ? 'on' : 'off'}
          onChange={(v) => save.mutate(v === 'on')}
          label={t('settings.telemetry')}
          describedBy="hint-telemetry"
          options={[
            { value: 'on', label: t('settings.telemetryOn') },
            { value: 'off', label: t('settings.telemetryOff') },
          ]}
        />
      }
    >
      <UiSummaryLine enabled={enabled} />
    </SettingsBox>
  )
}
