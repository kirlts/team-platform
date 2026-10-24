import { ChevronDown } from '@/components/icons'
import type { SelectHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/** The face every select of the panel shares: the one of a field, 40 px tall, with the chevron of the panel and not the one of the system. */
export const SELECT_FACE = 'well h-10 rounded-field px-2.5 text-sm text-fg focus-visible:border-accent hover:border-[var(--control-hover-edge)]'

/** A field that sits on the page background and not inside a box: the raised fill and the control line, so its fill is never the one around it. */
export const ON_PAGE_FIELD = 'bg-raised border-line-strong'

/** The platform select drawn like the other fields: keyboard, touch and screen reader work as the browser gives them. The arrow is the panel's, as in the language menu of Configuración. */
export function NativeSelect({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative block w-full">
      <select className={cn(SELECT_FACE, 'block w-full appearance-none pr-8 disabled:opacity-50', className)} {...props} />
      <ChevronDown size={13} aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted" />
    </span>
  )
}
