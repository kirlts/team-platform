import { Check, ChevronRight } from '@/components/icons'
import { DropdownMenu as Primitive } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export const DropdownMenu = Primitive.Root
export const DropdownMenuTrigger = Primitive.Trigger
export const DropdownMenuRadioGroup = Primitive.RadioGroup
export const DropdownMenuGroup = Primitive.Group
export const DropdownMenuSub = Primitive.Sub

export function DropdownMenuContent({ className, sideOffset = 4, ...props }: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        sideOffset={sideOffset}
        className={cn(
          'pop z-50 min-w-44 max-w-[calc(100vw-1rem)] overflow-hidden rounded-lg p-1 text-sm text-fg',
          className,
        )}
        {...props}
      />
    </Primitive.Portal>
  )
}

const item =
  'relative flex min-h-8 cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 outline-none ' +
  'data-[highlighted]:bg-accent-soft data-[highlighted]:text-accent-deep data-[disabled]:pointer-events-none data-[disabled]:opacity-45'

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

/** An option that is on or off; the open menu shows which ones are on (J2-A-13). */
export function DropdownMenuCheckboxItem({ className, children, ...props }: ComponentProps<typeof Primitive.CheckboxItem>) {
  return (
    <Primitive.CheckboxItem className={cn(item, 'pl-7', className)} {...props}>
      <Primitive.ItemIndicator className="absolute left-2 inline-flex">
        <Check size={14} aria-hidden />
      </Primitive.ItemIndicator>
      {children}
    </Primitive.CheckboxItem>
  )
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof Primitive.Separator>) {
  return <Primitive.Separator className={cn('-mx-1 my-1 h-px bg-line', className)} {...props} />
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof Primitive.Label>) {
  return <Primitive.Label className={cn('px-2 py-1 text-xs font-medium text-muted', className)} {...props} />
}

/** A row that opens a menu of its own beside it: the options of a filter, each with the value that is on (J3-A-16). */
export function DropdownMenuSubTrigger({ className, children, ...props }: ComponentProps<typeof Primitive.SubTrigger>) {
  return (
    <Primitive.SubTrigger className={cn(item, 'data-[state=open]:bg-accent-soft', className)} {...props}>
      {children}
      <ChevronRight size={14} aria-hidden className="ml-auto shrink-0 text-muted" />
    </Primitive.SubTrigger>
  )
}

export function DropdownMenuSubContent({ className, ...props }: ComponentProps<typeof Primitive.SubContent>) {
  return (
    <Primitive.Portal>
      <Primitive.SubContent
        sideOffset={4}
        collisionPadding={8}
        className={cn('pop z-50 min-w-44 max-w-[calc(100vw-1rem)] overflow-hidden rounded-lg p-1 text-sm text-fg', className)}
        {...props}
      />
    </Primitive.Portal>
  )
}
