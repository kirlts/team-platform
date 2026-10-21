import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Segmented } from '@/components/Segmented'
import { useT } from '@/i18n'
import { api } from '@/lib/api'

/**
 * Publication of a send (UD-070): «Automática» publishes the messages when the analysis ends; «Manual» leaves the proposal for review and
 * Enviar. Everyone reads it, only the Editor changes it, so the section is drawn for the Editor alone. The state is the control: no sentence about its effect.
 */
export function PublicationSetting() {
  const t = useT()
  const queryClient = useQueryClient()
  const current = useQuery({ queryKey: ['publication'], queryFn: () => api<{ auto_publish: boolean }>('/settings/publication') })
  const save = useMutation({
    mutationFn: (value: boolean) => api<{ auto_publish: boolean }>('/settings/publication', { method: 'PATCH', body: { auto_publish: value } }),
    onSuccess: (saved) => queryClient.setQueryData(['publication'], saved),
  })
  if (!current.data) return null
  return (
    <section className="flex flex-col gap-3 border-t border-line-strong pt-3">
      <h2>{t('settings.publication')}</h2>
      <Segmented
        value={current.data.auto_publish ? 'auto' : 'manual'}
        onChange={(v) => save.mutate(v === 'auto')}
        label={t('settings.publication')}
        options={[
          { value: 'auto', label: t('settings.publicationAuto') },
          { value: 'manual', label: t('settings.publicationManual') },
        ]}
      />
    </section>
  )
}
