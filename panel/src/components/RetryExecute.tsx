import type { ReactNode } from 'react'
import { RotateCw } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { useErrorText, useT } from '@/i18n'
import type { Reply } from '@team-platform/client'
import { useJobProgress, useRetryExecute } from '@team-platform/client/react'
import { cn } from '@/lib/utils'
import { Meter } from './Meter'

/**
 * UD-282, UD-290: the notice of a session that failed, with «Reintentar» under it. At the click, before the server answers, the notice is replaced in its
 * place by the state of the job (`Reintentando`, the bar and the phrase of the job's progress from the event stream), as a re-run does on its row. If the
 * server refuses, the notice comes back with the reason; if the new job fails, its own notice takes the place. `children` is the notice's text.
 */
export function RetryExecute({ messageId, reply, children }: { messageId: string; reply: Reply; children: ReactNode }) {
  const retry = useRetryExecute(messageId)
  const active = retry.isPending || retry.isSuccess || Boolean(reply.retrying)
  if (active) return <Retrying jobId={retry.data?.job_id ?? reply.replaced_by_job_id ?? undefined} />
  return (
    <>
      {children}
      {reply.retryable && <RetryButton reply={reply} retry={retry} />}
    </>
  )
}

/** «Reintentar» of a failed notice, named by what it repeats (`replies.retry` or `replies.retryPublish`) and with the reason if the server refuses. */
export function RetryButton({ reply, retry, className, testId = 'retry-execute' }: { reply: Reply; retry: ReturnType<typeof useRetryExecute>; className?: string; testId?: string }) {
  const t = useT()
  const errorText = useErrorText()
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <Button size="sm" variant="secondary" data-testid={testId} onClick={() => retry.mutate(reply.id)}>
        <RotateCw size={14} aria-hidden /> {t(reply.retry_action === 'publish' ? 'replies.retryPublish' : 'replies.retry')}
      </Button>
      {retry.isError && (
        <span role="alert" className="min-w-0 break-words text-sm text-danger">
          {errorText(retry.error)}
        </span>
      )}
    </div>
  )
}

/** The notice's place while its job runs: the state, the bar (it travels until the first step) and the phrase of the job's progress. */
function Retrying({ jobId }: { jobId: string | undefined }) {
  const t = useT()
  const progress = useJobProgress(jobId, undefined)
  return (
    <div data-testid="retrying" role="status" className="flex flex-col gap-1">
      <Meter percent={progress?.percent ?? 0} label={t('common.retrying')} />
      <p className="text-sm text-muted">{t('common.retrying')}</p>
      {progress?.phrase && <p data-testid="retrying-phrase" className="text-xs text-muted">{progress.phrase}</p>}
    </div>
  )
}
