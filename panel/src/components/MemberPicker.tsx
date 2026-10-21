import { Check, Plus } from '@/components/icons'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useT } from '@/i18n'
import type { Member } from '@/lib/types'
import { Avatar } from './Avatar'

/** Primera línea del perfil: lo que ayuda a elegir a quién le toca algo. */
const firstLine = (profile: string | undefined) => (profile ?? '').split('\n').find((l) => l.trim())?.trim() ?? ''

/** Lista de miembros con marca de selección, en una ventana emergente. El botón muestra «+» o «+N» si hay destinatarios fuera de la fila. */
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
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={hiddenCount > 0 ? t('recipients.manageMore', { n: hiddenCount }) : t('recipients.add')}
          className="inline-flex h-6 min-w-6 items-center justify-center gap-0.5 rounded-md border border-dashed border-line-strong px-1 text-xs font-semibold text-muted hover:border-accent hover:text-accent"
        >
          {hiddenCount > 0 ? `+${hiddenCount}` : <Plus size={13} aria-hidden />}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-1">
        <ul className="flex max-h-64 flex-col overflow-y-auto" data-lane="member-picker">
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
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block break-words">{m.name}</span>
                    {firstLine(m.profile) && <span className="block break-words text-xs text-muted">{firstLine(m.profile)}</span>}
                  </span>
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
