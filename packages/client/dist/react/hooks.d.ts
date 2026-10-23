import { type MessagesParams } from '../queries.js';
import type { AreaFields, ProviderChange, TemplateFields } from '../resources.js';
import type { AnalysisSettings, Check, InputRecord, Language, Me, MemberPatch, MessageDetail, MessagePatch, NewConnection, NewMember, NewReply, Project, Proposal, ProviderSlot, PurgeState, ResetResult, ResetScope } from '../types.js';
export type { MessagesParams };
export declare function useMe(): import("@tanstack/react-query").UseQueryResult<Me, Error>;
export declare function useMembers(): import("@tanstack/react-query").UseQueryResult<import("../types.js").Member[], Error>;
export declare function useAreas(): import("@tanstack/react-query").UseQueryResult<import("../types.js").Area[], Error>;
/** The deleted areas (Editor): under ['areas'], so restoring one refreshes it with the live list. */
export declare function useDeletedAreas(enabled?: boolean): import("@tanstack/react-query").UseQueryResult<import("../types.js").Area[], Error>;
/** The deleted templates of an area; under ['templates', areaId], so restoring one refreshes it with the live list. */
export declare function useDeletedTemplates(areaId: string | undefined, enabled?: boolean): import("@tanstack/react-query").UseQueryResult<import("../types.js").Template[], Error>;
export declare function useTemplates(areaId: string | undefined, enabled?: boolean): import("@tanstack/react-query").UseQueryResult<import("../types.js").Template[], Error>;
export declare function useMessages({ query, meId, repliesFeed, enabled }: MessagesParams & {
    enabled?: boolean;
}): import("@tanstack/react-query").UseQueryResult<import("../types.js").Message[], Error>;
/** What affects the person and the pending of each area. Lives under ['messages'], so every change to a message refreshes it. */
export declare function useSummary(enabled?: boolean): import("@tanstack/react-query").UseQueryResult<import("../types.js").MessageSummary, Error>;
export declare function useMessage(id: string | undefined): import("@tanstack/react-query").UseQueryResult<MessageDetail, Error>;
/** Several messages at once, under the same keys as `useMessage`: what one row edits, the others read. */
export declare function useMessagesById(ids: string[]): import("@tanstack/react-query").UseQueryResult<MessageDetail, Error>[];
export declare function useInput(id: string | undefined): import("@tanstack/react-query").UseQueryResult<InputRecord, Error>;
/** My inputs in the tray: oldest first, so the ones that arrived first are reviewed first. */
export declare function useTray(enabled?: boolean): import("@tanstack/react-query").UseQueryResult<InputRecord[], Error>;
/**
 * Every send of mine, newest first, whatever its state (UD-070): the history the drawer of Inicio lists. The ones I discarded are not part of it.
 * It is the same list the tray was, now also with what was published.
 */
