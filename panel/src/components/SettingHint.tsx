import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * One-line datum of a setting of Configuración, only where the name cannot carry it. `id` is what the control names in
 * `aria-describedby`. Texts come from the `hint.*` keys of the catalogues; a guard (ui-voice.test.ts) limits them to 90 characters and
 * to Configuración. There is no help text by default (Voz de instrumento): it is drawn (`visible`) only where without it the person
 * makes a mistake, such as an action that deletes or spends; everywhere else a screen reader still reads it, and the eye does not.
 */
export function SettingHint({ id, children, className, visible = false }: { id: string; children: ReactNode; className?: string; visible?: boolean }) {
  return (
    <p id={id} data-setting-hint className={cn(visible ? 'text-sm leading-snug text-muted' : 'sr-only', className)}>
      {children}
    </p>
  )
}
