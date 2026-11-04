import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { useT } from '@/i18n'

/**
 * The one step that confirms an action nobody can undo (soft-lock class 3): a window that names the object in its title, says what is lost in one
 * sentence and offers the verb with the same object. It is for what has no Deshacer: a member, a key of a provider, the content of the team.
 * What can be undone does not use it (UD-253); `docs/ACCIONES-DESTRUCTIVAS.md` lists which action asks for it.
 */
export function ConfirmAction({
  open,
  onOpenChange,
  title,
  consequence,
  confirmLabel,
  onConfirm,
  pending = false,
  error,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  consequence: ReactNode
  confirmLabel: string
  onConfirm: () => void
  pending?: boolean
  error?: ReactNode
}) {
  const t = useT()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} data-testid="confirm-action">
        <div className="flex min-h-0 flex-col gap-4 p-5">
          <p className="break-words text-sm">{consequence}</p>
          {error && (
            <p role="alert" className="break-words text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" disabled={pending} data-testid="confirm-action-yes" onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
