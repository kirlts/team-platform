import { MutationCache } from '@tanstack/react-query'

/**
 * No failed change is mute (TP-17). A change made through `mutate()` has nobody to catch its rejection, so the button used to come
 * back and nothing said whether the deletion, the Undo or the Discard happened. The cache of the panel reports every failure to
 * one place, the notice of the screen, except:
 * - what already showed it in place: the code that caught the rejection and wrote its text with `useErrorText()` claims the error;
 * - a mutation that declares `meta: { silent: true }`.
 *
 * The report waits one task. The rejection reaches the caller's `catch` through microtasks, and every microtask of that chain
 * runs before the next task, so by then a caller that shows its own error has claimed it. It is the order of the event loop, not a
 * guessed delay.
 */
const claimed = new WeakSet<object>()

/** An error that something already wrote in place: the notice does not repeat it. */
export function claimError(err: unknown): void {
  if (typeof err === 'object' && err !== null) claimed.add(err)
}

type Sink = (err: unknown) => void
let sink: Sink | null = null

/** The notice of the screen takes the failures while the shell is mounted; returns what retires it. */
export function setMutationErrorSink(next: Sink): () => void {
  sink = next
  return () => {
    if (sink === next) sink = null
  }
}

export function createMutationCache(): MutationCache {
  return new MutationCache({
    onError: (err, _variables, _context, mutation) => {
      if (mutation.meta?.silent) return
      setTimeout(() => {
        if (typeof err === 'object' && err !== null && claimed.has(err)) return
        sink?.(err)
      }, 0)
    },
  })
}
