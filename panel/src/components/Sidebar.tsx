import { ChevronDown, Home, Inbox, Layers, LogOut, Plug, Plus, Settings, Users } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { NavLink, useMatch } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAreas, useMe, useSaveArea } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { Avatar } from './Avatar'
import { FormDialog } from './FormDialog'

const row =
  'flex min-h-8 items-center gap-2 rounded-md px-2 py-1 text-sm text-fg transition-colors hover:bg-hover'
const active = 'bg-accent-soft font-medium text-accent hover:bg-accent-soft'

function Item({ to, icon, children, end, onNavigate }: { to: string; icon: ReactNode; children: ReactNode; end?: boolean; onNavigate?: () => void }) {
  return (
    <NavLink to={to} end={end} onClick={onNavigate} className={({ isActive }) => cn(row, isActive && active)}>
      {icon}
      <span className="truncate">{children}</span>
    </NavLink>
  )
}

/** Barra lateral: usuario, vistas, áreas con su conteo de abiertos (Editor) y Configuración al pie. */
export function Sidebar({ onNavigate, onLogout }: { onNavigate?: () => void; onLogout: () => void }) {
  const me = useMe().data
  const areas = useAreas()
  const saveArea = useSaveArea()
  const editor = me?.role === 'editor'
  const inAreas = !!useMatch('/areas/*')
  const [areasOpen, setAreasOpen] = useState(true)
  const [creating, setCreating] = useState(false)

  return (
    <nav aria-label="Navegación" className="flex h-full flex-col gap-0.5 p-2">
      <div className="mb-2 flex items-center gap-2 border-b border-line px-2 pb-3 pt-1">
        <Avatar name={me?.name ?? '?'} size={28} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{me?.name}</span>
        <button
          type="button"
          onClick={onLogout}
          aria-label="Cerrar sesión"
          title="Cerrar sesión"
          className="rounded-md p-1.5 text-muted hover:bg-hover hover:text-fg"
        >
          <LogOut size={16} aria-hidden />
        </button>
      </div>

      <Item to="/" end icon={<Home size={16} aria-hidden />} onNavigate={onNavigate}>
        Inicio
      </Item>
      <Item to="/messages" icon={<Inbox size={16} aria-hidden />} onNavigate={onNavigate}>
        Mensajes
      </Item>

      {editor && (
        <div>
          <div className="flex items-center">
            <NavLink
              to="/areas"
              onClick={onNavigate}
              className={() => cn(row, 'flex-1', inAreas && 'font-medium text-accent')}
            >
              <Layers size={16} aria-hidden />
              <span className="truncate">Áreas</span>
            </NavLink>
            <button
              type="button"
              aria-label="Nueva área"
              onClick={() => setCreating(true)}
              className="rounded-md p-1.5 text-muted hover:bg-hover hover:text-fg"
            >
              <Plus size={15} aria-hidden />
            </button>
            <button
              type="button"
              aria-label={areasOpen ? 'Plegar áreas' : 'Desplegar áreas'}
              aria-expanded={areasOpen}
              onClick={() => setAreasOpen((v) => !v)}
              className="rounded-md p-1.5 text-muted hover:bg-hover hover:text-fg"
            >
              <ChevronDown size={15} aria-hidden className={cn('transition-transform', !areasOpen && '-rotate-90')} />
            </button>
          </div>
          {areasOpen && (
            <ul className="ml-4 flex flex-col border-l border-line pl-1.5">
              {(areas.data ?? []).map((a) => (
                <li key={a.id}>
                  <NavLink
                    to={`/areas/${a.id}`}
                    onClick={onNavigate}
                    className={({ isActive }) => cn(row, 'min-h-7 text-[13px]', isActive && active)}
                  >
                    <span className="min-w-0 flex-1 truncate">{a.title}</span>
                    {(a.open_count ?? 0) > 0 && (
                      <Badge tone="accent" aria-label={`${a.open_count} abiertos`}>
                        {a.open_count}
                      </Badge>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Item to="/team" icon={<Users size={16} aria-hidden />} onNavigate={onNavigate}>
        Equipo
      </Item>

      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="link"
            aria-disabled="true"
            tabIndex={0}
            className={cn(row, 'cursor-not-allowed text-faint hover:bg-transparent')}
          >
            <Plug size={16} aria-hidden />
            <span className="min-w-0 flex-1 truncate">Conexiones</span>
            <Badge tone="outline">Apagada</Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent side="right">Se activa cuando la descomposición se pruebe con cualquier procedencia de input.</TooltipContent>
      </Tooltip>

      <div className="mt-auto border-t border-line pt-2">
        <Item to="/settings" icon={<Settings size={16} aria-hidden />} onNavigate={onNavigate}>
          Configuración
        </Item>
      </div>

      <FormDialog
        open={creating}
        onOpenChange={setCreating}
        title="Nueva área"
        submitLabel="Crear"
        fields={[
          { name: 'title', label: 'Título', required: true, maxLength: 64 },
          { name: 'description', label: 'Descripción', multiline: true, required: true, maxLength: 1024 },
        ]}
        onSubmit={(v) => saveArea.mutateAsync({ title: v.title, description: v.description })}
      />
    </nav>
  )
}
