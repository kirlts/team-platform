import { useId, useRef, useState } from 'react'
import type { ComponentProps } from 'react'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/input'
import { useT } from '@/i18n'
import type { Member } from '@team-platform/client'
import { insertMention, matchMembers, mentionQuery } from '@/lib/mention'
import { Avatar } from './Avatar'

type Props = Omit<ComponentProps<typeof Textarea>, 'value' | 'onChange'> & {
  value: string
  onChange: (text: string) => void
  /** The members that can be picked: the active ones but the person who writes. */
  candidates: Member[]
  /** The members picked so far; the parent keeps them and sends their ids. */
  picked: Member[]
  onPick: (picked: Member[]) => void
}

/**
 * A field where «@» opens the list of members (UD-278), as GitHub and Linear do: it filters while the person types, moves with the arrows, picks with Enter
 * or Tab, closes with Escape, and on a phone a touch on a name picks it. Picking leaves «@Name» in the text and the member in `picked`; what the server
 * receives is that list of ids, never the text. The field keeps the focus the whole time (the list is not a focus target).
 */
export function MentionTextarea({ value, onChange, candidates, picked, onPick, onKeyDown, onSelect, className, ...rest }: Props) {
  const t = useT()
  const listId = useId()
  const field = useRef<HTMLTextAreaElement>(null)
  const [caret, setCaret] = useState(0)
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const typing = mentionQuery(value, caret)
  const shown = typing ? matchMembers(candidates, typing.query) : []
  const open = typing !== null && dismissed !== `${typing.start}:${typing.query}` && (shown.length > 0 || candidates.length > 0)
  const index = Math.min(active, Math.max(0, shown.length - 1))

  const pick = (m: Member) => {
    if (!typing) return
    const next = insertMention(value, typing.start, caret, m.name)
    onChange(next.text)
    if (!picked.some((p) => p.id === m.id)) onPick([...picked, m])
    setActive(0)
    setCaret(next.caret)
    requestAnimationFrame(() => {
      field.current?.focus()
      field.current?.setSelectionRange(next.caret, next.caret)
    })
  }

  return (
    <Popover open={open}>
      <PopoverAnchor asChild>
        <Textarea
          {...rest}
          ref={field}
          value={value}
          className={className}
          aria-autocomplete="list"
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open && shown.length > 0 ? `${listId}-${index}` : undefined}
          onChange={(e) => {
            onChange(e.target.value)
            setDismissed(null) // Escape closes the list for the word being typed; typing again opens it
            setCaret(e.target.selectionStart ?? e.target.value.length)
            setActive(0)
          }}
          onSelect={(e) => {
            setCaret(e.currentTarget.selectionStart ?? 0)
            onSelect?.(e)
          }}
          onKeyDown={(e) => {
            if (open && shown.length > 0) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((index + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length)
                return
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                pick(shown[index])
                return
              }
            }
            if (open && e.key === 'Escape' && typing) {
              e.preventDefault()
              e.stopPropagation()
              setDismissed(`${typing.start}:${typing.query}`)
              return
            }
            onKeyDown?.(e)
          }}
        />
      </PopoverAnchor>
      <PopoverContent side="top" align="start" sideOffset={6} collisionPadding={8} onOpenAutoFocus={(e) => e.preventDefault()} onCloseAutoFocus={(e) => e.preventDefault()} onInteractOutside={(e) => e.preventDefault()} className="w-72 p-1">
        <ul id={listId} role="listbox" aria-label={t('mention.list')} data-lane="mention-list" className="scroll-thin flex max-h-56 flex-col overflow-y-auto">
          {shown.map((m, i) => (
            <li key={m.id} id={`${listId}-${i}`} role="option" aria-selected={i === index} data-active={i === index || undefined}>
              {/* A touch picks on pointer down and keeps the focus in the field, so the keyboard of a phone stays open. */}
              <button
                type="button"
                tabIndex={-1}
                onPointerDown={(e) => {
                  e.preventDefault()
                  pick(m)
                }}
                onMouseEnter={() => setActive(i)}
                className="flex min-h-10 w-full items-center gap-2 rounded-option px-2 py-1.5 text-left hover:bg-hover data-[active]:bg-hover pointer-coarse:min-h-11"
                data-active={i === index || undefined}
              >
                <Avatar name={m.name} size={20} />
                <span data-mention-name className="min-w-0 flex-1 break-words leading-tight">{m.name}</span>
              </button>
            </li>
          ))}
          {shown.length === 0 && <li className="px-2 py-2 text-sm text-muted">{t('mention.none')}</li>}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
