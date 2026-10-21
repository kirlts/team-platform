import type { SelectHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/** The platform select drawn like the other fields: keyboard, touch and screen reader work as the browser gives them. */
export function NativeSelect({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn('well h-8 w-full rounded-md px-2 text-sm text-fg focus-visible:border-accent disabled:opacity-50', className)} {...props} />
}
