import { X } from '@/components/icons'
import { useT } from '@/i18n'
import { Avatar } from './Avatar'
import { useLookups } from './lookups'
import { MemberPicker } from './MemberPicker'

/** Chips of recipients with their ×, and the picker. Past `max` the rest fold behind «+N», which opens the picker. */
export function RecipientsEditor({ ids, onChange, max = 3 }: { ids: string[]; onChange: (ids: string[]) => void; max?: number }) {
  const t = useT()
  const { members, memberName } = useLookups()
  const shown = ids.slice(0, max)
  return (
    <ul aria-label={t('recipients.label')} className="flex flex-wrap items-center gap-1.5 text-xs">
      {shown.map((id) => (
        <li key={id} className="inline-flex min-h-6 max-w-full items-center gap-1 rounded-full bg-accent-soft py-0.5 pl-0.5 pr-1 leading-tight text-accent-deep">
          <Avatar name={memberName(id) || '?'} size={18} />
          {memberName(id)}
          <button type="button" aria-label={t('recipients.remove', { name: memberName(id) })} className="rounded-sm p-0.5 hover:bg-accent/15" onClick={() => onChange(ids.filter((x) => x !== id))}>
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
