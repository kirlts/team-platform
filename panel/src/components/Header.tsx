import { Bell, PanelLeft } from '@/components/icons'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useFormat, useT } from '@/i18n'
import { StatusBar } from '@/components/StatusBar'
import { useEventsSnapshot, useEventsStore } from '@team-platform/client/react'
import { cn } from '@/lib/utils'
import { Wordmark } from './Wordmark'
import { useLookups } from './lookups'

/**
 * «[Nombre] TEAM» header with the status bar (what is pending, UD-100) and the notice bell. Configuración, the theme and the sign-out live in the sidebar and in
 * Configuración, which on a phone is the drawer this bar opens: a menu here would be a second way to each of them (J2-A-38, J2-A-40).
 * On a phone the menu button, the three marks and the bell are drawn smaller than their 44 px touch area (a frame that `after` extends beyond the box,
 * as the × of the chips does), so the brand keeps the room for its longest word at 360 px.
 */
export function Header({ projectName, panelHidden = false, onOpenNav }: { projectName?: string; panelHidden?: boolean; onOpenNav: () => void }) {
  const t = useT()

  return (
    <header className="chrome-bar flex min-h-[3.5rem] shrink-0 items-center justify-between gap-1 py-1 pl-1 pr-2 max-[380px]:gap-0 max-[380px]:pr-1 md:gap-2 md:pl-5 md:pr-3">
      <div className="flex min-w-0 items-center gap-1">
        {/* A phone opens the menu with it; from 768 px it only appears while the side panel is hidden, and shows it again. */}
        <Button variant="ghost" size="icon" data-testid="nav-open" aria-label={panelHidden ? t('sidebar.show') : t('nav.open')} className={cn("relative h-9 w-9 after:absolute after:-inset-[5px] after:content-[''] md:h-11 md:w-11 md:after:hidden", !panelHidden && 'md:hidden')} onClick={onOpenNav}>
          <PanelLeft size={18} aria-hidden />
        </Button>
        {/* The brand is one line, so the box is short: the 44 px touch area is the frame that `after` draws around it, centered on the line (J3-D3-04). */}
        <Link to="/" data-testid="brand-link" className="relative min-w-0 after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-['']">
          <Wordmark project={projectName} name={t('brand.name')} />
        </Link>
      </div>
      <div className="flex shrink-0 items-center justify-end gap-1.5 md:gap-1 md:pl-2">
        <StatusBar />
        <NotificationBell />
      </div>
    </header>
  )
}

/**
 * The bell is for news: the messages that arrived while the panel was open (UD-100). It does not count what is pending: that is the status
 * bar next to it, so the two never say the same thing. Its only mark is how many news have not been read.
 */
function NotificationBell() {
  const t = useT()
  const format = useFormat()
  const snap = useEventsSnapshot()
  const store = useEventsStore()
  const { memberName } = useLookups()
  return (
    <Popover onOpenChange={(open) => open && store.markRead()}>
      <PopoverTrigger asChild>
        {/* The box is 36 px so the brand keeps its room; the touch area is 44 px (the frame drawn by `after`), as in the × of the chips. */}
        <button
          type="button"
          data-testid="bell"
          data-unread={snap.unread}
          aria-label={snap.unread > 0 ? t('bell.unread', { n: snap.unread }) : t('bell.label')}
          title={t('bell.label')}
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-full text-fg after:absolute after:-inset-1 after:content-[''] hover:bg-glass md:h-10 md:w-10 md:after:inset-0"
        >
          <Bell size={22} aria-hidden strokeWidth={2} />
          {snap.unread > 0 && (
            <span aria-hidden data-testid="bell-unread" className="absolute -right-0.5 -top-0.5 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-fg px-1 text-xs font-bold leading-none tabular-nums text-bg">
              {snap.unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      {/* Below the bar with room between them, and never taller than the space that is left: on a phone the list scrolls inside instead of being cut (J3-A-13, J3-A-15). */}
      <PopoverContent align="end" sideOffset={12} collisionPadding={8} className="flex max-h-[var(--radix-popover-content-available-height)] w-80 flex-col p-0">
        {snap.notices.length === 0 ? (
          <p className="px-3 py-4 text-center text-muted">{t('bell.none')}</p>
        ) : (
          <ul data-lane="bell-list" aria-label={t('bell.label')} className="scroll-thin min-h-0 flex-1 overflow-y-auto">
            {snap.notices.map((n) => (
              <li key={n.key} className="border-b border-line last:border-b-0">
                <Link to={`/messages/${n.message_id}`} className="flex flex-col gap-0.5 px-3 py-2 hover:bg-hover">
                  <span className="break-words text-sm font-medium">{n.title}</span>
                  <span className="text-xs text-muted">
                    {n.reason === 'mention' ? t('bell.mention', { name: memberName(n.author_id) }) : memberName(n.author_id)} · {format.stamp(n.at)}
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
