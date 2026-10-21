import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const field =
  'w-full rounded-md border border-line-strong bg-raised px-2.5 text-sm text-fg placeholder:text-faint ' +
  'focus-visible:border-accent focus-visible:outline-1 focus-visible:outline-accent disabled:opacity-50'

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(field, 'h-8', className)} {...props} />
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(field, 'min-h-16 resize-y py-1.5', className)} {...props} />
}
