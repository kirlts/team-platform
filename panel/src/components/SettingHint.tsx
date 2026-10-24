import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * One-line datum under the title of a setting of Configuración, only where the name cannot carry it. `id` is what the
 * control names in `aria-describedby`. Texts come from the `hint.*` keys of the catalogues; a guard (ui-voice.test.ts)
 * limits them to 90 characters and to Configuración.
 */
export function SettingHint({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return (
    <p id={id} data-setting-hint className={cn('text-sm leading-snug text-muted', className)}>
      {children}
    </p>
  )
}
