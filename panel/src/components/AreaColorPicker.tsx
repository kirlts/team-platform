import { useState } from 'react'
import { Check } from '@/components/icons'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useT } from '@/i18n'
import { AREA_SWATCHES, FALLBACK_AREA_COLOR, areaStyle, isAreaColor } from '@/lib/area-color'
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
        <button type="button" data-testid="area-color-trigger" aria-label={t('areas.colorOf', { title })} title={t('areas.colorOf', { title })} className="hit inline-flex size-6 shrink-0 items-center justify-center rounded-full p-1 hover:bg-hover pointer-coarse:size-11">
          <span aria-hidden className="size-4 rounded-full" style={{ background: current }} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-64 flex-col gap-4 p-4">
        <p className="rotulo">{t('areas.color')}</p>
        <div role="group" aria-label={t('areas.color')} className="grid grid-cols-4 gap-3">
          {AREA_SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              data-testid="area-swatch"
              aria-label={c}
              aria-pressed={c === current}
              onClick={() => void onChange(c)}
              className="inline-flex size-9 items-center justify-center rounded-full text-white pointer-coarse:size-11"
              style={{ background: c }}
            >
              {c === current && <Check size={16} aria-hidden strokeWidth={2.5} />}
            </button>
          ))}
        </div>
        <label className="flex items-center justify-between gap-3 text-sm">
          {t('areas.colorOther')}
          <input
            type="color"
            data-testid="area-color-free"
            value={free}
            onChange={(e) => setFree(e.target.value)}
            onBlur={() => free !== current && void onChange(free)}
            className="h-9 w-14 cursor-pointer rounded-field border border-line-strong bg-transparent p-1"
          />
        </label>
        <span data-testid="area-color-preview" className="area-tint area-chip self-start" style={areaStyle(current) as CSSProperties}>
          {title}
        </span>
      </PopoverContent>
    </Popover>
  )
}
