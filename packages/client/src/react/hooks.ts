// The hooks of TanStack Query over the client: one per read and one per change, with the keys, the cache writes and the
// invalidations of the panel. They take the client from the nearest `TeamClientProvider`.
import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { mergeSavedInputText, mergeSavedMessage, mergeSavedThread } from '../cache.js'
import { invalidate, invalidateRoots } from '../invalidations.js'
import { queryKeys } from '../keys.js'
import { IN_FLIGHT_REFETCH_MS, IN_FLIGHT_STATUSES, type MessagesParams } from '../queries.js'
import type { AreaFields, ProviderChange, TemplateFields } from '../resources.js'
import type { Versioning } from '../versioning.js'
import type {
  AnalysisSettings,
  BloomLevel,
  Check,
  InputRecord,
  Language,
  Me,
  MemberPatch,
  MessageDetail,
  MessagePatch,
  NewConnection,
  NewMember,
  NewReply,
  Project,
  Proposal,
  ProviderSlot,
  PurgeState,
  ResetResult,
  ResetScope,
} from '../types.js'
import { useTeamClient, useTeamQueries } from './context.js'

export type { MessagesParams }

// ---------------------------------------------------------------- Reads

export function useMe() {
  const q = useTeamQueries()
  return useQuery({ ...q.me(), retry: false, staleTime: 60_000 })
}

export function useMembers() {
  const q = useTeamQueries()
  return useQuery({ ...q.members(), staleTime: 30_000 })
}

export function useAreas() {
  const q = useTeamQueries()
  return useQuery({ ...q.areas(), staleTime: 30_000 })
}

/** The deleted areas (Editor): under ['areas'], so restoring one refreshes it with the live list. */
export function useDeletedAreas(enabled = true) {
  const q = useTeamQueries()
  return useQuery({ ...q.deletedAreas(), enabled })
}

/** The deleted templates of an area; under ['templates', areaId], so restoring one refreshes it with the live list. */
export function useDeletedTemplates(areaId: string | undefined, enabled = true) {
  const q = useTeamQueries()
  return useQuery({ ...q.deletedTemplates(areaId), enabled: !!areaId && enabled })
}

export function useTemplates(areaId: string | undefined, enabled = true) {
  const q = useTeamQueries()
  return useQuery({ ...q.templates(areaId), enabled: !!areaId && enabled })
}

export function useMessages({ query, meId, repliesFeed, enabled = true }: MessagesParams & { enabled?: boolean }) {
  const q = useTeamQueries()
  return useQuery({ ...q.messages({ query, meId, repliesFeed }), placeholderData: keepPreviousData, enabled })
}

/** What affects the person and the pending of each area. Lives under ['messages'], so every change to a message refreshes it. */
export function useSummary(enabled = true) {
  const q = useTeamQueries()
  return useQuery({ ...q.summary(), staleTime: 10_000, enabled })
}

export function useMessage(id: string | undefined) {
  const q = useTeamQueries()
  return useQuery({ ...q.message(id), enabled: !!id })
}

/**
 * Reads a message and the templates of its area ahead of the click, when the pointer or the keyboard reaches its link: the detail opens with
 * both already here instead of asking for the message and then for the templates. What the cache already holds is not asked for again.
 */
export function usePrefetchMessage() {
  const qc = useQueryClient()
  const q = useTeamQueries()
  return (id: string, areaId: string) => {
    const message = q.message(id)
    if (qc.getQueryData(message.queryKey) === undefined) void qc.prefetchQuery(message)
    const templates = q.templates(areaId)
    if (qc.getQueryData(templates.queryKey) === undefined) void qc.prefetchQuery(templates)
  }
}

/** Several messages at once, under the same keys as `useMessage`: what one row edits, the others read. */
export function useMessagesById(ids: string[]) {
  const q = useTeamQueries()
  return useQueries({ queries: ids.map((id) => q.message(id)) })
}

export function useInput(id: string | undefined) {
  const q = useTeamQueries()
  return useQuery({ ...q.input(id), enabled: !!id })
}

/** My inputs in the tray: oldest first, so the ones that arrived first are reviewed first. */
export function useTray(enabled = true) {
  const q = useTeamQueries()
  return useQuery({ ...q.tray(), enabled })
}

