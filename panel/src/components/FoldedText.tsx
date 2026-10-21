import { useState, type ComponentProps } from 'react'
import { useT } from '@/i18n'
import { EditableText } from './EditableText'

/**
 * A long text edited in place that reads as its first paragraph and opens whole with «Ver más» (J3-A-38, J3-A-42). It is a fold, not a cut:
 * nothing is replaced by an ellipsis (UD-016), the rest is one click away, and editing always shows all of it.
 */
export function FoldedText({
  value,
  className,
  open,
  onOpenChange,
  ...rest
}: ComponentProps<typeof EditableText> & {
  /** The fold kept by the caller, for a list that draws this text again when it changes page: a state kept here would be lost with the row. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const t = useT()
  const [own, setOwn] = useState(false)
  const more = open ?? own
  const paragraphs = value.split(/\n\s*\n/).filter((x) => x.trim())
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <EditableText
        {...rest}
        value={value}
        className={className}
        multiline
        prose
        render={more || paragraphs.length < 2 ? undefined : (v) => <span className="prose-block block whitespace-pre-wrap break-words">{v.split(/\n\s*\n/)[0]}</span>}
      />
      {paragraphs.length > 1 && (
        <button type="button" aria-expanded={more} onClick={() => {
            onOpenChange?.(!more)
            setOwn(!more)
          }} className="-my-[4px] py-[4px] text-xs font-semibold text-accent-deep hover:underline">
          {more ? t('team.profileLess') : t('team.profileMore')}
        </button>
      )}
    </div>
  )
}