export declare function useSends(enabled?: boolean): import("@tanstack/react-query").UseQueryResult<InputRecord[], Error>;
export declare function useProviders(enabled: boolean): import("@tanstack/react-query").UseQueryResult<import("../types.js").ProviderSetting[], Error>;
/** Providers with the state of their keys, and the presets that can be added (Editor only). */
export declare function useConnections(enabled?: boolean): import("@tanstack/react-query").UseQueryResult<import("../types.js").ConnectionsView, Error>;
/** The result of a test, kept per connection so the model field can offer the models the provider listed. */
export declare function useRememberedModels(name: string | null | undefined): string[];
export declare function useProject(): import("@tanstack/react-query").UseQueryResult<Project, Error>;
export declare function useAnalysisSettings(enabled?: boolean): import("@tanstack/react-query").UseQueryResult<AnalysisSettings, Error>;
/** Publication of a send (UD-070): automatic or manual. */
export declare function usePublication(): import("@tanstack/react-query").UseQueryResult<{
    auto_publish: boolean;
}, Error>;
/** Sends of everybody (Editor), newest first, one server page. */
export declare function useQueueInputs(page: number, limit: number): import("@tanstack/react-query").UseQueryResult<import("../types.js").Paged<import("../types.js").QueueInput>, Error>;
/** Jobs by state: one request per state, the total of each. */
export declare function useJobCounts(): import("@tanstack/react-query").UseQueryResult<Record<"queued" | "failed" | "cancelled" | "running" | "done", number>, Error>;
/** Where the time of a message went (GET /messages/:id/timing). A 404 means it has no execution. The query asks again while the job runs. */
export declare function useMessageTiming(messageId: string): import("@tanstack/react-query").UseQueryResult<import("../types.js").MessageTiming, Error>;
/** The `execute` jobs that are running now, with their phase. The list asks again while there is one. */
export declare function useRunningExecutions(): import("@tanstack/react-query").UseQueryResult<import("../types.js").RunningJob[], Error>;
export declare function useJobTrace(jobId: string, enabled: boolean): import("@tanstack/react-query").UseQueryResult<import("../types.js").JobTrace, Error>;
export declare function useAuditLog(page: number, limit: number, action: string): import("@tanstack/react-query").UseQueryResult<import("../types.js").Paged<import("../types.js").AuditEntry>, Error>;
/** Summary of interface use; only asked for while the switch is on. */
export declare function useUiSummary(enabled: boolean): import("@tanstack/react-query").UseQueryResult<import("../types.js").UiSummary, Error>;
export declare function useLogin(): import("@tanstack/react-query").UseMutationResult<unknown, Error, {
    email: string;
    password: string;
}, unknown>;
/** Closes the session; the answer carries the host's own sign-out address when it has one (H-3720). Clearing the cache is the caller's. */
export declare function useLogout(): import("@tanstack/react-query").UseMutationResult<{
    logout_url?: string;
} | undefined, Error, void, unknown>;
export declare function usePublish(): import("@tanstack/react-query").UseMutationResult<{
    message_ids?: string[];
}, Error, {
    inputId: string;
    proposal: Proposal;
}, unknown>;
/** Saves the proposal draft (PATCH /inputs/:id/proposal): what was edited survives closing the tab. */
export declare function useSaveProposal(inputId: string): import("@tanstack/react-query").UseMutationResult<Proposal, Error, Proposal, unknown>;
/** Changes the text of the submitted input (PATCH /inputs/:id). */
export declare function useSaveInputText(inputId: string): import("@tanstack/react-query").UseMutationResult<InputRecord, Error, string, unknown>;
/** Requeues the analysis of an input; keeps the text and the extractions (POST /inputs/:id/reprocess). Published: the Editor only, its messages go to the trash. */
export declare function useReprocess(): import("@tanstack/react-query").UseMutationResult<import("../types.js").ReprocessResult, Error, string, unknown>;
/** Undoes a discard (POST /inputs/:id/restore): the send comes back with the proposal and the edits it had. */
export declare function useRestoreInput(): import("@tanstack/react-query").UseMutationResult<{
    input_id: string;
    status: string;
}, Error, string, unknown>;
/** Deletes a send for real (DELETE /inputs/:id?confirm=true, UD-240): its attachments, jobs and proposal; with `withMessages`, the messages it published too. */
export declare function useDeleteInput(): import("@tanstack/react-query").UseMutationResult<import("../types.js").DeleteInputResult, Error, {
    id: string;
    withMessages: boolean;
}, unknown>;
export declare function useCancelInput(): import("@tanstack/react-query").UseMutationResult<unknown, Error, string, unknown>;
/** Replies; with files, the submit is multipart (POST /messages/:id/replies with `files` and `links`). */
export declare function useReply(messageId: string): import("@tanstack/react-query").UseMutationResult<unknown, Error, NewReply, unknown>;
/**
 * Edits a published message (UD-071). The request carries the `version` that was read: the one in the cache, so an edit that follows another
 * (an undo, the next field) uses the version the previous one left. If another edit got in first the server answers 409 `edit_conflict`
 * with the current version: the message is read again and the same change goes once more, so the person never sees the conflict for
 * a change in a different field. Returns the saved message.
 */