/**
 * Every send of mine, newest first, whatever its state (UD-070): the history the drawer of Inicio lists. The ones I discarded are not part of it.
 * It is the same list the tray was, now also with what was published.
 */
export function useSends(enabled = true) {
  const q = useTeamQueries()
  return useQuery({ ...q.history(), enabled })
}

export function useProviders(enabled: boolean) {
  const q = useTeamQueries()
  return useQuery({ ...q.providers(), enabled })
}

/** Providers with the state of their keys, and the presets that can be added (Editor only). */
export function useConnections(enabled = true) {
  const q = useTeamQueries()
  return useQuery({ ...q.connections(), enabled })
}

/** The result of a test, kept per connection so the model field can offer the models the provider listed. */
export function useRememberedModels(name: string | null | undefined): string[] {
  // Never fetched (disabled): the data is whatever the tests wrote with setQueryData.
  return useQuery({ queryKey: queryKeys.models(name ?? ''), queryFn: () => [] as string[], enabled: false }).data ?? []
}

export function useProject() {
  const q = useTeamQueries()
  return useQuery({ ...q.project(), staleTime: 60_000 })
}

export function useAnalysisSettings(enabled = true) {
  const q = useTeamQueries()
  return useQuery({ ...q.analysisSettings(), enabled, staleTime: 60_000 })
}

/** Publication of a send (UD-070): automatic or manual. */
export function usePublication() {
  const q = useTeamQueries()
  return useQuery(q.publication())
}

/** Sends of everybody (Editor), newest first, one server page. */
export function useQueueInputs(page: number, limit: number) {
  const qc = useQueryClient()
  const q = useTeamQueries()
  return useQuery({
    ...q.queue(page, limit),
    placeholderData: keepPreviousData,
    refetchInterval: (query) => {
      const running = query.state.data?.items.some((i) => IN_FLIGHT_STATUSES.has(i.status)) ?? false
      if (running) void invalidate(qc, 'jobsChanged')
      return running ? IN_FLIGHT_REFETCH_MS : false
    },
  })
}

/** Jobs by state: one request per state, the total of each. */
export function useJobCounts() {
  const q = useTeamQueries()
  return useQuery(q.jobCounts())
}

/** Where the time of a message went (GET /messages/:id/timing). A 404 means it has no execution. The query asks again while the job runs. */
export function useMessageTiming(messageId: string) {
  const q = useTeamQueries()
  return useQuery({
    ...q.messageTiming(messageId),
    retry: false,
    refetchInterval: (query) => (query.state.data?.job_status === 'running' ? IN_FLIGHT_REFETCH_MS : false),
  })
}

/** Figures of the execute runs of the last `days` days (0 = all of them). Asked only while the section is open. */
export function useExecuteRunsSummary(days: number) {
  const q = useTeamQueries()
  return useQuery(q.executeRunsSummary(days))
}

/** The `execute` jobs that are running now, with their phase. The list asks again while there is one. */
export function useRunningExecutions() {
  const q = useTeamQueries()
  return useQuery({ ...q.runningExecutions(), refetchInterval: (query) => ((query.state.data?.length ?? 0) > 0 ? IN_FLIGHT_REFETCH_MS : false) })
}

export function useJobTrace(jobId: string, enabled: boolean) {
  const q = useTeamQueries()
  return useQuery({ ...q.jobTrace(jobId), enabled, retry: false })
}

export function useAuditLog(page: number, limit: number, action: string) {
  const q = useTeamQueries()
  return useQuery({ ...q.audit(page, limit, action), placeholderData: keepPreviousData })
}

/** Summary of interface use; only asked for while the switch is on. */
export function useUiSummary(enabled: boolean) {
  const q = useTeamQueries()
  return useQuery({ ...q.uiSummary(), enabled })
}

// ---------------------------------------------------------------- Changes

function useInvalidate() {
  const qc = useQueryClient()
  return (name: Parameters<typeof invalidate>[1]) => invalidate(qc, name)
}

