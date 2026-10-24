import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useT } from '@/i18n'
import { client } from '@/lib/client'

/**
 * What was said in the audio or video of a reply (UD-277), under it in the thread. It loads when the server says it has one. A long one reads as its first
 * lines and opens whole with «Ver más»: a fold, not a cut, and the button only shows when the text does not fit.
 */
export function ReplyTranscript({ src, name }: { src: string; name?: string }) {
  const t = useT()
  const [text, setText] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [long, setLong] = useState(false)
  const box = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    const abort = new AbortController()
    client
      .raw(src, { signal: abort.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { text?: string } | null) => setText(data?.text?.trim() ? data.text : null))
      .catch(() => setText(null))
    return () => abort.abort()
  }, [src])
  useLayoutEffect(() => {
    const el = box.current
    if (el && !open) setLong(el.scrollHeight > el.clientHeight + 1)
  }, [text, open])
  const fold = open ? '' : 'line-clamp-3' // justified: a fold, not a cut; «Ver más» opens the whole text and it is there whenever the text does not fit
  if (!text) return null
  return (
    <div data-testid="reply-transcript" className="flex min-w-0 flex-col items-start gap-0.5 rounded-md bg-hover px-3 py-2">
      <span className="rotulo">{name ? `${t('gallery.transcript')}: ${name}` : t('gallery.transcript')}</span>
      <p ref={box} className={`whitespace-pre-line break-words text-sm ${fold}`}>
        {text}
      </p>
      {(long || open) && (
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="text-sm font-semibold text-accent-deep hover:underline">
          {open ? t('team.profileLess') : t('team.profileMore')}
        </button>
      )}
    </div>
  )
}
