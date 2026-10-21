import { Check } from 'lucide-react'
import { DropdownMenu as Primitive } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export const DropdownMenu = Primitive.Root
export const DropdownMenuTrigger = Primitive.Trigger
export const DropdownMenuRadioGroup = Primitive.RadioGroup
export const DropdownMenuGroup = Primitive.Group

export function DropdownMenuContent({ className, sideOffset = 4, ...props }: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        sideOffset={sideOffset}
        className={cn(
          'z-50 min-w-44 max-w-[calc(100vw-1rem)] overflow-hidden rounded-md border border-line-strong bg-raised p-1 text-sm text-fg shadow-md',
          className,
        )}
        {...props}
      />
    </Primitive.Portal>
  )
}

const item =
  'relative flex min-h-8 cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 outline-none ' +
  'data-[highlighted]:bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-45'

export function DropdownMenuItem({ className, ...props }: ComponentProps<typeof Primitive.Item>) {
  return <Primitive.Item className={cn(item, className)} {...props} />
}

export function DropdownMenuRadioItem({ className, children, ...props }: ComponentProps<typeof Primitive.RadioItem>) {
  return (
    <Primitive.RadioItem className={cn(item, 'pl-7', className)} {...props}>
      <Primitive.ItemIndicator className="absolute left-2 inline-flex">
        <Check size={14} aria-hidden />
      </Primitive.ItemIndicator>
      {children}
    </Primitive.RadioItem>
  )
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof Primitive.Separator>) {
  return <Primitive.Separator className={cn('-mx-1 my-1 h-px bg-line', className)} {...props} />
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof Primitive.Label>) {
  return <Primitive.Label className={cn('px-2 py-1 text-xs font-medium text-muted', className)} {...props} />
}