/** Where an edit finds the version it read, and where it leaves the fresh copy after a conflict: the `['message', id]` entry. */
function messageVersioning(qc: QueryClient, id: string): Versioning<MessageDetail> {
  return {
    cached: () => qc.getQueryData<MessageDetail>(queryKeys.message(id)),
    remember: (fresh) => void qc.setQueryData(queryKeys.message(id), fresh),
  }
}

export function useLogin() {
  const qc = useQueryClient()
  const client = useTeamClient()
  return useMutation({
    mutationFn: (v: { email: string; password: string }) => client.auth.login(v),
    onSuccess: () => invalidateRoots(qc, ['me']),
  })
}

/** Closes the session; the answer carries the host's own sign-out address when it has one (H-3720). Clearing the cache is the caller's. */
export function useLogout() {
  const client = useTeamClient()
  return useMutation({ mutationFn: () => client.auth.logout() })
}

export function usePublish() {
  const client = useTeamClient()
  const inv = useInvalidate()
  return useMutation({
    mutationFn: (v: { inputId: string; proposal: Proposal }) => client.inputs.publish(v.inputId, v.proposal),
    onSuccess: () => inv('publish'),
  })
}

/** Saves the proposal draft (PATCH /inputs/:id/proposal): what was edited survives closing the tab. */
export function useSaveProposal(inputId: string) {
  const client = useTeamClient()
  return useMutation({ mutationFn: (proposal: Proposal) => client.inputs.saveProposal(inputId, proposal) })
}

/** Changes the text of the submitted input (PATCH /inputs/:id). */
export function useSaveInputText(inputId: string) {
  const client = useTeamClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (text: string) => client.inputs.saveText(inputId, text),
    onSuccess: (saved) => qc.setQueryData(queryKeys.input(inputId), (old: InputRecord | undefined) => mergeSavedInputText(old, saved)),
  })
}

/** Requeues the analysis of an input; keeps the text and the extractions (POST /inputs/:id/reprocess). Published: the Editor only, its messages go to the trash. */
export function useReprocess() {
  const client = useTeamClient()
  const inv = useInvalidate()
  return useMutation({
    mutationFn: (inputId: string) => client.inputs.reprocess(inputId),
    // A published send sets its messages aside (UD-258): the lists of messages and the counts of areas change with it.
    onSuccess: () => inv('reprocess'),
  })
}

/** Undoes a discard (POST /inputs/:id/restore): the send comes back with the proposal and the edits it had. */
export function useRestoreInput() {
  const client = useTeamClient()
  const inv = useInvalidate()
  return useMutation({ mutationFn: (inputId: string) => client.inputs.restore(inputId), onSuccess: () => inv('restoreInput') })
}

/** Deletes a send for real (DELETE /inputs/:id?confirm=true, UD-240): its attachments, jobs and proposal; with `withMessages`, the messages it published too. */
export function useDeleteInput() {
  const client = useTeamClient()
  const inv = useInvalidate()
  return useMutation({
    mutationFn: (v: { id: string; withMessages: boolean }) => client.inputs.delete(v),
    onSuccess: () => inv('deleteInput'),
  })
}

export function useCancelInput() {
  const client = useTeamClient()
  const inv = useInvalidate()
  return useMutation({ mutationFn: (inputId: string) => client.inputs.cancel(inputId), onSuccess: () => inv('cancelInput') })
}

/** Replies; with files, the submit is multipart (POST /messages/:id/replies with `files` and `links`). */
export function useReply(messageId: string) {
  const client = useTeamClient()
  const inv = useInvalidate()
  return useMutation({
    mutationFn: (v: NewReply) => client.replies.create(messageId, v),
    onSuccess: () => inv('reply'),
  })
}

/**
 * Edits a published message (UD-071). The request carries the `version` that was read: the one in the cache, so an edit that follows another
 * (an undo, the next field) uses the version the previous one left. If another edit got in first the server answers 409 `edit_conflict`
 * with the current version: the message is read again and the same change goes once more, so the person never sees the conflict for
 * a change in a different field. Returns the saved message.
 */
