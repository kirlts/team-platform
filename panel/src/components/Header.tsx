import { Bell, PanelLeft } from '@/components/icons'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useFormat, useT } from '@/i18n'
import { StateIcon, StateMark, useCountsLabel } from '@/components/NotifyBadge'
import { ME } from '@/lib/filters'
import { useEventsSnapshot, useEventsStore } from '@/lib/events'
import { mineCounts } from '@/lib/pending'
import { stateTotal, topState } from '@/lib/states'
import { useSummary } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { Wordmark } from './Wordmark'
import { useLookups } from './lookups'

/**
 * «[Nombre] TEAM» header with the notice bell. Configuración, the theme and the sign-out live in the sidebar and in
 * Configuración, which on a phone is the drawer this bar opens: a menu here would be a second way to each of them (J2-A-38, J2-A-40).
 */
export function Header({ projectName, panelHidden = false, onOpenNav }: { projectName?: string; panelHidden?: boolean; onOpenNav: () => void }) {
  const t = useT()

  return (
    <header className="chrome-bar flex min-h-[3.5rem] shrink-0 items-center justify-between gap-2 py-1 pl-2 pr-3 md:pl-5">
      <div className="flex min-w-0 items-center gap-1">
        {/* A phone opens the menu with it; from 768 px it only appears while the side panel is hidden, and shows it again. */}
        <Button variant="ghost" size="icon" data-testid="nav-open" aria-label={panelHidden ? t('sidebar.show') : t('nav.open')} className={cn('h-11 w-11', !panelHidden && 'md:hidden')} onClick={onOpenNav}>
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
  const countsLabel = useCountsLabel()
  // The bell counts the open and answered messages that affect me (UD-028, UD-041); closed ones raise no notice.
  const counts = mineCounts(summary)
  const status = topState(counts)
  const total = stateTotal(counts)
  const listed = total > 0 && (summary?.items.length ?? 0) > 0
  return (
    <Popover onOpenChange={(open) => open && store.markRead()}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="bell"
          data-status={status ?? undefined}
          data-weight="solid"
          data-count={total}
          aria-label={total > 0 ? t('bell.counts', { counts: countsLabel(counts) }) : t('bell.label')}
          className={cn(
            'inline-flex h-10 items-center justify-center gap-1.5 rounded-full border-2',
            status ? 'min-w-[4.25rem] px-3 shadow-glass' : 'w-10 border-transparent text-fg hover:bg-glass',
          )}
        >
          <Bell size={22} aria-hidden strokeWidth={2} />
          {status && (
            <>
              <StateIcon status={status} size={15} />
              <span className="text-sm font-bold leading-none tabular-nums">{total}</span>
            </>
          )}
        </button>
      </PopoverTrigger>
      {/* Below the bar with room between them, and never taller than the space that is left: on a phone the list scrolls inside instead of being cut (J3-A-13, J3-A-15). */}
      <PopoverContent align="end" sideOffset={12} collisionPadding={8} className="flex max-h-[var(--radix-popover-content-available-height)] w-80 flex-col p-0">
        {listed ? (
          // What the number counts, message by message: the bell lists exactly its own count (J2-A-43). The priority is its shape, not a word repeated on every row (J3-A-14).
          <>
            <ul data-lane="bell-list" className="scroll-thin min-h-0 flex-1 overflow-y-auto" aria-label={t('bell.label')}>
              {(summary?.items ?? []).map((n) => (
                <li key={n.message_id} className="border-b border-line">
                  <Link to={`/messages/${n.message_id}`} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2 px-3 py-2 hover:bg-hover">
                    <span className="pt-0.5">
                      <StateMark status={n.status} plain />
                    </span>
                    <span className="break-words text-sm font-medium leading-snug">{n.title}</span>
                    <span className="col-start-2 text-xs text-muted">{format.stamp(n.at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
            {/* The list is as long as the number: when it does not all fit, this says where the rest is. */}
            <Link to={`/messages?f=for:eq:${ME}`} className="flex shrink-0 items-center justify-between gap-2 px-3 py-2 text-sm font-semibold text-accent-deep hover:bg-hover">
              {t('bell.seeAll')}
              <span className="tabular-nums text-muted">{total}</span>
            </Link>
          </>
        ) : snap.notices.length === 0 ? (
          <p className="px-3 py-4 text-center text-muted">{t('bell.none')}</p>
        ) : (
          <ul className="scroll-thin min-h-0 flex-1 overflow-y-auto">
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
