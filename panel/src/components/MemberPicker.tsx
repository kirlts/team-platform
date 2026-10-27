import { Check, ChevronDown, Plus, Search } from '@/components/icons'
import { useRef, useState, type KeyboardEvent } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useT } from '@/i18n'
import type { Member } from '@team-platform/client'
import { Avatar } from './Avatar'

/** List of members with a selection mark, in a popover. The button shows «+» or «+N» if there are recipients outside the row. */
export function MemberPicker({
  members,
  selected,
  onChange,
  hiddenCount = 0,
  label,
  shortLabel,
  compact = false,
}: {
  members: Member[]
  selected: string[]
  onChange: (ids: string[]) => void
  hiddenCount?: number
  /** Accessible name and visible short word of the button, when it is not about recipients (the mention of a reply, UD-279). */
  label?: string
  shortLabel?: string
  /** One row of 24 px: the button of the header of a message. */
  compact?: boolean
}) {
  const t = useT()
  const [search, setSearch] = useState('')
  const needle = search.trim().toLowerCase()
  const shown = needle ? members.filter((m) => m.name.toLowerCase().includes(needle)) : members
  const searchBox = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  /** The row that holds the tab stop of the list (roving focus): the last one the focus was on. */
  const [stop, setStop] = useState(0)
  const options = () => Array.from(list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])
  /** Arrow keys move the focus between the search field and the rows, as a listbox does; Space and Enter on a row toggle it. */
  const moveFocus = (e: KeyboardEvent, from: number) => {
    const rows = options()
    const last = rows.length - 1
    const to = e.key === 'ArrowDown' ? from + 1 : e.key === 'ArrowUp' ? from - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? last : null
    if (to === null || rows.length === 0) return
    e.preventDefault()
    if (to < 0) searchBox.current?.focus()
    else rows[Math.min(to, last)]?.focus()
  }
  return (
    <Popover onOpenChange={(open) => {
        if (!open) setSearch('')
        setStop(0)
      }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={hiddenCount > 0 ? t('recipients.manageMore', { n: hiddenCount }) : (label ?? t('recipients.add'))}
          title={hiddenCount > 0 ? t('recipients.manageMore', { n: hiddenCount }) : (label ?? t('recipients.add'))}
          className={`hit inline-flex items-center justify-center gap-1 rounded-full font-semibold text-muted hover:bg-hover hover:text-accent ${hiddenCount > 0 ? 'border border-line-strong bg-glass-strong' : ''} ${compact ? 'min-h-6 px-1.5 text-xs' : 'min-h-8 px-3 text-sm pointer-coarse:min-h-11 pointer-coarse:min-w-11'}`}
        >
          {hiddenCount > 0 ? (
            <>
              +{hiddenCount} <ChevronDown size={compact ? 12 : 14} aria-hidden />
            </>
          ) : (
            <>
              <Plus size={compact ? 14 : 16} aria-hidden /> {shortLabel ?? t('recipients.addShort')}
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" collisionPadding={8}>
        {/* A name per line and a search: nine people fit in the frame and the list says it scrolls (J1-B-15). */}
        <label className="relative mb-2 block">
          <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input ref={searchBox} type="search" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'ArrowDown' && moveFocus(e, -1)} aria-label={t('recipients.search', { n: members.length })} placeholder={t('recipients.search', { n: members.length })} className="well h-10 w-full rounded-field pl-9 pr-3 text-sm outline-none placeholder:text-faint focus-visible:border-accent" />
        </label>
        <ul ref={list} role="listbox" aria-multiselectable="true" aria-label={t('recipients.label')} className="scroll-thin flex max-h-[26rem] flex-col overflow-y-auto" data-lane="member-picker">
          {shown.map((m, index) => {
            const on = selected.includes(m.id)
            return (
              <li key={m.id} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={on}
                  tabIndex={index === Math.min(stop, shown.length - 1) ? 0 : -1}
                  onFocus={() => setStop(index)}
                  onKeyDown={(e) => moveFocus(e, index)}
                  onClick={() => onChange(on ? selected.filter((x) => x !== m.id) : [...selected, m.id])}
                  className="flex min-h-10 w-full items-center gap-2 rounded-option px-2 py-1.5 text-left hover:bg-hover pointer-coarse:min-h-11"
                >
                  <Avatar name={m.name} size={20} />
                  <span className="min-w-0 flex-1 break-words leading-tight">{m.name}</span>
                  {on && <Check size={16} className="text-accent" aria-hidden />}
                </button>
              </li>
            )
          })}
          {shown.length === 0 && <li role="presentation" className="px-2 py-2 text-sm text-muted">{t('recipients.none')}</li>}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
