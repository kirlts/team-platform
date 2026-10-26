import { useParams } from 'react-router'
import { FitList } from '@/components/FitList'
import { Page } from '@/components/Page'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { useT, type MessageKey } from '@/i18n'
import { CONNECTIONS, isConnection } from '@/lib/connections'
import { cn } from '@/lib/utils'

/**
 * The connectors UD-012 foresees. None exists yet, and the specification keeps the view visible and off with its reason
 * (MASTER-SPEC §4.1, idea.md): the reason is said once, with the title, and each connector is a name, not a row that
 * repeats «No disponible todavía» five times (J3-A-45, UD-037). The sidebar has one entry, Conexiones; the address of a
 * connector (`/connections/api`) still opens this view with it marked.
 */
export function Connections() {
  const t = useT()
  const { kind } = useParams()
  const chosen = isConnection(kind) ? kind : undefined

  return (
    <Page cols={12}>
      {/* None of them is built yet: the state is said once, beside the title, and the rows are names that open nothing. */}
      <PageHeader title={t('nav.connections')} aside={<Badge tone="outline">{t('connections.unavailable')}</Badge>} />
      <FitList
        rows={CONNECTIONS}
        rowKey={(c) => c}
        label={t('nav.connections')}
        renderRow={(c) => (
          <div aria-current={c === chosen ? 'true' : undefined} title={t(`connections.${c}Hint` as MessageKey)} className={cn('flex min-h-12 cursor-default items-center border-b border-line px-4 py-3 text-sm font-semibold text-muted last:border-b-0', c === chosen && 'bg-selected text-accent-deep shadow-[inset_var(--nav-bar-width)_0_0_var(--color-accent)]')}>
            {t(`connections.${c}` as MessageKey)}
          </div>
        )}
      />
    </Page>
  )
}
