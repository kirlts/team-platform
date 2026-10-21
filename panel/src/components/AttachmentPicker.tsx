import { Check, Plus } from '@/components/icons'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useT } from '@/i18n'
import { attachmentUrl } from '@/lib/api'
import { MEDIA_KEY } from '@/lib/media'
import type { Attachment } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Thumb } from './Thumb'

/**
 * Adjuntos de un mensaje propuesto: los primeros como miniaturas quitables y, tras ellos, el botón
 * que abre la lista de todos los del input con su marca. Pasado `max` el botón dice «+N».
 */
export function AttachmentPicker({ all, selected, onChange, max = 3 }: { all: Attachment[]; selected: string[]; onChange: (ids: string[]) => void; max?: number }) {
  const t = useT()
  const included = all.filter((a) => selected.includes(a.id))
  const shown = included.slice(0, max)
  const hidden = included.length - shown.length
  if (all.length === 0) return null
  return (
    <ul aria-label={t('media.attachments')} className="flex flex-wrap items-center gap-2">
      {shown.map((a) => (
        <li key={a.id}>
          <Thumb item={{ kind: a.kind, src: a.kind === 'link' ? undefined : attachmentUrl(a.id), name: a.name, size: a.size }} px={32} onRemove={() => onChange(selected.filter((x) => x !== a.id))} />
        </li>
      ))}
      <li>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={t('media.pick')}
              className="inline-flex h-7 min-w-7 items-center justify-center gap-0.5 rounded-md border border-dashed border-line-strong px-1.5 text-xs font-semibold text-muted hover:border-accent hover:text-accent"
            >
              {hidden > 0 ? `+${hidden}` : <Plus size={13} aria-hidden />}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-1">
            <ul data-lane="attachment-picker" className="scroll-thin flex max-h-72 flex-col overflow-y-auto">
              {all.map((a) => {
                const on = selected.includes(a.id)
                return (
                  <li key={a.id}>
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={on}
                      onClick={() => onChange(on ? selected.filter((x) => x !== a.id) : [...selected, a.id])}
                      className={cn('flex min-h-9 w-full items-center gap-2 rounded-sm px-2 py-1 text-left hover:bg-hover', on && 'bg-accent-soft/40')}
                    >
                      <Thumb item={{ kind: a.kind, src: a.kind === 'link' ? undefined : attachmentUrl(a.id), name: a.name, size: a.size }} px={28} />
                      <span className="min-w-0 flex-1 text-xs leading-tight [overflow-wrap:anywhere]">
                        <span className="block text-[13px]">{t(MEDIA_KEY[a.kind])}</span>
                        <span className="text-muted">{a.name}</span>
                      </span>
                      <span aria-hidden className="inline-flex w-4 text-accent">
                        {on && <Check size={14} />}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </PopoverContent>
        </Popover>
      </li>
    </ul>
  )
}