export function usePatchMessage() {
  const client = useTeamClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: string; patch: MessagePatch }) => client.messages.patch(v.id, v.patch, messageVersioning(qc, v.id)),
    onSuccess: (saved, v) => {
      qc.setQueryData(queryKeys.message(v.id), (old: MessageDetail | undefined) => mergeSavedMessage(old, saved))
      void invalidate(qc, 'patchMessage')
    },
  })
}

/** New files and links on a published message (UD-071): they go at the end and count as an edit, with the version that was read. */
export function useAddAttachments() {
  const client = useTeamClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: string; files: File[]; links?: string[] }) => client.messages.addAttachments(v.id, v, messageVersioning(qc, v.id)),
    onSuccess: (saved, v) => {
      qc.setQueryData(queryKeys.message(v.id), (old: MessageDetail | undefined) => mergeSavedMessage(old, saved))
      void invalidate(qc, 'addAttachments')
    },
  })
}

export function useSetClosed() {
  const client = useTeamClient()
  const inv = useInvalidate()
  return useMutation({ mutationFn: (v: { id: string; closed: boolean }) => client.messages.setClosed(v), onSuccess: () => inv('setClosed') })
}

/** Sets the level of a message by hand (PUT /messages/:id/level, UD-292). */
export function useSetLevel() {
  const client = useTeamClient()
  const inv = useInvalidate()
  return useMutation({ mutationFn: (v: { id: string; level: BloomLevel }) => client.messages.setLevel(v), onSuccess: () => inv('setLevel') })
}

/** Forwards a message to a member with the reason (POST /messages/:id/forward, UD-272). */
export function useForward(messageId: string) {
  const client = useTeamClient()
  const inv = useInvalidate()
  return useMutation({ mutationFn: (v: { member_id: string; comment: string }) => client.messages.forward(messageId, v), onSuccess: () => inv('forward') })
}

/** Launches again the session whose failure a reply tells (POST /messages/:id/replies/:replyId/retry, UD-282). */
export function useRetryExecute(messageId: string) {
  const client = useTeamClient()
  const inv = useInvalidate()
  return useMutation({ mutationFn: (replyId: string) => client.messages.retry(messageId, replyId), onSuccess: () => inv('retryExecute') })
}

/** Queues the delivery of the branch a person reviewed (POST /messages/:id/deliver, Editor; UD-263, UD-275). */
export function useDeliver(messageId: string) {
  const client = useTeamClient()
  const inv = useInvalidate()
  return useMutation({ mutationFn: () => client.messages.deliver(messageId), onSuccess: () => inv('deliverReview') })
}

/** Discards the branch of a held delivery with the reason (POST /messages/:id/discard-delivery, Editor; UD-275). */
export function useDiscardDelivery(messageId: string) {
  const client = useTeamClient()
  const inv = useInvalidate()
  return useMutation({ mutationFn: (reason: string) => client.messages.discardDelivery(messageId, reason), onSuccess: () => inv('deliverReview') })
}

/** Soft-deletes a message (DELETE /messages/:id?confirm=true, UD-240): its sender or the Editor; Deshacer restores it. */
export function useDeleteMessage() {
  const client = useTeamClient()
  const inv = useInvalidate()
  return useMutation({ mutationFn: (id: string) => client.messages.delete(id), onSuccess: () => inv('deleteMessage') })
}

/** Restores a deleted message (POST /messages/:id/restore): it is what undoes a deletion. */
export function useRestoreMessage() {
  const client = useTeamClient()
  const inv = useInvalidate()
  return useMutation({ mutationFn: (id: string) => client.messages.restore(id), onSuccess: () => inv('restoreMessage') })
}

/** Soft-deletes a reply (DELETE /messages/:id/replies/:replyId?confirm=true, UD-240): its author or the Editor. Returns the message with its thread. */
export function useDeleteReply(messageId: string) {
  const client = useTeamClient()
  const inv = useInvalidate()
  return useMutation({ mutationFn: (replyId: string) => client.replies.delete(messageId, replyId), onSuccess: () => inv('deleteReply') })
}

/** Restores a deleted reply (POST /replies/:id/restore): it is what undoes a deletion. */
export function useRestoreReply() {
  const client = useTeamClient()
  const inv = useInvalidate()
  return useMutation({ mutationFn: (replyId: string) => client.replies.restore(replyId), onSuccess: () => inv('restoreReply') })
}

