import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { BrowserRouter, Outlet, Route, Routes } from 'react-router'
import { Atmosphere } from '@/components/Atmosphere'
import { AlertTriangle, RotateCw } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Header } from '@/components/Header'
import { I18nProvider, detectLanguage, isLanguage, useT } from '@/i18n'
import { Sidebar } from '@/components/Sidebar'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { TooltipProvider } from '@/components/ui/tooltip'
import { api, ApiError } from '@/lib/api'
import { EventsProvider } from '@/lib/events'
import { NoticeProvider } from '@/lib/notices'
import { NoticeHost } from '@/components/NoticeHost'
import { useMe, useProject } from '@/lib/queries'
import { useSidebarHidden } from '@/lib/sidebar'
import { useDesktop } from '@/lib/useDesktop'
import { Areas } from '@/pages/Areas'
import { Connections } from '@/pages/Connections'
import { Home } from '@/pages/Home'
import { Login } from '@/pages/Login'
import { MessageDetail } from '@/pages/MessageDetail'
import { Messages } from '@/pages/Messages'
import { NotFound } from '@/pages/NotFound'
import { Settings } from '@/pages/Settings'
import { Team } from '@/pages/Team'

function Shell() {
  const t = useT()
  const me = useMe().data
  const project = useProject().data
  const queryClient = useQueryClient()
  const [navOpen, setNavOpen] = useState(false)
  const desktop = useDesktop()
  // The side panel is hidden with the button next to the user and shown again with the one in the bar; the choice is the person's (UD-047).
  const [hidden, setHidden] = useSidebarHidden(me?.id)

  const logout = async () => {
    try {
      await api('/auth/logout', { method: 'POST' })
    } finally {
      queryClient.clear()
      try {
        localStorage.removeItem('team-active-input')
      } catch {
        // Without storage there is nothing to delete.
      }
      await queryClient.invalidateQueries({ queryKey: ['me'] })
    }
  }

  return (
    <EventsProvider>
      <NoticeProvider>
      <Atmosphere />
      {/* First stop of the keyboard: past the navigation, to the content (J1-A-11). */}
      <a href="#main" className="sr-only z-50 rounded-md bg-raised px-3 py-2 text-sm font-semibold text-accent-deep focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        {t('nav.skip')}
      </a>
      <div className="relative z-10 flex h-dvh flex-col">
        <Header projectName={project?.name ?? me?.project_name} panelHidden={hidden} onOpenNav={() => (desktop ? setHidden(false) : setNavOpen(true))} />
        <NoticeHost />
        <div className="flex min-h-0 flex-1">
          {desktop && !hidden && (
            <aside data-lane="sidebar" data-testid="sidebar" className="glass scroll-thin w-64 shrink-0 overflow-y-auto border-0 border-r !shadow-none">
              <Sidebar onLogout={() => void logout()} onHide={() => setHidden(true)} />
            </aside>
          )}
          <main id="main" tabIndex={-1} className="scroll-thin min-w-0 flex-1 overflow-y-auto outline-none">
            <Outlet />
          </main>
        </div>
      </div>
      <Dialog open={navOpen} onOpenChange={setNavOpen}>
        <DialogContent side="left" title={t('nav.label')}>
          <Sidebar onNavigate={() => setNavOpen(false)} onLogout={() => void logout()} />
        </DialogContent>
      </Dialog>
      </NoticeProvider>
    </EventsProvider>
  )
}

export function App() {
  const me = useMe()
  // The language belongs to the account (UD-018); before sign-in it follows the browser's.
  const language = isLanguage(me.data?.language) ? me.data.language : detectLanguage(navigator.language)
  return (
    <I18nProvider language={language}>
      <Routed me={me} />
    </I18nProvider>
  )
}

function Routed({ me }: { me: ReturnType<typeof useMe> }) {
  const t = useT()
  if (me.isPending) return <div className="flex min-h-dvh items-center justify-center text-sm text-muted">{t('common.loading')}</div>
  if (me.isError) {
    if (me.error instanceof ApiError && me.error.status === 401) return <Login />
    return (
      <div role="alert" className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center text-sm">
        <AlertTriangle size={22} aria-hidden className="text-danger" />
        <p className="text-danger">{t('app.noServer')}</p>
        <Button onClick={() => void me.refetch()}>
          <RotateCw size={14} aria-hidden /> {t('common.retry')}
        </Button>
      </div>
    )
  }

  return (
    <TooltipProvider delayDuration={150}>
      <BrowserRouter>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<Home />} />
            <Route path="messages" element={<Messages />} />
            <Route path="messages/:id" element={<MessageDetail />} />
            <Route path="areas/:areaId?" element={<Areas />} />
            <Route path="connections/:kind?" element={<Connections />} />
            <Route path="team" element={<Team />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  )
}
