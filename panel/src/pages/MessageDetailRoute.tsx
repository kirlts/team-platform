import { useParams } from 'react-router'
import { MessageDetail } from './MessageDetail'

/**
 * The element of the route `messages/:id`. React Router keeps the instance of a route element when only a parameter changes, so the undo stack of
 * the sheet (and Ctrl+Z, which is global) would follow the person from one message to another and revert the edit of the one left behind (TP-12).
 * Keyed by the id, each message gets its own sheet and its own stack.
 */
export function MessageDetailRoute() {
  const { id } = useParams()
  return <MessageDetail key={id} />
}
