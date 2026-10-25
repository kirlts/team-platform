import { RotateCw } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { useErrorText, useT } from '@/i18n'
import { useNotices } from '@/lib/notices'
import type { InputRecord } from '@team-platform/client'
import { useMe, useReprocess } from '@team-platform/client/react'
import { useOptionalUndo } from '@/lib/undo'

/** Where «Borrados» lives: the list of messages with that filter on (UD-250). */
export const TRASH_PATH = '/messages?f=deleted:eq:si'

/**
 * Analyzes a published send again (UD-258), for any person of the team (UD-287). One click, no confirmation (UD-253): the messages it had go to the
 * trash with their replies and the notice says how many, with the way to «Borrados» to bring them back.
 */
export function ReprocessSend({ input, className }: { input: InputRecord; className?: string }) {
  const t = useT()
  const errorText = useErrorText()
  const notices = useNotices()
  const undo = useOptionalUndo()
  const me = useMe().data
  const reprocess = useReprocess()
  if (!me) return null

  const run = async () => {
    try {
      const done = await reprocess.mutateAsync(input.id)
      // The edits made on the messages that left would act on messages nobody sees.
      undo?.clear()
      notices.show({ text: t('send.reprocessed', { n: done.set_aside?.messages ?? 0 }), link: { to: TRASH_PATH, label: t('restore.messages') } })
    } catch (err) {
      notices.show({ tone: 'danger', text: errorText(err) })
    }
  }

  return (
    <Button size="sm" variant="ghost" className={`hit ${className ?? ''}`} data-testid="reprocess-send" title={t('send.reprocessHint')} disabled={reprocess.isPending} onClick={() => void run()}>
      <RotateCw size={13} aria-hidden /> {t('send.reprocess')}
    </Button>
  )
}
