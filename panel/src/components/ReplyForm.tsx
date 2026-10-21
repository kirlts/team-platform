import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { useReply } from '@/lib/queries'
import type { ReplyKind } from '@/lib/types'
import { Segmented } from './Segmented'

export const KIND_LABEL: Record<ReplyKind, string> = {
  answer: 'Respuesta',
  fix: 'Arreglo',
  clarification: 'Aclaración',
}

const KIND_OPTIONS = (Object.keys(KIND_LABEL) as ReplyKind[]).map((value) => ({ value, label: KIND_LABEL[value] }))

export function ReplyForm({
  messageId,
  onSent,
  autoFocus,
}: {
  messageId: string
  onSent?: () => void
  autoFocus?: boolean
}) {
  const [body, setBody] = useState('')
  const [kind, setKind] = useState<ReplyKind>('answer')
  const reply = useReply(messageId)

  const submit = () => {
    if (!body.trim() || reply.isPending) return
    reply.mutate(
      { body: body.trim(), kind },
      {
        onSuccess: () => {
          setBody('')
          setKind('answer')
          onSent?.()
        },
      },
    )
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className="flex flex-col gap-2"
    >
      <Textarea
        aria-label="Respuesta"
        placeholder="Respuesta"
        autoFocus={autoFocus}
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            submit()
          }
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented label="Tipo de respuesta" size="sm" value={kind} onChange={setKind} options={KIND_OPTIONS} />
        <Button type="submit" variant="primary" disabled={!body.trim() || reply.isPending}>
          Responder
        </Button>
      </div>
      {reply.isError && (
        <p role="alert" className="text-xs text-danger">
          {reply.error.message}
        </p>
      )}
    </form>
  )
}
