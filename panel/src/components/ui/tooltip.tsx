import { Tooltip as Primitive } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export const TooltipProvider = Primitive.Provider
export const Tooltip = Primitive.Root
export const TooltipTrigger = Primitive.Trigger

export function TooltipContent({ className, sideOffset = 6, ...props }: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        sideOffset={sideOffset}
        className={cn('z-50 max-w-64 rounded-md bg-fg px-2.5 py-1.5 text-xs text-bg shadow-[0_8px_20px_-8px_oklch(0.2_0.08_262/0.6)]', className)}
        {...props}
      />
    </Primitive.Portal>
  )
}
