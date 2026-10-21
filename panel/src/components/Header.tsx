import { Bell, Menu, PanelLeft } from '@/components/icons'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useFormat, useT } from '@/i18n'
import { useEventsSnapshot, useEventsStore } from '@/lib/events'
import { readThemePref, saveTheme, type ThemePref } from '@/lib/theme'
import { useNavigateTo } from './navigation'
import { useLookups } from './lookups'

/** «[Nombre] TEAM» header with the notice bell and the account menu. */
export function Header({ projectName, onOpenNav, onLogout }: { projectName?: string; onOpenNav: () => void; onLogout: () => void }) {
  const t = useT()
  const go = useNavigateTo()
  const [theme, setTheme] = useState<ThemePref>(readThemePref)

  useEffect(() => {
    const sync = () => setTheme(readThemePref())
    window.addEventListener('team-theme', sync)
    return () => window.removeEventListener('team-theme', sync)
  }, [])

  return (
    <header className="chrome-bar flex min-h-[3.5rem] shrink-0 items-center justify-between gap-2 py-1 pl-2 pr-3 md:pl-5">
      <div className="flex min-w-0 items-center gap-1">
        <Button variant="ghost" size="icon" aria-label={t('nav.open')} className="md:hidden" onClick={onOpenNav}>
          <PanelLeft size={18} aria-hidden />
        </Button>
        <Link to="/" className="flex min-w-0 items-center gap-2.5 font-[family-name:var(--font-display)] text-[1.3rem] font-extrabold uppercase tracking-[0.14em]">
          <span aria-hidden className="orb h-4 w-4 shrink-0 rounded-full" />
          <span className="min-w-0 break-words leading-tight">
            {projectName}{' '}
            <span className="text-accent-deep [text-shadow:0_1px_0_var(--color-glass-edge)]">{t('brand.name')}</span>
          </span>
        </Link>
      </div>
      <div className="flex items-center gap-0.5">
        <NotificationBell />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t('menu.label')}>
              <Menu size={18} aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => go('/settings')}>{t('nav.settings')}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              value={theme}
              onValueChange={(v) => {
                if (v === 'light' || v === 'dark' || v === 'system') saveTheme(v)
              }}
            >
              <DropdownMenuRadioItem value="light">{t('settings.themeLight')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">{t('settings.themeDark')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system">{t('settings.themeSystem')}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onLogout}>{t('nav.logout')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
  return (
    <Popover onOpenChange={(open) => open && store.markRead()}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={snap.unread > 0 ? t('bell.unread', { n: snap.unread }) : t('bell.label')} className="relative">
          <Bell size={18} aria-hidden />
          {snap.unread > 0 && (
            <span className="absolute right-0.5 top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-accent-fg">
              {snap.unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        {snap.notices.length === 0 ? (
          <p className="px-3 py-4 text-center text-muted">{t('bell.none')}</p>
        ) : (
          <ul className="max-h-80 overflow-y-auto">
            {snap.notices.map((n) => (
              <li key={n.key} className="border-b border-line last:border-b-0">
                <Link to={`/messages/${n.message_id}`} className="flex flex-col gap-0.5 px-3 py-2 hover:bg-hover">
                  <span className="break-words text-[13px] font-medium">{n.title}</span>
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
