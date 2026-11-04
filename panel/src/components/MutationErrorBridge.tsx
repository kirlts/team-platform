import { useEffect } from 'react'
import { useErrorText } from '@/i18n'
import { setMutationErrorSink } from '@/lib/mutation-errors'
import { useNotices } from '@/lib/notices'

/** Connects the failures of the changes (`lib/mutation-errors.ts`) to the notice of the screen. It draws nothing. */
export function MutationErrorBridge() {
  const notices = useNotices()
  const errorText = useErrorText()
  useEffect(() => setMutationErrorSink((err) => notices.show({ tone: 'danger', text: errorText(err) })), [notices.show, errorText])
  return null
}
