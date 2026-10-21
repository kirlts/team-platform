import { useNavigate, useParams } from 'react-router'
import { FitList } from '@/components/FitList'
import { Page } from '@/components/Page'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { useT, type MessageKey } from '@/i18n'
import { CONNECTIONS, isConnection } from '@/lib/connections'
import { useMe } from '@/lib/queries'
import { cn } from '@/lib/utils'

/**
 * The connectors UD-012 foresees, each with its state. None exists yet, so each one says «No disponible todavía»:
 * the sidebar's entries lead here and the one chosen is marked, like a row of Áreas (J2-A-34).
 */
export function Connections() {
  const t = useT()
  const me = useMe().data
  const { kind } = useParams()
  const navigate = useNavigate()
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
          <button
            type="button"
            aria-current={c === chosen ? 'true' : undefined}
            onClick={() => navigate(`/connections/${c}`)}
            className={cn('flex w-full items-center justify-between gap-4 border-b border-line px-4 py-3 text-left last:border-b-0 hover:bg-hover', c === chosen && 'bg-selected shadow-[inset_4px_0_0_var(--color-accent)]')}
          >
            <span className="font-semibold">{t(`connections.${c}` as MessageKey)}</span>
            <Badge tone="closed">{t('nav.connectionsReason')}</Badge>
          </button>
        )}
      />
    </Page>
  )
}
