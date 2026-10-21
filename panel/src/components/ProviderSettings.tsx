import { useT } from '@/i18n'

/** Section «Proveedores» of Configuración (connections, keys and functions). Filled in by the next commits. */
export function ProviderSettings() {
  const t = useT()
  return (
    <section className="flex min-w-0 flex-col gap-3 border-t border-line-strong pt-3">
      <h2>{t('settings.providers')}</h2>
    </section>
  )
}
