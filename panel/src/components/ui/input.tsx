import type { InputHTMLAttributes, Ref, TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const field = 'well w-full rounded-field px-3 text-sm text-fg placeholder:text-faint focus-visible:border-accent focus-visible:outline-1 focus-visible:outline-offset-0 disabled:opacity-50'

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input className={cn(field, 'h-10 max-md:h-11', className)} {...props} />
}

/**
 * A text box grows with what is written, up to twelve lines, and then scrolls: the same as the box of «Nuevo mensaje». A resize grip in
 * the corner was the one hand-sized field of the panel (the reply field drew it inside its borderless box). A browser without
 * `field-sizing` keeps the grip, so a long text still fits.
 */
export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
  return <textarea className={cn(field, 'min-h-16 max-h-[12lh] resize-y py-2 supports-[field-sizing:content]:resize-none supports-[field-sizing:content]:[field-sizing:content]', className)} {...props} />
}
