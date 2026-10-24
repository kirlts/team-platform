import type { InputHTMLAttributes, Ref, TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const field = 'well w-full rounded-field px-3 text-sm text-fg placeholder:text-faint focus-visible:border-accent focus-visible:outline-1 focus-visible:outline-offset-0 disabled:opacity-50'

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input className={cn(field, 'h-10', className)} {...props} />
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(field, 'min-h-16 resize-y py-2', className)} {...props} />
}
