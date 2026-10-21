import { Bell, PanelLeft } from '@/components/icons'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useFormat, useT } from '@/i18n'
import { ToneIcon } from '@/components/NotifyBadge'
import { useEventsSnapshot, useEventsStore } from '@/lib/events'
import { mineCounts } from '@/lib/pending'
import { topTone, toneTotal } from '@/lib/priority'
import { useSummary } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { Wordmark } from './Wordmark'
import { useLookups } from './lookups'

/**
 * «[Nombre] TEAM» header with the notice bell. Configuración, the theme and the sign-out live in the sidebar and in
 * Configuración, which on a phone is the drawer this bar opens: a menu here would be a second way to each of them (J2-A-38, J2-A-40).
 */
export function Header({ projectName, onOpenNav }: { projectName?: string; onOpenNav: () => void }) {
  const t = useT()

  return (
    <header className="chrome-bar flex min-h-[3.5rem] shrink-0 items-center justify-between gap-2 py-1 pl-2 pr-3 md:pl-5">
      <div className="flex min-w-0 items-center gap-1">
        <Button variant="ghost" size="icon" aria-label={t('nav.open')} className="md:hidden" onClick={onOpenNav}>
          <PanelLeft size={18} aria-hidden />
        </Button>
        <Link to="/" className="min-w-0">
          <Wordmark project={projectName} name={t('brand.name')} />
        </Link>
      </div>
      <div className="flex items-center gap-0.5">
        <NotificationBell />
      </div>
    </header>
  )
}

function NotificationBell() {
  const t = useT()
  const format = useFormat()
  const snap = useEventsSnapshot()
  const store = useEventsStore()
  const { memberName } = useLookups()
  const summary = useSummary().data
  // The bell counts what affects me; news from the stream (blue) count only while nothing else does, so nothing is counted twice.
  const mine = mineCounts(summary)
  const counts = toneTotal(mine) > 0 ? mine : snap.unread > 0 ? { blue: snap.unread } : {}
  const tone = topTone(counts)
  const total = toneTotal(counts)
  return (
    <Popover onOpenChange={(open) => open && store.markRead()}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="bell"
          data-tone={tone ?? undefined}
          data-count={total}
          aria-label={total > 0 ? t('bell.unread', { n: total }) : t('bell.label')}
          className={cn(
            'inline-flex h-10 items-center justify-center gap-1.5 rounded-full border-2',
            tone ? 'min-w-[4.25rem] px-3 shadow-glass' : 'w-10 border-transparent text-fg hover:bg-glass',
          )}
        >
          <Bell size={22} aria-hidden strokeWidth={2} />
          {tone && (
            <>
              <ToneIcon tone={tone} size={15} />
              <span className="text-sm font-bold leading-none tabular-nums">{total}</span>
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        {snap.notices.length === 0 ? (
          <p className="px-3 py-4 text-center text-muted">{t('bell.none')}</p>
        ) : (
          <ul className="max-h-80 overflow-y-auto">
            {snap.notices.map((n) => (
              <li key={n.key} className="border-b border-line last:border-b-0">
                <Link to={`/messages/${n.message_id}`} className="flex flex-col gap-0.5 px-3 py-2 hover:bg-hover">
                  <span className="break-words text-sm font-medium">{n.title}</span>
                  <span className="text-xs text-muted">
                    {memberName(n.author_id)} · {format.stamp(n.at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
