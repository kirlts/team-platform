import { useT } from '@/i18n'
import { EXECUTE_MODELS, type Area } from '@team-platform/client'
import { useMe } from '@team-platform/client/react'
import { NativeSelect, ON_PAGE_FIELD } from '@/components/NativeSelect'

/**
 * The two Claude models of the area (UD-295): the light one, which takes what the analyzer estimates within its limits, and the larger one, where its work escalates and which takes the rest.
 * Two selects, each the field: they save on change. Only the Editor sees them and changes them (the API answers 403 to anyone else, UD-297); anyone else reads the value as text.
 */
export function AreaModels({ area, onChange }: { area: Area; onChange: (field: 'execute_model' | 'execute_model_light', id: string) => void | Promise<unknown> }) {
  const t = useT()
  const canEdit = useMe().data?.role === 'editor'
  const labelOf = (id: string | null | undefined) => EXECUTE_MODELS.find((m) => m.id === id)?.label ?? id ?? ''
  const fields = [
    { field: 'execute_model_light' as const, label: t('areas.modelLight'), value: area.execute_model_light ?? '' },
    { field: 'execute_model' as const, label: t('areas.modelMajor'), value: area.execute_model ?? '' },
  ]
  return (
    <>
      {fields.map(({ field, label, value }) => (
        <label key={field} className="flex w-full min-w-0 flex-col items-start gap-2 sm:w-auto">
          <span className="rotulo">{label}</span>
          {canEdit ? (
            <span className="w-full sm:w-40">
              <NativeSelect className={ON_PAGE_FIELD} value={value} onChange={(e) => void onChange(field, e.target.value)} aria-label={label} data-testid={`area-${field.replace(/_/g, '-')}-select`}>
                {EXECUTE_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                {value !== '' && !EXECUTE_MODELS.some((m) => m.id === value) && <option value={value}>{value}</option>}
              </NativeSelect>
            </span>
          ) : (
            <span className="font-semibold">{labelOf(value)}</span>
          )}
        </label>
      ))}
    </>
  )
}
