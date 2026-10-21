import { ChevronDown, Home, Inbox, Layers, LogOut, Plug, Plus, Settings, Users } from '@/components/icons'
import { useState, type ReactNode } from 'react'
import { NavLink, useMatch } from 'react-router'
import { Link } from 'react-router'
import { NotifyBadge, StateMark, useCountsLabel } from '@/components/NotifyBadge'
import { useT } from '@/i18n'
import { areaCounts, areaMessagesPath, mineCounts } from '@/lib/pending'
import type { MessageSummary } from '@/lib/types'
import { useAreas, useMe, useSaveArea, useSummary } from '@/lib/queries'
import { cn } from '@/lib/utils'
import { Avatar } from './Avatar'
import { FormDialog } from './FormDialog'

const row =
  'flex min-h-11 items-center gap-2.5 md:min-h-9 rounded-md border border-transparent px-3 py-1.5 text-sm font-medium text-fg transition-colors duration-150 hover:bg-glass'
/** What is selected looks the same everywhere (J2-A-41): the `selected` fill and the accent bar on the edge, as the rows of Áreas. */
const active = 'bg-selected font-semibold shadow-[inset_4px_0_0_var(--color-accent)] hover:bg-selected'

function Item({ to, icon, children, end, onNavigate, badge }: { to: string; icon: ReactNode; children: ReactNode; end?: boolean; onNavigate?: () => void; badge?: ReactNode }) {
  return (
    // A row that carries a badge keeps the height it has with one, so the badge arriving does not move what is below (J2-A-47).
    <NavLink to={to} end={end} onClick={onNavigate} className={({ isActive }) => cn(row, badge && 'min-h-[46px] md:min-h-[46px]', isActive && active)}>
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

  return (
    <nav aria-label={t('nav.label')} className="flex h-full min-h-0 flex-col gap-1 p-3">
      <div className="mb-3 flex shrink-0 items-center gap-2.5 border-b border-line px-2 pb-3 pt-1">
        <Avatar name={me?.name ?? '?'} size={30} />
        <span className="min-w-0 flex-1 break-words text-sm font-medium leading-tight">{me?.name}</span>
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
                  <NavLink to={`/areas/${a.id}`} onClick={onNavigate} className={({ isActive }) => cn(row, 'min-h-11 min-w-0 flex-1 text-sm md:min-h-8', isActive && active)}>
                    <span className="min-w-0 flex-1 break-words leading-tight">{a.title}</span>
                  </NavLink>
                  {/* The counts' column is reserved: a name that wraps does so the same before and after the counts arrive. */}
                  <span className="flex min-w-24 shrink-0 justify-end">
                    <AreaPending areaId={a.id} title={a.title} summary={summary} onNavigate={onNavigate} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Item to="/team" icon={<Users size={16} aria-hidden />} onNavigate={onNavigate}>
        {t('nav.team')}
      </Item>

      {/* Conexiones is one destination, listed in its page: opening it moves nothing below it, and the settings and the sign-out keep their place (J3-A-46). */}
      {editor && (
        <Item to="/connections" icon={<Plug size={16} aria-hidden />} onNavigate={onNavigate}>
          {t('nav.connections')}
        </Item>
      )}

      {/* The foot: the settings and the way out, as tall as a finger needs (J3-A-48). */}
      <div className="mt-auto flex shrink-0 flex-col gap-1 border-t border-line pt-3">
        <Item to="/settings" icon={<Settings size={16} aria-hidden />} onNavigate={onNavigate}>
          {t('nav.settings')}
        </Item>
        <button type="button" onClick={onLogout} className={cn(row, 'w-full text-left text-muted hover:text-fg')}>
          <LogOut size={16} aria-hidden />
          <span className="min-w-0 flex-1 leading-tight">{t('nav.logout')}</span>
        </button>
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

/** The open messages of an area, leading to Mensajes filtered by that area and by open (UD-028, UD-041). */
function AreaPending({ areaId, title, summary, onNavigate }: { areaId: string; title: string; summary: MessageSummary | undefined; onNavigate?: () => void }) {
  const t = useT()
  const label = useCountsLabel()
  const counts = areaCounts(summary, areaId)
  return (
    <>
      {/* One line: the sidebar shows the open ones, so a count arriving does not change the height of its row. Áreas also shows the answered ones. */}
      {counts.open > 0 && (
        <Link to={areaMessagesPath(areaId, 'open')} onClick={onNavigate} aria-label={t('areas.countOf', { title, count: label({ open: counts.open }) })} className="rounded-full">
          <StateMark status="open" n={counts.open} plain />
        </Link>
      )}
    </>
  )
}
