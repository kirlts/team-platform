import { Popover as Primitive } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export const Popover = Primitive.Root
export const PopoverTrigger = Primitive.Trigger
export const PopoverAnchor = Primitive.Anchor

export function PopoverContent({ className, sideOffset = 4, align = 'start', ...props }: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        sideOffset={sideOffset}
        align={align}
        className={cn(
          'z-50 w-64 max-w-[calc(100vw-1rem)] rounded-md border border-line-strong bg-raised p-1 text-sm text-fg shadow-md',
          className,
        )}
        {...props}
      />
    </Primitive.Portal>
  )
}
