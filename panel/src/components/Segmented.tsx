import { cn } from '@/lib/utils'

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = 'default',
  quiet = false,
  describedBy,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  label: string
  size?: 'default' | 'sm'
  /** A filter next to a main switch: text with an underline for the chosen one, no pill, so the two do not weigh the same. */
  quiet?: boolean
  /** Id of the text that explains the setting (Configuración). */
  describedBy?: string
}) {
  return (
    <div role="radiogroup" aria-label={label} aria-describedby={describedBy} className={cn('inline-flex self-start', quiet ? 'gap-1 rounded-full bg-[var(--quiet-tab-track)] p-0.5' : 'well opt-track rounded-full p-0.5')}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'font-semibold transition-colors duration-150',
            quiet ? 'rounded-[var(--quiet-tab-radius)] border-b-2 px-2' : 'rounded-full border px-3',
            size === 'sm' ? 'h-6 text-xs' : 'h-7 text-sm',
            quiet
              ? value === o.value
                ? 'border-[var(--quiet-tab-edge)] bg-[var(--quiet-tab-bg)] text-fg shadow-[var(--quiet-tab-shadow)]'
                : 'border-transparent text-muted hover:text-fg'
              : value === o.value
                ? 'opt-on'
                : 'border-transparent text-muted hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
