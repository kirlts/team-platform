import { Bell, Menu, PanelLeft } from '@/components/icons'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useEventsSnapshot, useEventsStore } from '@/lib/events'
import { stamp } from '@/lib/format'
import { saveTheme } from '@/lib/theme'
import { useNavigateTo } from './navigation'
import { useLookups } from './lookups'

/** Cabecera «[Nombre] TEAM» con la campana de avisos y el menú de la cuenta. */
export function Header({ projectName, onOpenNav, onLogout }: { projectName?: string; onOpenNav: () => void; onLogout: () => void }) {
  const go = useNavigateTo()
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? 'light')

  useEffect(() => {
    const sync = () => setTheme(document.documentElement.dataset.theme ?? 'light')
    window.addEventListener('team-theme', sync)
    return () => window.removeEventListener('team-theme', sync)
  }, [])

  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-line bg-raised pl-2 pr-2 md:pl-4">
      <div className="flex min-w-0 items-center gap-1">
        <Button variant="ghost" size="icon" aria-label="Abrir navegación" className="md:hidden" onClick={onOpenNav}>
          <PanelLeft size={18} aria-hidden />
        </Button>
        <Link to="/" className="min-w-0 truncate text-lg font-bold uppercase tracking-wide">
          {projectName} <span className="text-accent">Team</span>
        </Link>
      </div>
      <div className="flex items-center gap-0.5">
        <NotificationBell />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Menú">
              <Menu size={18} aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => go('/settings')}>Ajustes</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              value={theme}
              onValueChange={(v) => {
                if (v === 'light' || v === 'dark') saveTheme(v)
              }}
            >
              <DropdownMenuRadioItem value="light">Claro</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">Oscuro</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onLogout}>Cerrar sesión</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}

function NotificationBell() {
  const snap = useEventsSnapshot()
  const store = useEventsStore()
  const { memberName } = useLookups()
  return (
    <Popover onOpenChange={(open) => open && store.markRead()}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={snap.unread > 0 ? `Avisos, ${snap.unread} sin leer` : 'Avisos'} className="relative">
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
          <p className="px-3 py-4 text-center text-muted">Sin avisos</p>
        ) : (
          <ul className="max-h-80 overflow-y-auto">
            {snap.notices.map((n) => (
              <li key={n.key} className="border-b border-line last:border-b-0">
                <Link to={`/messages/${n.message_id}`} className="flex flex-col gap-0.5 px-3 py-2 hover:bg-hover">
                  <span className="truncate text-[13px] font-medium">{n.title}</span>
                  <span className="text-xs text-muted">
                    {memberName(n.author_id)} · {stamp(n.at)}
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
