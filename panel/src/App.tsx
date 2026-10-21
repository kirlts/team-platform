import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { BrowserRouter, Outlet, Route, Routes } from 'react-router'
import { Atmosphere } from '@/components/Atmosphere'
import { Header } from '@/components/Header'
import { I18nProvider, detectLanguage, isLanguage, useT } from '@/i18n'
import { Sidebar } from '@/components/Sidebar'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { TooltipProvider } from '@/components/ui/tooltip'
import { api, ApiError } from '@/lib/api'
import { EventsProvider } from '@/lib/events'
import { useMe, useProject } from '@/lib/queries'
import { Areas } from '@/pages/Areas'
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
      <Atmosphere />
      {/* First stop of the keyboard: past the navigation, to the content (J1-A-11). */}
      <a href="#main" className="sr-only z-50 rounded-md bg-raised px-3 py-2 text-sm font-semibold text-accent-deep focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        {t('nav.skip')}
      </a>
      <div className="relative z-10 flex h-dvh flex-col">
        <Header projectName={project?.name ?? me?.project_name} onOpenNav={() => setNavOpen(true)} onLogout={() => void logout()} />
        <div className="flex min-h-0 flex-1">
          <aside data-lane="sidebar" className="glass scroll-thin hidden w-72 shrink-0 overflow-y-auto border-0 border-r !shadow-none md:block">
            <Sidebar onLogout={() => void logout()} />
          </aside>
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
      <div role="alert" className="flex min-h-dvh items-center justify-center px-4 text-center text-sm text-danger">
        {t('app.noServer')}
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
            <Route path="team" element={<Team />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  )
}
