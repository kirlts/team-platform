import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import type { MessageStatus } from '@team-platform/client'
import { useSetClosed } from '@team-platform/client/react'
import { useDesktop } from '@/lib/useDesktop'
import { useUndo } from '@/lib/undo'
import { STATUS_KEY } from './StatusBadge'

/**
 * Close or reopen the message, beside the reply form where the decision is made (J4-flow-02: in the header it sat about 550 px above the
 * field). Closing is an operation of the screen like any edit: it shows in Deshacer, which takes it back (J1-A-28), and it is said under the header (J2-A-18).
 */
export function CloseMessage({ id, closed, quiet = false }: { id: string; closed: boolean; quiet?: boolean }) {
  const t = useT()
  const undo = useUndo()
  const setClosed = useSetClosed()
  // On a phone the notice floats over the foot of the page, exactly over this button and the word «Cerrado» (J5-flow-reply-close): the change is
  // said by the box that replaces the form and by the button that turns into «Reabrir», which is the undo.
  const desktop = useDesktop()
  return (
    <>
      <Button
        type="button"
        variant={quiet ? 'ghost' : 'secondary'}
        disabled={setClosed.isPending}
        onClick={() =>
          void undo.run(
            {
              label: closed ? t('detail.reopened') : t('detail.closed'),
              redo: () => setClosed.mutateAsync({ id, closed: !closed }),
              undo: () => setClosed.mutateAsync({ id, closed }),
            },
            desktop
              ? {
              announce: (result) => {
                const status = (result as { status?: MessageStatus } | undefined)?.status
                return closed ? (status ? t('detail.reopenedAs', { status: t(STATUS_KEY[status]) }) : t('detail.reopened')) : t('detail.closed')
              },
            }
              : undefined,
          )
        }
      >
        {closed ? t('reply.reopen') : t('reply.close')}
      </Button>
      {setClosed.isError && (
        <p role="alert" className="w-full text-xs text-danger">
          {setClosed.error.message}
        </p>
      )}
    </>
  )
}
