import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * One-line explanation under the label of a setting of Configuración (UD-122: the only screen where help text
 * is visible by default). `id` is what the control names in `aria-describedby`. Texts come from the `hint.*`
 * keys of the catalogues; a guard (ui-voice.test.ts) limits them to 90 characters and to Configuración.
 */
export function SettingHint({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return (
    <p id={id} data-setting-hint className={cn('text-xs leading-snug text-muted', className)}>
      {children}
    </p>
  )
}
