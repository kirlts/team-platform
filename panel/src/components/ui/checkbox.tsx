import { Check } from '@/components/icons'
import { Checkbox as Primitive } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/**
 * Check box drawn with the panel's materials (well, edge, accent) instead of the browser's own control,
 * which comes in the system blue and in its own size (J2-A-24). The label is the caller's.
 */
export function Checkbox({ className, ...props }: ComponentProps<typeof Primitive.Root>) {
  return (
    <Primitive.Root
      className={cn(
        'well hit inline-flex size-5 shrink-0 items-center justify-center rounded-[4px] text-accent-fg',
        'data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:shadow-none',
        className,
      )}
      {...props}
    >
      <Primitive.Indicator>
        <Check size={14} aria-hidden strokeWidth={2.5} />
      </Primitive.Indicator>
    </Primitive.Root>
  )
}
