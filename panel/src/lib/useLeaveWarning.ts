import { useEffect } from 'react'

/**
 * While `active`, closing the tab or reloading asks first. It is for what a draft cannot keep: the files of a send (a `File` is not serializable, TP-04).
 * It is registered only while there is something to lose, so a page with nothing to protect still enters the browser's back/forward cache.
 */
export function useLeaveWarning(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [active])
}
