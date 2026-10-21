import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The state block of a list or a view that has nothing to show (J1-A-10, J1-A-21): one sentence in the body,
 * naming what was looked for, and the action that gets out of it. `alert` is for an error.
 */
export function EmptyState({ children, action, alert = false, className }: { children: ReactNode; action?: ReactNode; alert?: boolean; className?: string }) {
  return (
    <div role={alert ? 'alert' : 'status'} className={cn('flex flex-col items-center gap-3 px-4 py-10 text-center text-sm', alert ? 'text-danger' : 'text-muted', className)}>
      <p className="max-w-prose break-words">{children}</p>
      {action}
    </div>
  )
}
