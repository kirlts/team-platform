import { cn } from '@/lib/utils'

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = 'default',
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  label: string
  size?: 'default' | 'sm'
}) {
  return (
    <div role="radiogroup" aria-label={label} className="well inline-flex self-start rounded-full p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-full px-3 font-semibold transition-colors duration-150',
            size === 'sm' ? 'h-6 text-xs' : 'h-7 text-[13px]',
            value === o.value
              ? 'btn-glass border-accent text-accent-deep'
              : 'border border-transparent text-muted hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
