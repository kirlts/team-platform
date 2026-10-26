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
    <span data-testid="area-chip" data-repeat-ok="category" data-area-id={areaId} style={style} className={cn('area-tint area-chip', className)}>
      {/* The text lives in its own box: an ellipsis is drawn only on a block, so a chip squeezed by its line cut the name mid-letter without one. */}
      <span data-ellipsis-ok="UD-241" title={name || undefined} className="min-w-0 truncate">{name || t('area.none')}</span> {/* justified: UD-241, a chip on one line ends in an ellipsis; the whole name is in the row title and the detail */}
    </span>
  )
}
