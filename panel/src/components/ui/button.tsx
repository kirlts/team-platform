import { Slot } from 'radix-ui'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const variants = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover border border-transparent',
  secondary: 'bg-raised text-fg border border-line-strong hover:bg-hover',
  ghost: 'bg-transparent text-fg border border-transparent hover:bg-hover',
  danger: 'bg-raised text-danger border border-line-strong hover:bg-danger-soft',
} as const

const sizes = {
  default: 'h-8 px-3 gap-1.5',
  sm: 'h-7 px-2 gap-1 text-[13px]',
  icon: 'h-8 w-8 justify-center',
  'icon-sm': 'h-7 w-7 justify-center',
} as const

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants
  size?: keyof typeof sizes
  asChild?: boolean
}

export function Button({ className, variant = 'secondary', size = 'default', asChild, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button'
  return (
    <Comp
      type={asChild ? undefined : (type ?? 'button')}
      className={cn(
        'inline-flex shrink-0 items-center whitespace-nowrap rounded-md text-sm font-medium transition-colors',
        'disabled:pointer-events-none disabled:opacity-45',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  )
}
