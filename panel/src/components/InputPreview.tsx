import { attachmentUrl } from '@/lib/api'
import type { InputRecord } from '@/lib/types'
import { Thumb } from './Thumb'

/** Texto y adjuntos del input enviado, tal como quedaron en el servidor. */
export function InputPreview({ input }: { input: InputRecord }) {
  const audios = input.attachments.filter((a) => a.kind === 'audio')
  const visual = input.attachments.filter((a) => a.kind !== 'audio')

  return (
    <section aria-label="Mensaje enviado" className="flex min-w-0 flex-col gap-3">
      <h2>Mensaje</h2>
      {input.text.trim() && (
        // Un texto largo se desplaza dentro de su recuadro; nunca se corta con puntos suspensivos.
        <p className="scroll-thin max-h-72 overflow-y-auto whitespace-pre-wrap break-words text-sm">{input.text}</p>
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
          <figcaption className="break-words text-xs text-muted">{a.name}</figcaption>
          <audio controls preload="metadata" src={attachmentUrl(a.id)} className="h-9 w-full max-w-sm" />
        </figure>
      ))}
    </section>
  )
}
