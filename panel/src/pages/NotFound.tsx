import { Link } from 'react-router'
import { EmptyState } from '@/components/EmptyState'
import { Page } from '@/components/Page'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'

/** An address the panel does not know: it says so, instead of silently showing Inicio (J1-A-10). */
export function NotFound() {
  const t = useT()
  return (
    <Page cols={12}>
      <PageHeader title={t('notFound.title')} />
      <EmptyState
        className="glass leaf !py-6"
        action={
          <Button asChild variant="primary" size="lg">
            <Link to="/">{t('notFound.home')}</Link>
          </Button>
        }
      >
        {t('notFound.text')}
      </EmptyState>
    </Page>
  )
}
