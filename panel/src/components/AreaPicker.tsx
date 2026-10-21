import { ChevronDown } from '@/components/icons'
import { useQueryClient } from '@tanstack/react-query'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useT } from '@/i18n'
import { api, unwrapList } from '@/lib/api'
import type { Template } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useAreaStyle } from './AreaChip'
import { useLookups } from './lookups'

/**
 * Area of a message as a swappable chrome tab. Choosing another area brings its first current
 * template and hands it over with the area, because the message's fields depend on it: the caller
 * reassigns them with `remapFields`.
 */
export function AreaPicker({
  areaId,
  templateName,
  onChange,
  disabled,
}: {
  areaId: string
  templateName?: string
  onChange: (areaId: string, template: Template | null) => void | Promise<unknown>
  disabled?: boolean
}) {
  const t = useT()
  const { areas, areaTitle } = useLookups()
  const queryClient = useQueryClient()
  const style = useAreaStyle(areaId)

  const choose = async (next: string) => {
    if (next === areaId) return
    let first: Template | null = null
    try {
      const list = await queryClient.fetchQuery({ queryKey: ['templates', next], queryFn: async () => unwrapList<Template>(await api(`/areas/${next}/templates`)) })
      first = list.find((x) => !x.deleted_at) ?? null
    } catch {
      // Without access to the area's templates, the server picks the matching one.
    }
    await onChange(next, first)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={t('area.pick', { area: areaTitle(areaId) || t('area.none'), template: templateName ?? '' })}
          title={templateName}
          style={style}
          data-testid="area-picker"
          data-repeat-ok="category"
          // The area is the chip of its color; choosing another repaints the box of the analysis (UD-045).
          className={cn('hit area-tint area-chip text-left hover:brightness-95 disabled:opacity-60')}
        >
          {areaTitle(areaId) || t('area.none')}
          <ChevronDown size={12} aria-hidden className="shrink-0" />
        </button>
      </DropdownMenuTrigger>
      {/* A long area title wraps inside a bounded menu instead of widening it (J3-B-28); UD-016 rules out cutting it. */}
      <DropdownMenuContent align="start" collisionPadding={8} className="max-w-[min(22rem,calc(100vw-1rem))]">
        <DropdownMenuRadioGroup value={areaId} onValueChange={(v) => void choose(v)}>
          {areas.map((a) => (
            <DropdownMenuRadioItem key={a.id} value={a.id} className="h-auto items-start">
              {a.title}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
