import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { BrowserRouter, Outlet, Route, Routes, useLocation } from 'react-router'
import { Atmosphere } from '@/components/Atmosphere'
import { AlertTriangle, RotateCw } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Header } from '@/components/Header'
import { I18nProvider, detectLanguage, isLanguage, useT } from '@/i18n'
import { Sidebar } from '@/components/Sidebar'
import { TelemetryBridge } from '@/components/TelemetryBridge'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { TooltipProvider } from '@/components/ui/tooltip'
import { TeamApiError } from '@team-platform/client'
import { EventsProvider, useLogout, useMe, useProject } from '@team-platform/client/react'
import { ROUTER_BASENAME } from '@/lib/base'
import { NoticeProvider } from '@/lib/notices'
import { NoticeHost } from '@/components/NoticeHost'
import { checkSession, saveDraftText } from '@/lib/session'
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
  const signOut = useLogout()
  const [navOpen, setNavOpen] = useState(false)
  const desktop = useDesktop()
  // The side panel is hidden with the button next to the user and shown again with the one in the bar; the choice is the person's (UD-047).
  const [hidden, setHidden] = useSidebarHidden(me?.id)
  // A screen drawn from data already in memory makes no call: asking «me» on each change of screen is what notices that the session is over.
  const { pathname } = useLocation()
  const firstPath = useRef(pathname)
  useEffect(() => {
    if (firstPath.current === pathname) return
    firstPath.current = pathname
    checkSession()
  }, [pathname])

  const logout = async () => {
    let hostLogout: string | undefined
    try {
      hostLogout = (await signOut.mutateAsync())?.logout_url
    } finally {
      // `clear()` dropped the session query from under the root's observer, which kept the old account and left the shell on screen
      // with no session: the other queries go, and the session query is reset so its observer asks again, gets 401 and draws the entry.
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' })
      try {
        localStorage.removeItem('team-active-input')
        saveDraftText('')
      } catch {
        // Without storage there is nothing to delete.
      }
      // The host has its own sign-out (LOGOUT_URL, H-3720): it is the one that leaves the person outside.
      if (hostLogout) window.location.assign(hostLogout)
      else await queryClient.resetQueries({ queryKey: ['me'] })
    }
  }

  return (
    <EventsProvider>
      <NoticeProvider>
      <TelemetryBridge />
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
          <main id="main" tabIndex={-1} className="scroll-thin min-w-0 flex-1 overflow-y-auto overflow-x-clip outline-none">
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

/** Sends the browser to the host's entry with the page it was on as `next`; draws no form. */
function GoToHost({ url }: { url: string }) {
  const t = useT()
  useEffect(() => {
    const target = new URL(url, window.location.origin)
    target.searchParams.set('next', window.location.pathname + window.location.search)
    window.location.replace(target.toString())
  }, [url])
  return <div data-screen="host-login" className="flex min-h-dvh items-center justify-center text-sm text-muted">{t('common.loading')}</div>
}

function Routed({ me }: { me: ReturnType<typeof useMe> }) {
  const t = useT()
  if (me.isPending) return <div className="flex min-h-dvh items-center justify-center text-sm text-muted">{t('common.loading')}</div>
  if (me.isError) {
    if (me.error instanceof TeamApiError && me.error.status === 401) {
      // UD-308: with a host governing identity the 401 names its entry; the form of our own is only for a deployment without host.
      const hostLogin = me.error.details.login_url
      if (typeof hostLogin === 'string' && hostLogin) return <GoToHost url={hostLogin} />
      return <Login />
    }
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
      <BrowserRouter basename={ROUTER_BASENAME}>
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
