import { Check, Plus } from '@/components/icons'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { Member } from '@/lib/types'
import { Avatar } from './Avatar'

/** Lista de miembros con marca de selección, en una ventana emergente. */
export function MemberPicker({
  members,
  selected,
  onChange,
}: {
  members: Member[]
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Agregar destinatario"
          className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-dashed border-line-strong text-muted hover:border-accent hover:text-accent"
        >
          <Plus size={13} aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-1">
        <ul className="flex flex-col">
          {members.map((m) => {
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
        </ul>
      </PopoverContent>
    </Popover>
  )
}
