import { Slot } from 'radix-ui'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const variants = {
  primary: 'btn-gel',
  secondary: 'btn-glass',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
} as const

const sizes = {
  default: 'h-8 px-4 gap-1.5 text-sm',
  sm: 'h-7 px-3 gap-1 text-[13px]',
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
      className={cn('btn', variants[variant], sizes[size], className)}
      {...props}
    />
  )
}
