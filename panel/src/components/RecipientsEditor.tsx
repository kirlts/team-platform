import { X } from '@/components/icons'
import { useT } from '@/i18n'
import { Avatar } from './Avatar'
import { useLookups } from './lookups'
import { MemberPicker } from './MemberPicker'

/** Chips of recipients with their ×, always drawn (J2-A-21), and the picker. Past `max` the rest fold behind «+N», which opens the picker. */
export function RecipientsEditor({ ids, onChange, max = 3 }: { ids: string[]; onChange: (ids: string[]) => void; max?: number }) {
  const t = useT()
  const { members, memberName } = useLookups()
  const shown = ids.slice(0, max)
  return (
    <ul aria-label={t('recipients.label')} className="flex flex-wrap items-center gap-1.5 text-xs">
      {shown.map((id) => (
        <li key={id} data-repeat-ok="person" className="group/chip inline-flex min-h-6 max-w-full items-center gap-1 rounded-full border border-line-strong bg-glass-strong py-0.5 pl-0.5 pr-0.5 leading-tight text-fg">
          <Avatar name={memberName(id) || '?'} size={18} />
          {memberName(id)}
          <button type="button" aria-label={t('recipients.remove', { name: memberName(id) })} className="hit inline-flex items-center justify-center rounded-full text-muted hover:bg-hover hover:text-fg" onClick={() => onChange(ids.filter((x) => x !== id))}>
            <X size={11} aria-hidden />
          </button>
        </li>
      ))}
      <li>
        <MemberPicker members={members.filter((m) => m.active !== false || ids.includes(m.id))} selected={ids} onChange={onChange} hiddenCount={Math.max(0, ids.length - max)} />
      </li>
    </ul>
  )
}
