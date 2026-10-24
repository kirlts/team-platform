import { Segmented } from '@/components/Segmented'
import { SettingsBox } from '@/components/SettingsBox'
import { useT } from '@/i18n'
import { usePublication, useSavePublication } from '@team-platform/client/react'

/**
 * Publication of a send (UD-070): «Automática» publishes the messages when the analysis ends; «Manual» leaves the proposal for review and
 * Enviar. Everyone reads it, only the Editor changes it, so the section is drawn for the Editor alone. The line under the title says what each option does (UD-122).
 */
export function PublicationSetting() {
  const t = useT()
  const current = usePublication()
  const save = useSavePublication()
  if (!current.data) return null
  return (
    <SettingsBox
      title={t('settings.publication')}
      hint={t('hint.publication')}
      hintId="hint-publication"
      aside={
        <Segmented
          value={current.data.auto_publish ? 'auto' : 'manual'}
          onChange={(v) => save.mutate(v === 'auto')}
          label={t('settings.publication')}
          describedBy="hint-publication"
          options={[
            { value: 'auto', label: t('settings.publicationAuto') },
            { value: 'manual', label: t('settings.publicationManual') },
          ]}
        />
      }
    />
  )
}
