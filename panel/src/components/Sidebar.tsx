import { ChevronDown, Home, Inbox, Layers, LogOut, Plug, Plus, Settings, Users } from '@/components/icons'
import { useState, type ReactNode } from 'react'
import { NavLink, useMatch } from 'react-router'
import { Link } from 'react-router'
import { NotifyBadge } from '@/components/NotifyBadge'
import { useT, type MessageKey } from '@/i18n'
import { areaMessagesPath, areaPendingCounts, mineCounts } from '@/lib/pending'
import type { MessageSummary } from '@/lib/types'
import { useAreas, useMe, useSaveArea, useSummary } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { Avatar } from './Avatar'
import { FormDialog } from './FormDialog'

import { CONNECTIONS } from '@/lib/connections'

const row =
  'flex min-h-9 items-center gap-2.5 rounded-md border border-transparent px-3 py-1.5 text-sm font-medium text-fg transition-colors duration-150 hover:bg-glass'
/** What is selected looks the same everywhere (J2-A-41): the `selected` fill and the accent bar on the edge, as the rows of Áreas. */
const active = 'bg-selected font-semibold shadow-[inset_4px_0_0_var(--color-accent)] hover:bg-selected'

function Item({ to, icon, children, end, onNavigate, badge }: { to: string; icon: ReactNode; children: ReactNode; end?: boolean; onNavigate?: () => void; badge?: ReactNode }) {
  return (
    <NavLink to={to} end={end} onClick={onNavigate} className={({ isActive }) => cn(row, isActive && active)}>
      {icon}
      <span className="min-w-0 flex-1 break-words leading-tight">{children}</span>
      {badge}
    </NavLink>
  )
}