/**
 * Edits the text of a reply (PATCH /messages/:id/replies/:replyId), only by its author (UD-253, H-3714). It sends the version read in the
 * thread; on `edit_conflict` it reads the thread again and retries once with the current version, as `usePatchMessage` does.
 */
export function useEditReply(messageId: string) {
  const client = useTeamClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { replyId: string; body?: string; mention_ids?: string[]; remove_attachment_ids?: string[] }) =>
      client.replies.edit(messageId, v.replyId, v.body, messageVersioning(qc, messageId), { mention_ids: v.mention_ids, remove_attachment_ids: v.remove_attachment_ids }),
    onSuccess: (saved) => {
      qc.setQueryData(queryKeys.message(messageId), (old: MessageDetail | undefined) => mergeSavedThread(old, saved))
      void invalidate(qc, 'editReply')
    },
  })
}

/** New files and links on a reply of mine (UD-279). */
export function useAddReplyAttachments(messageId: string) {
  const client = useTeamClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { replyId: string; files: File[]; links?: string[] }) => client.replies.addAttachments(messageId, v.replyId, v, messageVersioning(qc, messageId)),
    onSuccess: (saved) => {
      qc.setQueryData(queryKeys.message(messageId), (old: MessageDetail | undefined) => mergeSavedThread(old, saved))
      void invalidate(qc, 'editReply')
    },
  })
}

/** Soft-deletes several messages in one request (POST /messages/delete?confirm=true): all or none, 403 with the ids that are not the person's. */
export function useDeleteMessages() {
  const client = useTeamClient()
  const inv = useInvalidate()
  return useMutation({ mutationFn: (ids: readonly string[]) => client.messages.deleteMany(ids), onSuccess: () => inv('deleteMessage') })
}

/** Restores several deleted messages in one request (POST /messages/restore): what undoes `useDeleteMessages`. */
export function useRestoreMessages() {
  const client = useTeamClient()
  const inv = useInvalidate()
  return useMutation({ mutationFn: (ids: readonly string[]) => client.messages.restoreMany(ids), onSuccess: () => inv('restoreMessage') })
}

export function useSaveArea() {
  const client = useTeamClient()
  const inv = useInvalidate()
  return useMutation({ mutationFn: (v: AreaFields) => client.areas.save(v), onSuccess: () => inv('saveArea') })
}

/** Soft-deletes an area (DELETE /areas/:id?confirm=true, UD-240): Editor only; its messages stay and Deshacer restores it. */
export function useDeleteArea() {
  const client = useTeamClient()
  const inv = useInvalidate()
  return useMutation({ mutationFn: (id: string) => client.areas.delete(id), onSuccess: () => inv('deleteArea') })
}

/** Restores a deleted area (POST /areas/:id/restore): it is what undoes a deletion. */
export function useRestoreArea() {
  const client = useTeamClient()
  const inv = useInvalidate()
  return useMutation({ mutationFn: (id: string) => client.areas.restore(id), onSuccess: () => inv('restoreArea') })
}

/** Soft-deletes several areas (Editor): one DELETE each, in parallel. */
export function useDeleteAreas() {
  const client = useTeamClient()
  const inv = useInvalidate()
  return useMutation({ mutationFn: (ids: readonly string[]) => client.areas.deleteMany(ids), onSettled: () => inv('deleteArea') })
}

export function useRestoreAreas() {
  const client = useTeamClient()
  const inv = useInvalidate()
  return useMutation({ mutationFn: (ids: readonly string[]) => client.areas.restoreMany(ids), onSettled: () => inv('restoreArea') })
}

export function useSaveTemplate(areaId: string) {
  const client = useTeamClient()
  const inv = useInvalidate()
  return useMutation({ mutationFn: (v: TemplateFields) => client.templates.save(areaId, v), onSuccess: () => inv('saveTemplate') })
}

export function useDeleteTemplate(areaId: string) {
  const client = useTeamClient()
  const inv = useInvalidate()
  return useMutation({ mutationFn: (id: string) => client.templates.delete(areaId, id), onSuccess: () => inv('deleteTemplate') })
}

