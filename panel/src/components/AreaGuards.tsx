import type { Area, Guard } from '@team-platform/client'
import { useSaveArea } from '@team-platform/client/react'
import { Trash2 } from '@/components/icons'
import { EditableText } from '@/components/EditableText'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { useT } from '@/i18n'
import { useUndo } from '@/lib/undo'

/**
 * The Guards of an area (UD-292, Kairós), under its description, which describes its space: its walls, the only boolean thing, each with the mechanism that holds it and whether it is about a person. The Editor writes them (configured
 * text); the analyzer reads their text and cites them by id; a touched Guard about a person puts a person on the message. Every field is edited in place and the whole list is saved
 * with each change, so a Guard keeps its id (a message that cites it keeps pointing at it).
 */
export function AreaGuards({ area, canEdit }: { area: Area; canEdit: boolean }) {
  const t = useT()
  const save = useSaveArea()
  const undo = useUndo()
  const guards: Guard[] = area.guards ?? []
  const [open, setOpen] = useState(false)
  const change = (next: Guard[]) => {
    const prev = guards
    return undo.run({ label: t('areas.guardsEdited'), redo: () => save.mutateAsync({ id: area.id, guards: next }), undo: () => save.mutateAsync({ id: area.id, guards: prev }) })
  }
  const replace = (index: number, patch: Partial<Guard>) => change(guards.map((g, i) => (i === index ? { ...g, ...patch } : g)))
  const required = (v: string) => (v.trim() === '' ? t('common.required') : null)
  return (
    <>
      <Button type="button" variant="secondary" size="sm" className="px-3 text-xs" data-testid="area-guards-open" onClick={() => setOpen(true)}>
        {t('areas.guards')}{guards.length > 0 && <span className="ml-1.5 tabular-nums text-muted">{guards.length}</span>}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={t('areas.guards')}>
          <div data-testid="area-guards" className="flex min-w-0 flex-col gap-4 text-sm">
        {guards.length === 0 && <p className="m-0 text-muted">{t('areas.guardsNone')}</p>}
        {guards.map((g, i) => (
          <div key={g.id ?? `new-${i}`} data-testid="area-guard" className="flex flex-col gap-1 border-b border-line pb-3 last:border-b-0">
            <EditableText value={g.text} label={t('areas.guardText')} canEdit={canEdit} validate={required} onSave={(v) => replace(i, { text: v.trim() })} displayClassName="font-semibold" />
            <EditableText value={g.mechanism ?? ''} label={t('areas.guardMechanism')} canEdit={canEdit} onSave={(v) => replace(i, { mechanism: v.trim() })} placeholder={t('areas.guardMechanism')} emptyLabel={t('areas.guardMechanism')} displayClassName="text-muted" />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex min-h-6 items-center gap-2">
                <input type="checkbox" checked={g.person === true} disabled={!canEdit} onChange={(e) => void replace(i, { person: e.target.checked })} />
                <span>{t('areas.guardPerson')}</span>
              </label>
              {canEdit && (
                <Button size="sm" variant="ghost" className="px-1.5 text-xs text-muted hover:text-danger" aria-label={t('areas.guardRemove')} onClick={() => void change(guards.filter((_, k) => k !== i))}>
                  <Trash2 size={16} aria-hidden />
                </Button>
              )}
            </div>
          </div>
        ))}
        {canEdit && (
          <div>
            <Button size="sm" variant="secondary" className="px-3 text-xs" data-testid="guard-add" onClick={() => void change([...guards, { text: t('areas.guardText'), mechanism: '', person: false }])}>
              {t('areas.guardAdd')}
            </Button>
          </div>
        )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
