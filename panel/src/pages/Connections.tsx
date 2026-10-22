import { useParams } from 'react-router'
import { FitList } from '@/components/FitList'
import { Page } from '@/components/Page'
import { PageHeader } from '@/components/PageHeader'
import { useT, type MessageKey } from '@/i18n'
import { CONNECTIONS, isConnection } from '@/lib/connections'
import { useMe } from '@/lib/queries'
import { cn } from '@/lib/utils'

/**
 * The connectors UD-012 foresees. None exists yet, and the specification keeps the view visible and off with its reason
 * (MASTER-SPEC §4.1, idea.md): the reason is said once, with the title, and each connector is a name, not a row that
 * repeats «No disponible todavía» five times (J3-A-45, UD-037). The sidebar has one entry, Conexiones; the address of a
 * connector (`/connections/api`) still opens this view with it marked.
 */
export function Connections() {
  const t = useT()
  const me = useMe().data
  const { kind } = useParams()
  const chosen = isConnection(kind) ? kind : undefined

  if (me && me.role !== 'editor') {
    return (
      <Page cols={12}>
        <PageHeader title={t('nav.connections')} />
        <p role="status" className="text-sm text-muted">
          {t('connections.editorOnly')}
        </p>
      </Page>
    )
  }

  return (
    <Page cols={12}>
      <PageHeader title={t('nav.connections')} />
      <FitList
        rows={CONNECTIONS}
        rowKey={(c) => c}
        label={t('nav.connections')}
        renderRow={(c) => (
          <div aria-current={c === chosen ? 'true' : undefined} title={t(`connections.${c}Hint` as MessageKey)} className={cn('border-b border-line px-4 py-3 font-semibold last:border-b-0', c === chosen && 'bg-selected shadow-[inset_4px_0_0_var(--color-accent)]')}>
            {t(`connections.${c}` as MessageKey)}
          </div>
        )}
      />
    </Page>
  )
}
