// What each operation makes stale. After a change the roots below are invalidated, so every list and detail that shows
// the data is read again. The table is the whole policy of the panel; another interface repeats it by calling `invalidate`.
import type { QueryRoot } from './keys.js'

/** The slice of a TanStack `QueryClient` this file needs; every adapter of TanStack Query (React, Vue, Svelte…) has it. */
export interface QueryClientLike {
  invalidateQueries(filters: { queryKey: readonly unknown[]; refetchType?: 'active' | 'inactive' | 'all' | 'none' }): Promise<unknown>
}

export const INVALIDATE = {
  // Inputs (sends)
  publish: ['messages', 'areas', 'inputs'],
  /** A published send sets its messages aside (UD-258): the lists of messages and the counts of areas change with it. */
  reprocess: ['inputs', 'messages', 'areas'],
  restoreInput: ['inputs'],
  deleteInput: ['inputs', 'messages', 'areas'],
  cancelInput: ['inputs'],
  // Messages and replies
  reply: ['message', 'messages', 'areas'],
  /** After an edit of a published message; the detail itself is written with the answer (`mergeSavedMessage`). */
  patchMessage: ['messages', 'areas', 'inputs'],
  addAttachments: ['messages', 'inputs'],
  /** After an edit of a reply; the detail is written with the answer. */
  editReply: ['messages'],
  setClosed: ['message', 'messages', 'areas'],
  /** The assessment of a message changed by hand (UD-295) changes its card and the model of its next session. */
  setAssessment: ['message', 'messages'],
  /** A forward adds an assignee and a notice to the thread of the message, and with an agent a job that the lists of executions show. */
  /** Delivering or discarding a held review changes the thread, the view of the message and the lists of jobs. */
  deliverReview: ['message', 'messages', 'areas', 'jobs'],
  forward: ['message', 'messages', 'areas', 'jobs'],
  /** Retrying a failed session enqueues a job and puts the agent back among the assignees. */
  retryExecute: ['message', 'messages', 'areas', 'jobs'],
  deleteMessage: ['messages', 'message', 'areas', 'inputs'],
  restoreMessage: ['messages', 'message', 'areas', 'inputs'],
  deleteReply: ['message', 'messages', 'areas'],
  restoreReply: ['message', 'messages', 'areas'],
  // Areas and templates
  saveArea: ['areas'],
  deleteArea: ['areas', 'templates', 'messages', 'message'],
  restoreArea: ['areas', 'templates', 'messages', 'message'],
  saveTemplate: ['templates', 'areas'],
  deleteTemplate: ['templates', 'areas'],
  restoreTemplate: ['templates', 'areas'],
  // Team
  saveMember: ['members', 'me'],
  deleteMember: ['members', 'messages', 'message', 'inputs'],
  createMember: ['members'],
  /** After the language change settles, whether it worked or not. */
  language: ['me', 'members'],
  /** After a rename of the project; the project itself is written with the answer. */
  saveProjectName: ['me'],
  /** After the owner's switch of interface telemetry: `me` carries it. */
  uiTelemetry: ['me'],
  // Providers
  providers: ['providers', 'connections'],
  connections: ['connections', 'providers'],
  // Operations
  purgeJobs: ['jobs', 'audit'],
  jobsChanged: ['jobs'],
  // The event stream
  /** A message of somebody else arrived. */
  newMessage: ['messages', 'areas'],
  /** The stream came back after a drop and the server said its replay was not enough (`replay.complete: false`): what is on screen is read again. */
  reconnect: ['inputs', 'messages'],
} as const satisfies Record<string, readonly QueryRoot[]>

export type InvalidationName = keyof typeof INVALIDATE

/**
 * Invalidates every root of a list; resolves when the queries that were refetched have finished. `refetchType: 'active'` reads
 * again only what a mounted screen shows; the rest is marked stale and is read when a screen mounts it.
 */
export function invalidateRoots(qc: QueryClientLike, roots: readonly QueryRoot[], opts: { refetchType?: 'active' | 'inactive' | 'all' | 'none' } = {}): Promise<unknown[]> {
  return Promise.all(roots.map((root) => qc.invalidateQueries({ queryKey: [root], ...opts })))
}

/** Invalidates what the named operation makes stale. */
export function invalidate(qc: QueryClientLike, name: InvalidationName, opts?: Parameters<typeof invalidateRoots>[2]): Promise<unknown[]> {
  return invalidateRoots(qc, INVALIDATE[name], opts)
}
