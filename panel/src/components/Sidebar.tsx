import { ChevronDown, Home, Inbox, Layers, LogOut, Plug, Plus, Settings, Users } from '@/components/icons'
import { useState, type ReactNode } from 'react'
import { NavLink, useMatch } from 'react-router'
import { Link } from 'react-router'
import { NotifyBadge } from '@/components/NotifyBadge'
import { useT } from '@/i18n'
import { areaMessagesPath, areaPendingCounts, mineCounts } from '@/lib/pending'
import type { MessageSummary } from '@/lib/types'
import { useAreas, useMe, useSaveArea, useSummary } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { Avatar } from './Avatar'
import { FormDialog } from './FormDialog'

/** The connections UD-012 names; none can be used yet. */
const CONNECTIONS = ['connections.api', 'connections.mcp', 'connections.email', 'connections.whatsapp', 'connections.github'] as const

const row =
  'flex min-h-9 items-center gap-2.5 rounded-[1.125rem] border border-transparent px-3 py-1.5 text-[0.95rem] font-medium text-fg transition-colors duration-150 hover:bg-glass'
const active = 'border-glass-line bg-[linear-gradient(180deg,var(--color-glass-edge),var(--color-glass))] text-accent-deep shadow-glass hover:bg-glass-edge'

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
  const [connectionsOpen, setConnectionsOpen] = useState(false)

  return (
    <nav aria-label={t('nav.label')} className="flex h-full min-h-0 flex-col gap-1 p-3">
      <div className="mb-3 flex shrink-0 items-center gap-2.5 border-b border-line px-2 pb-3 pt-1">
        <Avatar name={me?.name ?? '?'} size={30} />
        <span className="min-w-0 flex-1 break-words text-sm font-medium leading-tight">{me?.name}</span>
        <button type="button" onClick={onLogout} aria-label={t('nav.logout')} title={t('nav.logout')} className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted hover:bg-glass hover:text-fg">
          <LogOut size={14} aria-hidden /> {t('nav.logoutShort')}
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
            <ul data-lane="areas-nav" className="scroll-thin ml-[1.35rem] mt-0.5 flex min-h-0 flex-col gap-0.5 overflow-y-auto border-l border-line-strong pl-2">
              {(areas.data ?? []).map((a) => (
                <li key={a.id} className="flex items-center gap-1">
                  <NavLink to={`/areas/${a.id}`} onClick={onNavigate} className={({ isActive }) => cn(row, 'min-h-8 min-w-0 flex-1 text-[0.9rem]', isActive && active)}>
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

      {editor && (
        // The group of the mockup (API, MCP, Correo...), all without a destination yet: no focus, and the reason is written in the row.
        <div>
          <button type="button" aria-expanded={connectionsOpen} onClick={() => setConnectionsOpen((v) => !v)} className={cn(row, 'w-full items-start text-left text-muted')}>
            <Plug size={16} aria-hidden className="mt-0.5 shrink-0" />
            <span className="min-w-0 flex-1 leading-tight">
              {t('nav.connections')}
              <span className="block text-xs font-normal">{t('nav.connectionsReason')}</span>
            </span>
            <ChevronDown size={15} aria-hidden className={cn('mt-0.5 shrink-0 transition-transform', !connectionsOpen && '-rotate-90')} />
          </button>
          {connectionsOpen && (
            <ul className="ml-[1.35rem] mt-0.5 flex flex-col gap-0.5 border-l border-line-strong pl-2">
              {CONNECTIONS.map((c) => (
                <li key={c} aria-disabled="true" className={cn(row, 'min-h-8 cursor-not-allowed text-[0.9rem] text-muted hover:bg-transparent')}>
                  {t(c)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-auto shrink-0 border-t border-line pt-3">
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
