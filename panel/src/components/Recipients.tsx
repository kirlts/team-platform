import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { Avatar } from './Avatar'
import { useLookups } from './lookups'

const chip = 'inline-flex min-h-5 max-w-full items-center gap-1 rounded-full py-0.5 pl-0.5 pr-2 text-xs leading-tight text-muted'

/**
 * Recipients of a message as chips. With `max`, the first ones show and the rest fold into a «+N»
 * chip that opens the full list on top of the page, without growing the row (UD-017: what is not
 * needed now folds, with its count). Without `max` every chip shows and they wrap onto as many
 * rows as they need (UD-016: no ellipsis). `children` are extra items in the same row. `plain` leaves out the
 * avatars: a row of a list already has the sender's, and a sphere for each recipient doubles the marks (J2-A-12).
 */
export function Recipients({ ids, max, className, children, plain = false }: { ids: string[]; max?: number; className?: string; children?: React.ReactNode; plain?: boolean }) {
  const t = useT()
  const { memberName } = useLookups()
  const named = ids.filter((id) => memberName(id))
  const shown = max === undefined ? named : named.slice(0, max)
  const hidden = max === undefined ? [] : named.slice(max)
  return (
    <ul aria-label={t('recipients.label')} className={cn('flex flex-wrap items-center', plain ? 'gap-x-1' : 'gap-1.5', className)}>
      {named.length > 0 && (
        <li className={cn('inline-flex items-center', !plain && 'h-5')}>{t('recipients.to')}</li>
      )}
      {shown.map((id, i) => (
        <li key={id} data-repeat-ok="person" className={cn(chip, plain && 'min-h-0 pl-0 pr-0')}>
          {!plain && <Avatar name={memberName(id)} size={16} />}
          {/* In a row the names read as one sentence, «para Ana, Bruno y 2 más» (J3-A-20). */}
          {memberName(id)}
          {plain && i < shown.length - 1 && ','}
        </li>
      ))}
      {hidden.length > 0 && (
        <li>
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" aria-label={t('recipients.more', { n: hidden.length })} className={cn(chip, 'relative z-10 pl-2 font-semibold hover:bg-accent-soft/70 pointer-coarse:-my-3 pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:justify-center', plain && 'min-h-0 px-0 hover:bg-transparent hover:underline')}>
                {t('recipients.andMore', { n: hidden.length })}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-2">
              <ul className="flex flex-col gap-1.5">
                {named.map((id) => (
                  <li key={id} className="flex items-center gap-2 text-sm">
                    <Avatar name={memberName(id)} size={20} />
                    <span className="min-w-0 break-words">{memberName(id)}</span>
                  </li>
                ))}
              </ul>
            </PopoverContent>
          </Popover>
        </li>
      )}
      {children}
    </ul>
  )
}
