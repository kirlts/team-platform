import { ChevronDown } from '@/components/icons'
import { useQueryClient } from '@tanstack/react-query'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useT } from '@/i18n'
import { api, unwrapList } from '@/lib/api'
import type { Template } from '@/lib/types'
import { useLookups } from './lookups'

/**
 * Área de un mensaje como pestaña de cromo cambiable. Al elegir otra área trae su primera plantilla
 * vigente y la entrega con el área, porque los campos del mensaje dependen de ella: quien llama
 * los reasigna con `remapFields`.
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

  const choose = async (next: string) => {
    if (next === areaId) return
    let first: Template | null = null
    try {
      const list = await queryClient.fetchQuery({ queryKey: ['templates', next], queryFn: async () => unwrapList<Template>(await api(`/areas/${next}/templates`)) })
      first = list.find((x) => !x.deleted_at) ?? null
    } catch {
      // Sin acceso a las plantillas del área, el servidor elige la que corresponde.
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
          className="inline-flex min-h-6 max-w-full items-center gap-1 rounded-[3px_9px_3px_9px] border border-edge bg-[linear-gradient(180deg,var(--color-chrome-1),var(--color-chrome-2))] py-0.5 pl-2 pr-1.5 text-left text-xs font-semibold leading-tight text-fg hover:border-accent disabled:opacity-60"
        >
          {areaTitle(areaId) || t('area.none')}
          <ChevronDown size={12} aria-hidden className="shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup value={areaId} onValueChange={(v) => void choose(v)}>
          {areas.map((a) => (
            <DropdownMenuRadioItem key={a.id} value={a.id}>
              {a.title}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
