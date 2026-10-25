import { X } from '@/components/icons'
import { useT } from '@/i18n'
import { Avatar } from './Avatar'
import { useLookups } from './lookups'
import { MemberPicker } from './MemberPicker'

/** Chips of recipients with their ×, always drawn (J2-A-21), and the picker. Past `max` the rest fold behind «+N», which opens the picker. With `to` the word names the whole control (the new message bar, UD-291). The picker never offers `authorId`, who writes the message: a message is not sent to oneself (UD-300). */
export function RecipientsEditor({ ids, onChange, max = 3, to, testId, authorId }: { ids: string[]; onChange: (ids: string[]) => void; max?: number; to?: string; testId?: string; authorId?: string }) {
  const t = useT()
  const { members, memberName } = useLookups()
  const shown = ids.slice(0, max)
  return (
    <ul aria-label={t('recipients.label')} data-testid={testId} className="flex flex-wrap items-center gap-1.5 text-xs">
      {ids.length > 0 && <li className="text-muted">{to ?? t('recipients.to')}</li>}
      {shown.map((id) => (
        <li key={id} data-repeat-ok="person" className="group/chip inline-flex min-h-6 max-w-full items-center gap-1 rounded-full border border-line-strong bg-glass-strong py-0.5 pl-0.5 pr-0.5 leading-tight text-fg">
          <Avatar name={memberName(id) || '?'} size={18} />
          {memberName(id)}
          <button type="button" aria-label={t('recipients.remove', { name: memberName(id) })} title={t('recipients.remove', { name: memberName(id) })} className="hit relative inline-flex items-center justify-center rounded-full text-muted hover:bg-hover hover:text-fg [@media(pointer:coarse)]:after:absolute [@media(pointer:coarse)]:after:-inset-2.5" onClick={() => onChange(ids.filter((x) => x !== id))}>
            <X size={16} aria-hidden />
          </button>
        </li>
      ))}
      <li>
        <MemberPicker members={members.filter((m) => m.id !== authorId && (m.active !== false || ids.includes(m.id)))} selected={ids} onChange={onChange} hiddenCount={Math.max(0, ids.length - max)} {...(to ? { label: to, shortLabel: ids.length > 0 ? '' : to } : {})} />
      </li>
    </ul>
  )
}
