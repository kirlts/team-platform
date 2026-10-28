import { AlertTriangle, RotateCw } from '@/components/icons'
import { Button } from '@/components/ui/button'
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
  // The box exists while the setting loads and when it fails, with the height it will have: nothing under it moves when the answer arrives, and a missing setting says so.
  if (!current.data) {
    return (
      <SettingsBox
        data-publication
        title={t('settings.publication')}
        aside={
          current.isError ? (
            <span role="alert" className="inline-flex min-h-8 items-center gap-2 text-sm text-danger">
              <AlertTriangle size={16} aria-hidden /> {t('common.loadFailedShort')}
              <Button size="sm" onClick={() => void current.refetch()}>
                <RotateCw size={14} aria-hidden /> {t('common.retry')}
              </Button>
            </span>
          ) : (
            <span role="status" aria-label={t('common.loading')} className="well opt-track inline-flex self-start rounded-full p-0.5">
              <span aria-hidden className="block h-7 w-48 pointer-coarse:h-11" />
            </span>
          )
        }
      />
    )
  }
  return (
    <SettingsBox
      title={t('settings.publication')}
      aside={
        <Segmented
          value={current.data.auto_publish ? 'auto' : 'manual'}
          onChange={(v) => save.mutate(v === 'auto')}
          label={t('settings.publication')}
          options={[
            { value: 'auto', label: t('settings.publicationAuto') },
            { value: 'manual', label: t('settings.publicationManual') },
          ]}
        />
      }
    />
  )
}