/** Restores a deleted template (POST /templates/:id/restore): it is what undoes a deletion. */
export function useRestoreTemplate() {
  const client = useTeamClient()
  const inv = useInvalidate()
  return useMutation({ mutationFn: (id: string) => client.templates.restore(id), onSuccess: () => inv('restoreTemplate') })
}

/** Soft-deletes several templates of an area (Editor), one DELETE each, in parallel. */
export function useDeleteTemplates(areaId: string) {
  const client = useTeamClient()
  const inv = useInvalidate()
  return useMutation({ mutationFn: (ids: readonly string[]) => client.templates.deleteMany(areaId, ids), onSettled: () => inv('deleteTemplate') })
}

export function useRestoreTemplates() {
  const client = useTeamClient()
  const inv = useInvalidate()
  return useMutation({ mutationFn: (ids: readonly string[]) => client.templates.restoreMany(ids), onSettled: () => inv('restoreTemplate') })
}

export function useSaveMember() {
  const client = useTeamClient()
  const inv = useInvalidate()
  return useMutation({
    mutationFn: (v: { id: string; self: boolean; patch: MemberPatch }) => client.members.save(v),
    onSuccess: () => inv('saveMember'),
  })
}

/** Deleting a member for good (DELETE /members/:id, Editor only, UD-240). `purge` takes their history too; without it a member with history is a 409 `member_has_history`. */
export function useDeleteMember() {
  const client = useTeamClient()
  const inv = useInvalidate()
  return useMutation({ mutationFn: (v: { id: string; purge?: boolean }) => client.members.delete(v), onSuccess: () => inv('deleteMember') })
}

/** Adding a member (POST /members, Editor only). */
export function useCreateMember() {
  const client = useTeamClient()
  const inv = useInvalidate()
  return useMutation({ mutationFn: (v: NewMember) => client.members.create(v), onSuccess: () => inv('createMember') })
}

/** Another member's password (PATCH /members/:id, Editor): it closes that person's sessions. */
export function useSetMemberPassword() {
  const client = useTeamClient()
  return useMutation({ mutationFn: (v: { id: string; password: string }) => client.members.setPassword(v) })
}

/** The account language changes the interface instantly: it is written into `me` before the server answers. */
export function useSaveLanguage() {
  const client = useTeamClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (language: Language) => client.members.saveLanguage(language),
    onMutate: async (language) => {
      await qc.cancelQueries({ queryKey: queryKeys.me() })
      const before = qc.getQueryData<Me>(queryKeys.me())
      if (before) qc.setQueryData<Me>(queryKeys.me(), { ...before, language })
      return { before }
    },
    onError: (_err, _language, ctx) => {
      if (ctx?.before) qc.setQueryData(queryKeys.me(), ctx.before)
    },
    onSettled: () => {
      void invalidate(qc, 'language')
    },
  })
}

export function useSaveProvider() {
  const client = useTeamClient()
  const inv = useInvalidate()
  return useMutation({
    // The server tests the combination before it applies it: a failure (422 provider_check_failed) leaves the previous setting.
    mutationFn: (v: ProviderChange) => client.providers.save(v),
    onSuccess: () => inv('providers'),
  })
}

function useRememberCheck() {
  const qc = useQueryClient()
  return (name: string, check: Check | undefined) => {
    if (check?.models?.length) qc.setQueryData(queryKeys.models(name), check.models)
  }
}

/** Adds a provider with its key; the server tests first and saves nothing when the test fails. */
export function useAddConnection() {
  const client = useTeamClient()
  const inv = useInvalidate()
  const remember = useRememberCheck()
  return useMutation({
    // The body carries the key: the mutation leaves the cache as soon as nothing watches it.
    gcTime: 0,
    mutationFn: (v: NewConnection) => client.connections.add(v),
    onSuccess: (r) => {
      remember(r.connection.name, r.check)
      return inv('connections')
    },
  })
}

