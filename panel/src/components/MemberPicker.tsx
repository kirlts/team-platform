import { Check, Plus, Search } from '@/components/icons'
import { useState } from 'react'
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
}: {
  members: Member[]
  selected: string[]
  onChange: (ids: string[]) => void
  hiddenCount?: number
}) {
  const t = useT()
  const [search, setSearch] = useState('')
  const needle = search.trim().toLowerCase()
  const shown = needle ? members.filter((m) => m.name.toLowerCase().includes(needle)) : members
  return (
    <Popover onOpenChange={(open) => !open && setSearch('')}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={hiddenCount > 0 ? t('recipients.manageMore', { n: hiddenCount }) : t('recipients.add')}
          title={hiddenCount > 0 ? t('recipients.manageMore', { n: hiddenCount }) : t('recipients.add')}
          className="hit inline-flex items-center justify-center gap-1 rounded-md px-1.5 text-xs font-semibold text-muted hover:bg-hover hover:text-accent"
        >
          {hiddenCount > 0 ? `+${hiddenCount}` : (
            <>
              <Plus size={13} aria-hidden /> {t('recipients.addShort')}
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-1" collisionPadding={8}>
        {/* A name per line and a search: nine people fit in the frame and the list says it scrolls (J1-B-15). */}
        <label className="relative mb-1 block">
          <Search size={14} aria-hidden className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} aria-label={t('recipients.search', { n: members.length })} placeholder={t('recipients.search', { n: members.length })} className="well h-8 w-full rounded-md pl-7 pr-2 text-sm outline-none focus-visible:border-accent" />
        </label>
        <ul className="scroll-thin flex max-h-80 flex-col overflow-y-auto" data-lane="member-picker">
          {shown.map((m) => {
            const on = selected.includes(m.id)
            return (
              <li key={m.id}>
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={on}
                  onClick={() => onChange(on ? selected.filter((x) => x !== m.id) : [...selected, m.id])}
                  className="flex min-h-8 w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-hover"
                >
                  <Avatar name={m.name} size={20} />
                  <span className="min-w-0 flex-1 break-words leading-tight">{m.name}</span>
                  {on && <Check size={14} className="text-accent" aria-hidden />}
                </button>
              </li>
            )
          })}
          {shown.length === 0 && <li className="px-2 py-2 text-xs text-muted">{t('recipients.none')}</li>}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
