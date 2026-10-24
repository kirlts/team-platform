import { RotateCw } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { useErrorText, useT } from '@/i18n'
import { useRetryExecute } from '@team-platform/client/react'

/**
 * UD-282: «Reintentar» under the notice of a session that failed. It launches the same job again (same message, same mention or forward, same files); the
 * server decides whether it can (`retryable` on the reply) and the button disappears when the new job is queued, because the thread already shows its progress.
 */
export function RetryExecute({ messageId, replyId }: { messageId: string; replyId: string }) {
  const t = useT()
  const errorText = useErrorText()
  const retry = useRetryExecute(messageId)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="secondary" data-testid="retry-execute" disabled={retry.isPending} onClick={() => retry.mutate(replyId)}>
        <RotateCw size={14} aria-hidden /> {t('replies.retry')}
      </Button>
      {retry.isError && (
        <span role="alert" className="min-w-0 break-words text-sm text-danger">
          {errorText(retry.error)}
        </span>
      )}
    </div>
  )
}
