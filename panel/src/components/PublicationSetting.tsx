import { Segmented } from '@/components/Segmented'
import { SettingHint } from '@/components/SettingHint'
import { useT } from '@/i18n'
import { usePublication, useSavePublication } from '@team-platform/client/react'

/**
 * Publication of a send (UD-070): «Automática» publishes the messages when the analysis ends; «Manual» leaves the proposal for review and
 * Enviar. Everyone reads it, only the Editor changes it, so the section is drawn for the Editor alone. Its effect is explained by the SettingHint under the label (UD-122).
 */
export function PublicationSetting() {
  const t = useT()
  const current = usePublication()
  const save = useSavePublication()
  if (!current.data) return null
  return (
    <section className="flex flex-col gap-3 border-t border-line-strong pt-3">
      <div className="flex flex-col gap-0.5">
        <h2>{t('settings.publication')}</h2>
        <SettingHint id="hint-publication">{t('hint.publication')}</SettingHint>
      </div>
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
    </section>
  )
}
