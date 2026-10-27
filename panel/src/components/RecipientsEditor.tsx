import { X } from '@/components/icons'
import { useT } from '@/i18n'
import { Avatar } from './Avatar'
import { useLookups } from './lookups'
import { MemberPicker } from './MemberPicker'

/** `compact` is the header of the view of a message: first names, chips of 26 px at most, so that the row of area, state, author, time and recipients is one line. */
/** Chips of recipients with their ×, always drawn (J2-A-21), and the picker. Past `max` the rest fold behind «+N», which opens the picker. With `to` the word names the whole control (the new message bar, UD-291). With `to` the control reads at the size of «Enviar como», its neighbor in the row (one row, one size) and its chips carry the first name, the whole name in the tooltip, so the row stays one line; two members with the same first name show it whole. The picker never offers `authorId`, who writes the message: a message is not sent to oneself (UD-300). */
export function RecipientsEditor({ ids, onChange, max = 3, to, testId, authorId, compact = false }: { ids: string[]; onChange: (ids: string[]) => void; max?: number; to?: string; testId?: string; authorId?: string; compact?: boolean }) {
  const t = useT()
  const { members, memberName } = useLookups()
  const shown = ids.slice(0, max)
  const firstName = (name: string) => (name || '?').split(' ')[0]!
  /** A chip of `to` or `compact` says the first name; where another member of the team has the same one it says the whole name, so two chips are never the same word. */
  const label = (id: string) => {
    const name = memberName(id)
    return members.some((m) => m.id !== id && firstName(m.name) === firstName(name)) ? name : firstName(name)
  }
  return (
    <ul aria-label={t('recipients.label')} data-testid={testId} className={compact ? 'flex flex-wrap items-center gap-1 text-xs' : `flex flex-wrap items-center gap-1.5 ${to ? 'text-sm' : 'text-xs'}`}>
      {ids.length > 0 && <li className="text-muted">{to ?? t('recipients.to')}</li>}
      {shown.map((id) => (
        <li key={id} data-repeat-ok="person" title={memberName(id)} className={`group/chip inline-flex min-h-6 max-w-full items-center gap-1 rounded-full border border-line-strong bg-glass-strong pl-0.5 pr-0.5 leading-tight text-fg ${compact ? 'py-0' : 'py-0.5'}`}>
          <Avatar name={memberName(id) || '?'} size={compact ? 16 : 18} />
          {compact || to ? label(id) : memberName(id)}
          <button type="button" aria-label={t('recipients.remove', { name: memberName(id) })} title={t('recipients.remove', { name: memberName(id) })} className="hit relative inline-flex items-center justify-center rounded-full text-muted hover:bg-hover hover:text-fg max-md:-mx-2.5 max-md:-my-2.5 max-md:min-h-11 max-md:min-w-11 max-md:hover:bg-transparent [@media(pointer:coarse)]:after:absolute [@media(pointer:coarse)]:after:-inset-2.5" onClick={() => onChange(ids.filter((x) => x !== id))}>
            <X size={16} aria-hidden />
          </button>
        </li>
      ))}
      <li>
        <MemberPicker members={members.filter((m) => m.id !== authorId && (m.active !== false || ids.includes(m.id)))} selected={ids} onChange={onChange} hiddenCount={Math.max(0, ids.length - max)} compact={compact} {...(to ? { label: to, shortLabel: ids.length > 0 ? '' : to } : {})} />
      </li>
    </ul>
  )
}