export declare function usePatchMessage(): import("@tanstack/react-query").UseMutationResult<MessageDetail, Error, {
    id: string;
    patch: MessagePatch;
}, unknown>;
/** New files and links on a published message (UD-071): they go at the end and count as an edit, with the version that was read. */
export declare function useAddAttachments(): import("@tanstack/react-query").UseMutationResult<MessageDetail, Error, {
    id: string;
    files: File[];
    links?: string[];
}, unknown>;
export declare function useSetClosed(): import("@tanstack/react-query").UseMutationResult<unknown, Error, {
    id: string;
    closed: boolean;
}, unknown>;
/** Soft-deletes a message (DELETE /messages/:id?confirm=true, UD-240): its sender or the Editor; Deshacer restores it. */
export declare function useDeleteMessage(): import("@tanstack/react-query").UseMutationResult<unknown, Error, string, unknown>;
/** Restores a deleted message (POST /messages/:id/restore): it is what undoes a deletion. */
export declare function useRestoreMessage(): import("@tanstack/react-query").UseMutationResult<MessageDetail, Error, string, unknown>;
/** Soft-deletes a reply (DELETE /messages/:id/replies/:replyId?confirm=true, UD-240): its author or the Editor. Returns the message with its thread. */
export declare function useDeleteReply(messageId: string): import("@tanstack/react-query").UseMutationResult<MessageDetail, Error, string, unknown>;
/** Restores a deleted reply (POST /replies/:id/restore): it is what undoes a deletion. */
export declare function useRestoreReply(): import("@tanstack/react-query").UseMutationResult<MessageDetail, Error, string, unknown>;
/**
 * Edits the text of a reply (PATCH /messages/:id/replies/:replyId), only by its author (UD-253, H-3714). It sends the version read in the
 * thread; on `edit_conflict` it reads the thread again and retries once with the current version, as `usePatchMessage` does.
 */
