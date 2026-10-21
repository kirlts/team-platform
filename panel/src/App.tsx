import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router'
import { Header } from '@/components/Header'
import { Sidebar } from '@/components/Sidebar'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { TooltipProvider } from '@/components/ui/tooltip'
import { api, ApiError } from '@/lib/api'
import { EventsProvider } from '@/lib/events'
import { useMe } from '@/lib/queries'
import { Areas } from '@/pages/Areas'
import { Home } from '@/pages/Home'
import { Login } from '@/pages/Login'
import { MessageDetail } from '@/pages/MessageDetail'
import { Messages } from '@/pages/Messages'
import { Settings } from '@/pages/Settings'
import { Team } from '@/pages/Team'

function Shell() {
  const me = useMe().data
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
        // Sin almacenamiento no hay nada que borrar.
      }
      await queryClient.invalidateQueries({ queryKey: ['me'] })
    }
  }

  return (
    <EventsProvider>
      <div className="flex h-dvh flex-col">
        <Header projectName={me?.project_name} onOpenNav={() => setNavOpen(true)} onLogout={() => void logout()} />
        <div className="flex min-h-0 flex-1">
          <aside className="scroll-thin hidden w-56 shrink-0 overflow-y-auto border-r border-line bg-surface md:block">
            <Sidebar onLogout={() => void logout()} />
          </aside>
          <main className="scroll-thin min-w-0 flex-1 overflow-y-auto">
            <Outlet />
          </main>
        </div>
      </div>
      <Dialog open={navOpen} onOpenChange={setNavOpen}>
        <DialogContent side="left" title="Navegación" className="bg-surface">
          <Sidebar onNavigate={() => setNavOpen(false)} onLogout={() => void logout()} />
        </DialogContent>
      </Dialog>
    </EventsProvider>
  )
}

export function App() {
  const me = useMe()

  if (me.isPending) return <div className="flex min-h-dvh items-center justify-center text-sm text-muted">Cargando</div>
  if (me.isError) {
    if (me.error instanceof ApiError && me.error.status === 401) return <Login />
    return (
      <div role="alert" className="flex min-h-dvh items-center justify-center px-4 text-center text-sm text-danger">
        No se pudo conectar con el servidor
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
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  )
}
