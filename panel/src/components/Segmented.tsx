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
    <div role="radiogroup" aria-label={label} aria-describedby={describedBy} className={cn('inline-flex self-start', quiet ? 'gap-1' : 'well rounded-full p-0.5')}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'font-semibold transition-colors duration-150',
            quiet ? 'border-b-2 px-2' : 'rounded-full border px-3',
            size === 'sm' ? 'h-6 text-xs' : 'h-7 text-sm',
            quiet
              ? value === o.value
                ? 'border-accent text-fg'
                : 'border-transparent text-muted hover:text-fg'
              : value === o.value
                ? 'border-accent bg-selected text-fg'
                : 'border-transparent text-muted hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
