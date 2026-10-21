import { useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useT } from '@/i18n'
import { AREA_SWATCHES, FALLBACK_AREA_COLOR, areaStyle, isAreaColor } from '@/lib/area-color'
import { cn } from '@/lib/utils'
import type { CSSProperties } from 'react'

/**
 * The color of an area (UD-045), chosen once: eight swatches and a free color. Nothing else is asked: the tint of the analysis box, the text
 * colors and the edge come from this one color (`areaStyle`), so there is no second value to pick or to keep in step. The trigger is
 * the swatch itself; the popover shows the result as the chip the messages will carry.
 */
export function AreaColorPicker({ title, color, onChange }: { title: string; color: string | undefined; onChange: (color: string) => void | Promise<unknown> }) {
  const t = useT()
  const current = isAreaColor(color) ? color.toLowerCase() : FALLBACK_AREA_COLOR
  const [free, setFree] = useState(current)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" data-testid="area-color-trigger" aria-label={t('areas.colorOf', { title })} title={t('areas.colorOf', { title })} className="hit mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-line-strong p-0.5 hover:bg-hover">
          <span aria-hidden className="h-4 w-4 rounded-sm" style={{ background: current }} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-60 flex-col gap-3 p-3">
        <p className="text-xs font-semibold">{t('areas.color')}</p>
        <div role="group" aria-label={t('areas.color')} className="grid grid-cols-8 gap-1.5">
          {AREA_SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              data-testid="area-swatch"
              aria-label={c}
              aria-pressed={c === current}
              onClick={() => void onChange(c)}
              className={cn('h-6 w-6 rounded-md border-2 border-transparent', c === current && '!border-fg')}
              style={{ background: c }}
            />
          ))}
        </div>
        <label className="flex items-center justify-between gap-2 text-xs">
          {t('areas.colorOther')}
          <input
            type="color"
            data-testid="area-color-free"
            value={free}
            onChange={(e) => setFree(e.target.value)}
            onBlur={() => free !== current && void onChange(free)}
            className="h-7 w-12 cursor-pointer rounded border border-line-strong bg-transparent p-0.5"
          />
        </label>
        <span data-testid="area-color-preview" className="area-tint area-chip self-start" style={areaStyle(current) as CSSProperties}>
          {title}
        </span>
      </PopoverContent>
    </Popover>
  )
}
