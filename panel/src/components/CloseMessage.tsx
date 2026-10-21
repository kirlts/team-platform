import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import { useSetClosed } from '@/lib/queries'
import { useUndo } from '@/lib/undo'
import type { MessageStatus } from '@/lib/types'
import { STATUS_KEY } from './StatusBadge'

/**
 * Close or reopen the message, beside the reply form where the decision is made (J4-flow-02: in the header it sat about 550 px above the
 * field). Closing is an operation of the screen like any edit: it shows in Deshacer, which takes it back (J1-A-28), and it is said under the header (J2-A-18).
 */
export function CloseMessage({ id, closed }: { id: string; closed: boolean }) {
  const t = useT()
  const undo = useUndo()
  const setClosed = useSetClosed()
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        disabled={setClosed.isPending}
        onClick={() =>
          void undo.run(
            {
              label: closed ? t('detail.reopened') : t('detail.closed'),
              redo: () => setClosed.mutateAsync({ id, closed: !closed }),
              undo: () => setClosed.mutateAsync({ id, closed }),
            },
            {
              announce: (result) => {
                const status = (result as { status?: MessageStatus } | undefined)?.status
                return closed ? (status ? t('detail.reopenedAs', { status: t(STATUS_KEY[status]) }) : t('detail.reopened')) : t('detail.closed')
              },
            },
          )
        }
      >
        {closed ? t('card.reopen') : t('card.close')}
      </Button>
      {setClosed.isError && (
        <p role="alert" className="w-full text-xs text-danger">
          {setClosed.error.message}
        </p>
      )}
    </>
  )
}