/** Replaces a key: tested first, applied only if it works; otherwise the previous key stays. */
export function useReplaceKey() {
  const client = useTeamClient()
  const inv = useInvalidate()
  const remember = useRememberCheck()
  return useMutation({
    gcTime: 0,
    mutationFn: (v: { name: string; api_key: string; model?: string }) => client.connections.replaceKey(v),
    onSuccess: (r) => {
      remember(r.connection.name, r.check)
      return inv('connections')
    },
  })
}

export function useRetireKey() {
  const client = useTeamClient()
  const inv = useInvalidate()
  return useMutation({ mutationFn: (name: string) => client.connections.retireKey(name), onSuccess: () => inv('connections') })
}

export function useDeleteConnection() {
  const client = useTeamClient()
  const inv = useInvalidate()
  return useMutation({ mutationFn: (name: string) => client.connections.delete(name), onSuccess: () => inv('connections') })
}

/** Diagnosis of one provider (always answers 200; the body says whether it worked). */
export function useCheckConnection() {
  const client = useTeamClient()
  const inv = useInvalidate()
  const remember = useRememberCheck()
  return useMutation({
    mutationFn: (v: { name: string; model?: string }) => client.connections.check(v),
    onSuccess: (r) => {
      remember(r.name, r.check)
      return inv('connections')
    },
  })
}

/** Diagnosis of one function: the provider and the model it uses now. */
export function useCheckSlot() {
  const client = useTeamClient()
  const inv = useInvalidate()
  const remember = useRememberCheck()
  return useMutation({
    mutationFn: (slot: ProviderSlot) => client.providers.check(slot),
    onSuccess: (r) => {
      remember(r.provider, r.check)
      return inv('connections')
    },
  })
}

/** Changes the description with text (in-place edit) or with a `.md` file (multipart `file`). */
export function useSaveProject() {
  const client = useTeamClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { description: string } | { file: File }) => client.project.save(v),
    onSuccess: (saved) => qc.setQueryData<Project>(queryKeys.project(), saved),
  })
}

/** Saves the project name (empty goes back to PROJECT_NAME); the top bar reads it from ['project']. */
export function useSaveProjectName() {
  const client = useTeamClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => client.project.saveName(name),
    onSuccess: (saved) => {
      qc.setQueryData<Project>(queryKeys.project(), saved)
      void invalidate(qc, 'saveProjectName')
    },
  })
}

/** Saves the framing of one or both languages; an empty text goes back to the default. */
export function useSaveFraming() {
  const client = useTeamClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (framing: Partial<Record<Language, string>>) => client.analysis.saveFraming(framing),
    onSuccess: (saved) => qc.setQueryData<AnalysisSettings>(queryKeys.analysisSettings(), saved),
  })
}

/** Changes the publication mode (UD-070); the Editor only. */
export function useSavePublication() {
  const client = useTeamClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (autoPublish: boolean) => client.publication.save(autoPublish),
    onSuccess: (saved) => qc.setQueryData(queryKeys.publication(), saved),
  })
}

/** The owner's switch of interface telemetry (UD-091); `me` carries it back. */
export function useSaveUiTelemetry() {
  const client = useTeamClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (enabled: boolean) => client.telemetry.setUiEnabled(enabled),
    onSuccess: () => invalidate(qc, 'uiTelemetry'),
  })
}

export function usePurgeJobs() {
  const client = useTeamClient()
  const inv = useInvalidate()
  return useMutation({ mutationFn: (state: PurgeState) => client.jobs.purge(state), onSuccess: () => inv('purgeJobs') })
}

/** Loads the sample set of ejemplos/ (POST /ops/seed, Editor): the inputs enter the tray and go through the real analysis. */
export function useSeedExamples() {
  const client = useTeamClient()
  const qc = useQueryClient()
  return useMutation({ mutationFn: () => client.ops.seed(), onSuccess: () => qc.invalidateQueries() })
}

/** Empties the test data (POST /ops/reset, Editor, UD-240). `onDone` runs with the figures before every query is invalidated. */
export function useResetData(options: { onDone?: (result: ResetResult) => void | Promise<void> } = {}) {
  const client = useTeamClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (scope: ResetScope) => client.ops.reset(scope),
    onSuccess: async (r) => {
      await options.onDone?.(r)
      await qc.invalidateQueries()
    },
  })
}