export declare function useEditReply(messageId: string): import("@tanstack/react-query").UseMutationResult<MessageDetail, Error, {
    replyId: string;
    body: string;
}, unknown>;
/** Soft-deletes several messages in one request (POST /messages/delete?confirm=true): all or none, 403 with the ids that are not the person's. */
export declare function useDeleteMessages(): import("@tanstack/react-query").UseMutationResult<{
    ids: string[];
}, Error, readonly string[], unknown>;
/** Restores several deleted messages in one request (POST /messages/restore): what undoes `useDeleteMessages`. */
export declare function useRestoreMessages(): import("@tanstack/react-query").UseMutationResult<{
    ids: string[];
}, Error, readonly string[], unknown>;
export declare function useSaveArea(): import("@tanstack/react-query").UseMutationResult<import("../types.js").Area, Error, AreaFields, unknown>;
/** Soft-deletes an area (DELETE /areas/:id?confirm=true, UD-240): Editor only; its messages stay and Deshacer restores it. */
export declare function useDeleteArea(): import("@tanstack/react-query").UseMutationResult<unknown, Error, string, unknown>;
/** Restores a deleted area (POST /areas/:id/restore): it is what undoes a deletion. */
export declare function useRestoreArea(): import("@tanstack/react-query").UseMutationResult<import("../types.js").Area, Error, string, unknown>;
/** Soft-deletes several areas (Editor): one DELETE each, in parallel. */
export declare function useDeleteAreas(): import("@tanstack/react-query").UseMutationResult<unknown[], Error, readonly string[], unknown>;
export declare function useRestoreAreas(): import("@tanstack/react-query").UseMutationResult<unknown[], Error, readonly string[], unknown>;
export declare function useSaveTemplate(areaId: string): import("@tanstack/react-query").UseMutationResult<unknown, Error, TemplateFields, unknown>;
export declare function useDeleteTemplate(areaId: string): import("@tanstack/react-query").UseMutationResult<unknown, Error, string, unknown>;
/** Restores a deleted template (POST /templates/:id/restore): it is what undoes a deletion. */
export declare function useRestoreTemplate(): import("@tanstack/react-query").UseMutationResult<import("../types.js").Template, Error, string, unknown>;
/** Soft-deletes several templates of an area (Editor), one DELETE each, in parallel. */
export declare function useDeleteTemplates(areaId: string): import("@tanstack/react-query").UseMutationResult<unknown[], Error, readonly string[], unknown>;
export declare function useRestoreTemplates(): import("@tanstack/react-query").UseMutationResult<unknown[], Error, readonly string[], unknown>;
export declare function useSaveMember(): import("@tanstack/react-query").UseMutationResult<import("../types.js").Member, Error, {
    id: string;
    self: boolean;
    patch: MemberPatch;
}, unknown>;
/** Deleting a member for good (DELETE /members/:id, Editor only, UD-240). `purge` takes their history too; without it a member with history is a 409 `member_has_history`. */
export declare function useDeleteMember(): import("@tanstack/react-query").UseMutationResult<import("../types.js").DeleteMemberResult, Error, {
    id: string;
    purge?: boolean;
}, unknown>;
/** Adding a member (POST /members, Editor only). */
export declare function useCreateMember(): import("@tanstack/react-query").UseMutationResult<import("../types.js").Member, Error, NewMember, unknown>;
/** Another member's password (PATCH /members/:id, Editor): it closes that person's sessions. */
export declare function useSetMemberPassword(): import("@tanstack/react-query").UseMutationResult<import("../types.js").Member, Error, {
    id: string;
    password: string;
}, unknown>;
/** The account language changes the interface instantly: it is written into `me` before the server answers. */
export declare function useSaveLanguage(): import("@tanstack/react-query").UseMutationResult<import("../types.js").Member, Error, Language, {
    before: Me | undefined;
}>;
export declare function useSaveProvider(): import("@tanstack/react-query").UseMutationResult<unknown, Error, ProviderChange, unknown>;
/** Adds a provider with its key; the server tests first and saves nothing when the test fails. */
export declare function useAddConnection(): import("@tanstack/react-query").UseMutationResult<import("../types.js").ConnectionResult, Error, NewConnection, unknown>;
/** Replaces a key: tested first, applied only if it works; otherwise the previous key stays. */
export declare function useReplaceKey(): import("@tanstack/react-query").UseMutationResult<import("../types.js").ConnectionResult, Error, {
    name: string;
    api_key: string;
    model?: string;
}, unknown>;
export declare function useRetireKey(): import("@tanstack/react-query").UseMutationResult<{
    connection: import("../types.js").Connection;
}, Error, string, unknown>;
export declare function useDeleteConnection(): import("@tanstack/react-query").UseMutationResult<{
    deleted: boolean;
}, Error, string, unknown>;
/** Diagnosis of one provider (always answers 200; the body says whether it worked). */
export declare function useCheckConnection(): import("@tanstack/react-query").UseMutationResult<{
    name: string;
    check: Check;
}, Error, {
    name: string;
    model?: string;
}, unknown>;
/** Diagnosis of one function: the provider and the model it uses now. */
export declare function useCheckSlot(): import("@tanstack/react-query").UseMutationResult<{
    check: Check;
    slot: ProviderSlot;
    provider: string;
    model: string;
}, Error, ProviderSlot, unknown>;
/** Changes the description with text (in-place edit) or with a `.md` file (multipart `file`). */
export declare function useSaveProject(): import("@tanstack/react-query").UseMutationResult<Project, Error, {
    description: string;
} | {
    file: File;
}, unknown>;
/** Saves the project name (empty goes back to PROJECT_NAME); the top bar reads it from ['project']. */
export declare function useSaveProjectName(): import("@tanstack/react-query").UseMutationResult<Project, Error, string, unknown>;
/** Saves the framing of one or both languages; an empty text goes back to the default. */
export declare function useSaveFraming(): import("@tanstack/react-query").UseMutationResult<AnalysisSettings, Error, Partial<Record<Language, string>>, unknown>;
/** Changes the publication mode (UD-070); the Editor only. */
export declare function useSavePublication(): import("@tanstack/react-query").UseMutationResult<{
    auto_publish: boolean;
}, Error, boolean, unknown>;
/** The owner's switch of interface telemetry (UD-091); `me` carries it back. */
export declare function useSaveUiTelemetry(): import("@tanstack/react-query").UseMutationResult<unknown, Error, boolean, unknown>;
export declare function usePurgeJobs(): import("@tanstack/react-query").UseMutationResult<{
    purged: number;
}, Error, PurgeState, unknown>;
/** Loads the sample set of ejemplos/ (POST /ops/seed, Editor): the inputs enter the tray and go through the real analysis. */
export declare function useSeedExamples(): import("@tanstack/react-query").UseMutationResult<{
    created: number;
    existing: number;
}, Error, void, unknown>;
/** Empties the test data (POST /ops/reset, Editor, UD-240). `onDone` runs with the figures before every query is invalidated. */
export declare function useResetData(options?: {
    onDone?: (result: ResetResult) => void | Promise<void>;
}): import("@tanstack/react-query").UseMutationResult<ResetResult, Error, ResetScope, unknown>;
