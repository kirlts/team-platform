import { ChevronDown, Home, PanelLeft, Inbox, Layers, LogOut, Plug, Plus, Settings, Users } from '@/components/icons'
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

/** One row, one grid (UD-130): icon, label and, on the right, the reserved column of the count. The look of hover and focus is `.nav-row` in styles.css. */
const row = 'nav-row grid min-h-11 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 rounded-md border border-transparent py-1 pl-2.5 pr-[var(--sidebar-count-col)] text-sm font-medium text-fg md:min-h-9'
/** What is selected looks the same everywhere (J2-A-41): the `selected` fill and the accent bar on the edge, as the rows of Áreas. */
const active = 'bg-selected font-semibold shadow-[inset_4px_0_0_var(--color-accent)]'
/** The count column: the same right inset in every row, centered on the row's height. It sits over the row, so a count arriving never changes the row's height (J2-A-47). */
const countCol = 'absolute inset-y-0 right-0 z-10 flex items-center justify-end pr-2.5'

function Item({ to, icon, children, end, onNavigate, badge }: { to: string; icon: ReactNode; children: ReactNode; end?: boolean; onNavigate?: () => void; badge?: ReactNode }) {
  return (
    <div data-nav-row className="relative">
      <NavLink to={to} end={end} onClick={onNavigate} className={({ isActive }) => cn(row, isActive && active)}>
        {icon}
        <span className="min-w-0 break-words leading-tight">{children}</span>
      </NavLink>
      {badge && <span data-nav-count className={countCol}>{badge}</span>}
    </div>
  )
}

/** Sidebar: user, views, areas with what is pending in each (Editor) and Configuración at the foot. */
export function Sidebar({ onNavigate, onLogout, onHide }: { onNavigate?: () => void; onLogout: () => void; onHide?: () => void }) {
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
    <nav aria-label={t('nav.label')} className="flex h-full min-h-0 flex-col gap-0.5 p-2">
      {/* The user and, at its side, the button that hides the panel (mockup). On a phone the panel is a menu that closes by itself, so there it is not drawn. */}
      <div className="mb-2 flex shrink-0 items-center gap-2 border-b border-line px-1.5 pb-2 pt-0.5">
        <Avatar name={me?.name ?? '?'} size={26} />
        <span className="min-w-0 flex-1 break-words text-sm font-medium leading-tight">{me?.name}</span>
        {onHide && (
          <button type="button" data-testid="sidebar-hide" aria-label={t('sidebar.hide')} title={t('sidebar.hide')} onClick={onHide} className="nav-ctl max-md:hidden">
            <PanelLeft size={16} aria-hidden />
          </button>
        )}
      </div>

      <Item to="/" end icon={<Home size={16} aria-hidden />} onNavigate={onNavigate}>
        {t('nav.home')}
      </Item>
      <Item to="/messages" icon={<Inbox size={16} aria-hidden />} onNavigate={onNavigate} badge={<NotifyBadge counts={mine} size="plain" data-testid="messages-badge" />}>
        {t('nav.messages')}
      </Item>

      {editor && (
        <div className="flex min-h-0 shrink flex-col">
          <div data-nav-row className="relative shrink-0">
            <NavLink to="/areas" onClick={onNavigate} className={() => cn(row, inAreas && 'text-accent-deep')}>
              <Layers size={16} aria-hidden />
              <span className="min-w-0 break-words leading-tight">{t('nav.areas')}</span>
            </NavLink>
            {/* The two controls of the row end at the same right edge as every count. */}
            <span data-nav-count className={cn(countCol, 'gap-0.5')}>
              <button type="button" aria-label={t('nav.newArea')} title={t('nav.newArea')} onClick={() => setCreating(true)} className="nav-ctl">
                <Plus size={15} aria-hidden />
              </button>
              <button
                type="button"
                aria-label={areasOpen ? t('nav.foldAreas') : t('nav.unfoldAreas')}
                title={areasOpen ? t('nav.foldAreas') : t('nav.unfoldAreas')}
                aria-expanded={areasOpen}
                onClick={() => setAreasOpen((v) => !v)}
                className="nav-ctl"
              >
                <ChevronDown size={15} aria-hidden className={cn('transition-transform', !areasOpen && '-rotate-90')} />
              </button>
            </span>
          </div>
          {areasOpen && (
            // With many areas the list scrolls inside: it is a declared lane, not the page.
            <ul data-lane="areas-nav" className="scroll-thin ml-2.5 mt-0.5 flex min-h-0 flex-col gap-0.5 overflow-y-auto border-l border-line-strong pl-1">
              {(areas.data ?? []).map((a) => (
                <li key={a.id} data-nav-row className="relative">
                  <NavLink to={`/areas/${a.id}`} onClick={onNavigate} className={({ isActive }) => cn(row, 'min-h-11 md:min-h-8', isActive && active)}>
                    {/* The area's color, the same one its chip has in the messages (UD-045). */}
                    <span aria-hidden data-testid="area-swatch-dot" className="h-2.5 w-2.5 shrink-0 rounded-sm border border-line-strong" style={{ background: a.color }} />
                    <span className="min-w-0 break-words leading-tight">{a.title}</span>
                  </NavLink>
                  {/* The counts' column is the same one as every row's: a name wraps the same before and after they arrive. */}
                  <span data-nav-count className={countCol}>
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
      <div className="mt-auto flex shrink-0 flex-col gap-0.5 border-t border-line pt-2">
        <Item to="/settings" icon={<Settings size={16} aria-hidden />} onNavigate={onNavigate}>
          {t('nav.settings')}
        </Item>
        <button type="button" onClick={onLogout} className={cn(row, 'w-full text-left text-muted')}>
          <LogOut size={16} aria-hidden />
          <span className="min-w-0 leading-tight">{t('nav.logout')}</span>
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
        <Link to={areaMessagesPath(areaId, 'open')} onClick={onNavigate} aria-label={t('areas.countOf', { title, count: label({ open: counts.open }) })} className="nav-count">
          <StateMark status="open" n={counts.open} showWord={false} plain />
        </Link>
      )}
    </>
  )
}
