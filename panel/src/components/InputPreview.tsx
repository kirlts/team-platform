import { useState } from 'react'
import { attachmentUrl } from '@/lib/api'
import type { InputRecord } from '@/lib/types'
import { Thumb } from './Thumb'

/** Texto y adjuntos del input enviado, tal como quedaron en el servidor. */
export function InputPreview({ input }: { input: InputRecord }) {
  const [expanded, setExpanded] = useState(false)
  const long = input.text.length > 320 || input.text.split('\n').length > 6
  const audios = input.attachments.filter((a) => a.kind === 'audio')
  const visual = input.attachments.filter((a) => a.kind !== 'audio')

  return (
    <section aria-label="Mensaje enviado" className="flex min-w-0 flex-col gap-3">
      <h2>Mensaje</h2>
      {input.text.trim() && (
        <div>
          <p className={`whitespace-pre-wrap break-words text-sm ${expanded ? '' : 'line-clamp-8'}`}>{input.text}</p>
          {long && (
            <button type="button" className="mt-1 text-xs text-accent hover:underline" onClick={() => setExpanded((v) => !v)}>
              {expanded ? 'Ver menos' : 'Ver más'}
            </button>
          )}
        </div>
      )}
      {visual.length > 0 && (
        <ul className="flex flex-wrap gap-2.5">
          {visual.map((a) => (
            <li key={a.id}>
              <Thumb
                item={{ kind: a.kind, src: a.kind === 'link' ? undefined : attachmentUrl(a.id), name: a.name, size: a.size }}
                px={72}
                href={a.kind === 'link' ? a.name : attachmentUrl(a.id)}
              />
            </li>
          ))}
        </ul>
      )}
      {audios.map((a) => (
        <figure key={a.id} className="flex flex-col gap-1">
          <figcaption className="truncate text-xs text-muted">{a.name}</figcaption>
          <audio controls preload="metadata" src={attachmentUrl(a.id)} className="h-9 w-full max-w-sm" />
        </figure>
      ))}
    </section>
  )
}
