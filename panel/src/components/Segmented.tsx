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
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-line-strong bg-raised p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-sm px-2.5 font-medium transition-colors',
            size === 'sm' ? 'h-6 text-xs' : 'h-7 text-[13px]',
            value === o.value ? 'bg-accent-soft text-accent' : 'text-muted hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
