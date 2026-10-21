import { ArrowRight } from '@/components/icons'
import { cn } from '@/lib/utils'
import { Avatar } from './Avatar'
import { useLookups } from './lookups'

/**
 * Recipients of a message as chips that wrap onto as many rows as they need (UD-016: a long list
 * is never cut with an ellipsis). `children` are extra items drawn after the chips, in the same row.
 */
export function Recipients({ ids, className, children }: { ids: string[]; className?: string; children?: React.ReactNode }) {
  const { memberName } = useLookups()
  const named = ids.filter((id) => memberName(id))
  return (
    <ul aria-label="Destinatarios" className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {named.length > 0 && (
        <li className="inline-flex h-5 items-center text-faint">
          <ArrowRight size={12} aria-label="para" />
        </li>
      )}
      {named.map((id) => (
        <li key={id} className="inline-flex min-h-5 max-w-full items-center gap-1 rounded-full bg-accent-soft py-0.5 pl-0.5 pr-2 text-xs leading-tight text-accent-deep">
          <Avatar name={memberName(id)} size={16} />
          {memberName(id)}
        </li>
      ))}
      {children}
    </ul>
  )
}
