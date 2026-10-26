import type { CSSProperties } from 'react'
import { areaStyle } from '@/lib/area-color'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { useLookups } from './lookups'

/** The CSS variables of an area's colors, for any element that wears `.area-tint`. */
export function useAreaStyle(areaId: string | undefined): CSSProperties {
  const { areaColor } = useLookups()
  return areaStyle(areaId ? areaColor(areaId) : undefined) as CSSProperties
}

/**
 * The area of a message as a chip with its own container and its own color (UD-045). It is the one mark of an area everywhere:
 * the message rows and cards, the detail, the analysis, the tabs of the cards of Inicio. It always carries the area's name: the color
 * helps to find it at a glance and never replaces the word. The state of a message is a different mark (a shape and a word), so an area
 * color is never read as a state.
 */
export function AreaChip({ areaId, title, className }: { areaId: string; title?: string; className?: string }) {
  const t = useT()
  const { areaTitle } = useLookups()
  const style = useAreaStyle(areaId)
  const name = title ?? areaTitle(areaId)
  return (
    <span data-testid="area-chip" data-repeat-ok="category" data-area-id={areaId} style={style} title={name || undefined} className={cn('area-tint area-chip', className)}>
      {name || t('area.none')}
    </span>
  )
}