/** Sidebar: user, views, areas with what is pending in each (Editor) and Configuración at the foot. */
export function Sidebar({ onNavigate, onLogout }: { onNavigate?: () => void; onLogout: () => void }) {
  const t = useT()
  const me = useMe().data
  const areas = useAreas()
  const summary = useSummary().data
  const mine = mineCounts(summary)
  const saveArea = useSaveArea()
  const editor = me?.role === 'editor'
  const inAreas = !!useMatch('/areas/*')
  const [areasOpen, setAreasOpen] = useState(true)
  const [creating, setCreating] = useState(false)
  const inConnections = !!useMatch('/connections/*')
  const [connectionsOpen, setConnectionsOpen] = useState(inConnections)

  return (
    <nav aria-label={t('nav.label')} className="flex h-full min-h-0 flex-col gap-1 p-3">
      <div className="mb-3 flex shrink-0 items-center gap-2.5 border-b border-line px-2 pb-3 pt-1">
        <Avatar name={me?.name ?? '?'} size={30} />
        <span className="min-w-0 flex-1 break-words text-sm font-medium leading-tight">{me?.name}</span>
        <button type="button" onClick={onLogout} className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs text-muted hover:bg-glass hover:text-fg">
          <LogOut size={14} aria-hidden /> {t('nav.logout')}
        </button>
      </div>

      <Item to="/" end icon={<Home size={16} aria-hidden />} onNavigate={onNavigate}>
        {t('nav.home')}
      </Item>
      <Item to="/messages" icon={<Inbox size={16} aria-hidden />} onNavigate={onNavigate} badge={<NotifyBadge counts={mine} data-testid="messages-badge" />}>
        {t('nav.messages')}
      </Item>

      {editor && (
        <div className="flex min-h-0 shrink flex-col">
          <div className="flex shrink-0 items-center">
            <NavLink to="/areas" onClick={onNavigate} className={() => cn(row, 'flex-1', inAreas && 'text-accent-deep')}>
              <Layers size={16} aria-hidden />
              <span className="min-w-0 break-words leading-tight">{t('nav.areas')}</span>
            </NavLink>
            <button type="button" aria-label={t('nav.newArea')} onClick={() => setCreating(true)} className="rounded-full p-1.5 text-muted hover:bg-glass hover:text-fg">
              <Plus size={15} aria-hidden />
            </button>
            <button
              type="button"
              aria-label={areasOpen ? t('nav.foldAreas') : t('nav.unfoldAreas')}
              aria-expanded={areasOpen}
              onClick={() => setAreasOpen((v) => !v)}
              className="rounded-full p-1.5 text-muted hover:bg-glass hover:text-fg"
            >
              <ChevronDown size={15} aria-hidden className={cn('transition-transform', !areasOpen && '-rotate-90')} />
            </button>
          </div>
          {areasOpen && (
            // With many areas the list scrolls inside: it is a declared lane, not the page.
            <ul data-lane="areas-nav" className="scroll-thin ml-3 mt-0.5 flex min-h-0 flex-col gap-0.5 overflow-y-auto border-l border-line-strong pl-1">
              {(areas.data ?? []).map((a) => (
                <li key={a.id} className="flex items-center gap-1">
                  <NavLink to={`/areas/${a.id}`} onClick={onNavigate} className={({ isActive }) => cn(row, 'min-h-8 min-w-0 flex-1 text-sm', isActive && active)}>
                    <span className="min-w-0 flex-1 break-words leading-tight">{a.title}</span>
                  </NavLink>
                  <AreaPending areaId={a.id} title={a.title} summary={summary} onNavigate={onNavigate} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Item to="/team" icon={<Users size={16} aria-hidden />} onNavigate={onNavigate}>
        {t('nav.team')}
      </Item>

      <div className="mt-auto flex shrink-0 flex-col gap-1 border-t border-line pt-3">
      {editor && (
        // The group of the mockup (API, MCP, Correo...): each one is a destination (J2-A-34), and every one says it is not available yet.
        <div>
          <div className="flex items-center">
            <NavLink to="/connections" end onClick={onNavigate} className={({ isActive }) => cn(row, 'flex-1', isActive && active)}>
              <Plug size={16} aria-hidden className="shrink-0" />
              <span className="min-w-0 flex-1 leading-tight">{t('nav.connections')}</span>
            </NavLink>
            <button
              type="button"
              aria-label={connectionsOpen ? t('nav.foldConnections') : t('nav.unfoldConnections')}
              aria-expanded={connectionsOpen}
              onClick={() => setConnectionsOpen((v) => !v)}
              className="rounded-full p-1.5 text-muted hover:bg-glass hover:text-fg"
            >
              <ChevronDown size={15} aria-hidden className={cn('transition-transform', !connectionsOpen && '-rotate-90')} />
            </button>
          </div>
          {connectionsOpen && (
            <ul className="ml-3 mt-0.5 flex flex-col gap-0.5 border-l border-line-strong pl-1">
              {CONNECTIONS.map((c) => (
                <li key={c}>
                  <NavLink to={`/connections/${c}`} onClick={onNavigate} className={({ isActive }) => cn(row, 'min-h-8 text-sm', isActive && active)}>
                    {t(`connections.${c}` as MessageKey)}
                  </NavLink>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

        <Item to="/settings" icon={<Settings size={16} aria-hidden />} onNavigate={onNavigate}>
          {t('nav.settings')}
        </Item>
      </div>

      <FormDialog
        open={creating}
        onOpenChange={setCreating}
        title={t('areas.new')}
        submitLabel={t('common.create')}
        fields={[
          { name: 'title', label: t('areas.fieldTitle'), required: true, maxLength: 64 },
          { name: 'description', label: t('areas.fieldDescription'), multiline: true, required: true, maxLength: 1024 },
        ]}
        onSubmit={(v) => saveArea.mutateAsync({ title: v.title, description: v.description })}
      />
    </nav>
  )
}

/** The pending (open) messages of an area; it leads to Mensajes filtered by that area and by open (UD-028). */
function AreaPending({ areaId, title, summary, onNavigate }: { areaId: string; title: string; summary: MessageSummary | undefined; onNavigate?: () => void }) {
  const t = useT()
  const counts = areaPendingCounts(summary, areaId)
  const open = counts.red ?? counts.yellow ?? 0
  if (open === 0) return null
  return (
    <Link to={areaMessagesPath(areaId)} onClick={onNavigate} aria-label={t('home.areaOpen', { title, n: open })} className="rounded-full">
      <NotifyBadge counts={counts} size="md" />
    </Link>
  )
}
