import { X } from 'lucide-react'
import { Dialog as Primitive } from 'radix-ui'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export const Dialog = Primitive.Root
export const DialogTrigger = Primitive.Trigger
export const DialogClose = Primitive.Close

export function DialogContent({
  className,
  title,
  side = 'center',
  children,
  ...props
}: Omit<ComponentProps<typeof Primitive.Content>, 'title'> & { title: ReactNode; side?: 'center' | 'left' }) {
  return (
    <Primitive.Portal>
      <Primitive.Overlay className="fixed inset-0 z-50 bg-black/40" />
      <Primitive.Content
        aria-describedby={undefined}
        className={cn(
          'fixed z-50 flex flex-col border border-line-strong bg-raised text-fg shadow-lg',
          side === 'center'
            ? 'left-1/2 top-1/2 max-h-[85dvh] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg'
            : 'inset-y-0 left-0 w-72 max-w-[85vw] border-y-0 border-l-0',
          className,
        )}
        {...props}
      >
        <div className={cn('flex items-center justify-between gap-2 border-b border-line px-4 py-2.5', side === 'left' && 'sr-only')}>
          <Primitive.Title className="text-sm font-semibold">{title}</Primitive.Title>
          <Primitive.Close className="rounded-sm p-1 text-muted hover:bg-hover" aria-label="Cerrar">
            <X size={16} aria-hidden />
          </Primitive.Close>
        </div>
        {side === 'left' && <Primitive.Title className="sr-only">{title}</Primitive.Title>}
        {children}
      </Primitive.Content>
    </Primitive.Portal>
  )
}
