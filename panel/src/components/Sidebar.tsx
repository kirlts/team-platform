import { ChevronDown, Home, PanelLeft, Inbox, Layers, LogOut, Plug, Plus, Settings, Users } from '@/components/icons'
import { useState, type ReactNode } from 'react'
import { NavLink, useMatch } from 'react-router'
import { Link } from 'react-router'
import { StateMark, useCountsLabel } from '@/components/NotifyBadge'
import { useT } from '@/i18n'
import { areaCounts, areaMessagesPath } from '@/lib/pending'
import { type MessageSummary, canSignOut } from '@team-platform/client'
import { useAreas, useMe, useSaveArea, useSummary } from '@team-platform/client/react'
import { cn } from '@/lib/utils'
import { Avatar } from './Avatar'
import { FormDialog } from './FormDialog'

/**
 * One row, one grid (UD-130): the row is the box that lights and is selected; inside it the link (icon and label) and, on the right, the count
 * column. The column has a minimum width and ends at the same right inset in every row, centered on the row's height; the link never covers it.
 * The look of hover, focus and selection is `.nav-item` in styles.css.
 */
const rowBox = 'nav-item grid min-h-11 grid-cols-[minmax(0,1fr)_minmax(var(--sidebar-count-col),auto)] items-center rounded-md border border-transparent md:min-h-9'
const link = 'nav-row grid min-h-[inherit] grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 self-stretch py-1 pl-2.5 pr-1 text-sm font-medium text-fg'
const countCol = 'flex items-center justify-end pr-2.5'

function Item({ to, icon, children, end, onNavigate, badge }: { to: string; icon: ReactNode; children: ReactNode; end?: boolean; onNavigate?: () => void; badge?: ReactNode }) {
  return (
    <div data-nav-row className={rowBox}>
      <NavLink to={to} end={end} onClick={onNavigate} className={link}>
        {icon}
        <span className="min-w-0 break-words leading-tight">{children}</span>
      </NavLink>
      {/* A count here does not change the row's height (J2-A-47): the column is always reserved. */}
      <span data-nav-count className={countCol}>
        {badge}
      </span>
    </div>
  )
}

/** Sidebar: user, views, areas with what is pending in each (the Editor manages areas) and Configuración at the foot. */
export function Sidebar({ onNavigate, onLogout, onHide }: { onNavigate?: () => void; onLogout: () => void; onHide?: () => void }) {
  const t = useT()
  const me = useMe().data
  const areas = useAreas()
  const summary = useSummary().data
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
        {/* The role of who is signed in, in small capitals under the name, so each person knows with which role they work. */}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="min-w-0 break-words text-sm font-medium leading-tight">{me?.name}</span>
          {me && (
            <span data-testid="sidebar-role" className="rotulo leading-tight text-faint">
              {t(me.role === 'editor' ? 'team.roleEditor' : 'team.roleMember')}
            </span>
          )}
        </span>
        {onHide && (
          <button type="button" data-testid="sidebar-hide" aria-label={t('sidebar.hide')} title={t('sidebar.hide')} onClick={onHide} className="nav-ctl max-md:hidden">
            <PanelLeft size={16} aria-hidden />
          </button>
        )}
      </div>

      <Item to="/" end icon={<Home size={16} aria-hidden />} onNavigate={onNavigate}>
        {t('nav.home')}
      </Item>
      <Item to="/messages" icon={<Inbox size={16} aria-hidden />} onNavigate={onNavigate}>
        {t('nav.messages')}
      </Item>

      {editor && (
        <div className="flex min-h-0 shrink flex-col">
          <div data-nav-row className={cn(rowBox, 'shrink-0')}>
            <NavLink to="/areas" onClick={onNavigate} className={cn(link, inAreas && 'text-accent-deep')}>
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
                <li key={a.id} data-nav-row className={cn(rowBox, 'min-h-11 md:min-h-8')}>
                  <NavLink to={`/areas/${a.id}`} onClick={onNavigate} className={link}>
                    {/* The area's color, the same one its chip has in the messages (UD-045). */}
                    <span aria-hidden data-testid="area-swatch-dot" className="h-2.5 w-2.5 shrink-0 rounded-sm border border-line-strong" style={{ background: a.color }} />
                    <span className="min-w-0 truncate leading-tight" data-ellipsis-ok="UD-315" /* justified: the area name gives way to its counts, one line and the whole name in its title (UD-315, Martín 2026-10-28) */ title={a.title}>{a.title}</span>
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
      <Item to="/connections" icon={<Plug size={16} aria-hidden />} onNavigate={onNavigate}>
        {t('nav.connections')}
      </Item>

      {/* The foot: the settings and the way out, as tall as a finger needs (J3-A-48). */}
      <div className="mt-auto flex shrink-0 flex-col gap-0.5 border-t border-line pt-2">
        <Item to="/settings" icon={<Settings size={16} aria-hidden />} onNavigate={onNavigate}>
          {t('nav.settings')}
        </Item>
        {me && canSignOut(me.provider, me.logout_url) && (
          <div data-nav-row className={rowBox}>
            <button type="button" data-testid="sign-out" onClick={onLogout} className={cn(link, 'w-full text-left text-muted')}>
              <LogOut size={16} aria-hidden />
              <span className="min-w-0 leading-tight">{t('nav.logout')}</span>
            </button>
          </div>
        )}
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

/**
 * The open and the answered messages of an area, each one leading to Mensajes filtered by that area and that state (UD-028, UD-041). A state with
 * none draws nothing and the closed ones have no mark (Martín, 2026-10-28). Each state has a slot of fixed width (`--sidebar-count-slot`), open first, anchored to
 * the right edge: the column of the row never shrinks and: a count never changes the height of its row, and the name, in one line, is what gives way with an ellipsis (UD-315).
 */
const PENDING = ['open', 'answered'] as const

function AreaPending({ areaId, title, summary, onNavigate }: { areaId: string; title: string; summary: MessageSummary | undefined; onNavigate?: () => void }) {
  const t = useT()
  const label = useCountsLabel()
  const counts = areaCounts(summary, areaId)
  return (
    <>
      {/* The slots hold their columns in every row: the triangles share one and the clocks another. A row with no count draws none; one with only answered ones draws only the clock's, so
          its name takes the room of the open slot that is empty to its left. An empty slot to the right of a count stays, reserved (UD-315). */}
      {PENDING.filter((status) => counts[status] > 0 || (status === 'answered' && counts.open > 0)).map((status) => {
        // The sidebar counts the whole team's messages of the area; the top bar counts the ones for me (UD-028, UD-100). Each one says its scope by name and by tooltip.
        const scope = t('areas.countOf', { title, count: label({ [status]: counts[status] }) })
        return (
          <span key={status} data-count-slot={status} className="nav-slot">
            {counts[status] > 0 && (
              <Link to={areaMessagesPath(areaId, status)} onClick={onNavigate} aria-label={scope} title={scope} data-count-status={status} className="nav-count">
                <StateMark status={status} n={counts[status]} showWord={false} plain className="gap-0.5 border-0 px-0" />
              </Link>
            )}
          </span>
        )
      })}
    </>
  )
}
