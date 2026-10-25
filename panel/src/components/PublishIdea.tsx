import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { useErrorText, useT } from '@/i18n'
import { useDeliver } from '@team-platform/client/react'

/**
 * UD-306: the «Lista para ver» reply of work that was shown and not delivered. «Publicar» is the approval of a person: it runs the normal delivery of the branch
 * (POST /messages/:id/deliver). Until then nothing is in production. `children` is the text of the reply.
 */
export function PublishIdea({ messageId, children }: { messageId: string; children: ReactNode }) {
  const t = useT()
  const errorText = useErrorText()
  const deliver = useDeliver(messageId)
  return (
    <>
      {children}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" data-testid="publish-idea" disabled={deliver.isPending || deliver.isSuccess} onClick={() => deliver.mutate()}>
          {t('replies.publish')}
        </Button>
        {deliver.isError && (
          <span role="alert" className="min-w-0 break-words text-sm text-danger">
            {errorText(deliver.error)}
          </span>
        )}
      </div>
    </>
  )
}
