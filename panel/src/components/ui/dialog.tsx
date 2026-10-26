import { X } from '@/components/icons'
import { useT } from '@/i18n'
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
  const t = useT()
  return (
    <Primitive.Portal>
      <Primitive.Overlay className="fixed inset-0 z-50 bg-[oklch(0.2_0.06_262/0.45)] backdrop-blur-[3px]" />
      <Primitive.Content
        aria-describedby={undefined}
        // Escape inside a text field cancels that edit only; it must not close the window with the work in it (J2-B-13).
        onEscapeKeyDown={(e) => {
          if ((e.target as HTMLElement | null)?.closest?.('textarea, input')) e.preventDefault()
        }}
        className={cn(
          'glass-strong fixed z-50 flex flex-col text-fg',
          side === 'center'
            ? 'leaf left-1/2 top-1/2 max-h-[85dvh] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2'
            : 'inset-y-0 left-0 w-72 max-w-[85vw] border-y-0 border-l-0',
          className,
        )}
        {...props}
      >
        <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-3">
          {/* The title names what the window holds: a heading above its own field labels, not one more label of their size. */}
          <Primitive.Title className="min-w-0 break-words text-base font-semibold normal-case leading-snug tracking-normal">{title}</Primitive.Title>
          <Primitive.Close className="rounded-full p-1.5 text-muted hover:bg-hover" aria-label={t('common.close')}>
            <X size={16} aria-hidden />
          </Primitive.Close>
        </div>
        {children}
      </Primitive.Content>
    </Primitive.Portal>
  )
}
