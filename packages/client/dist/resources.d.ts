import { type MessageQuery } from './filters.js';
import type { Transport } from './http.js';
import { type Versioning } from './versioning.js';
import type { Area, AnalysisSettings, AuditEntry, Check, Connection, ConnectionResult, ConnectionsView, CreatedInput, DeleteInputResult, DeleteMemberResult, InputRecord, JobState, JobTrace, Language, Me, Member, MemberPatch, Message, MessageDetail, MessagePatch, MessageSummary, MessageTiming, NewConnection, NewInput, NewMember, NewReply, Paged, Project, Proposal, ProviderSetting, ProviderSlot, PurgeState, ResetResult, ResetScope, QueueInput, ReprocessResult, RunningJob, Template, UiSummary } from './types.js';
/** Statuses of an input that still needs the person: running, ready to review or failed (UD-025). */
export declare const TRAY_STATUSES: readonly ["queued", "extracting", "analyzing", "proposed", "failed"];
export interface MessagesQuery {
    query: MessageQuery;
    meId: string;
    /** Only messages with replies, ordered by the latest (Inicio). */
    repliesFeed?: boolean;
}
export interface AreaFields {
    id?: string;
    title?: string;
    description?: string;
    color?: string;
}
export interface TemplateFields {
    id?: string;
    name?: string;
    description?: string;
    body_markdown?: string;
}
export type ProviderChange = Pick<ProviderSetting, 'slot'> & Partial<Pick<ProviderSetting, 'provider' | 'model' | 'base_url'>>;
export declare function createResources(t: Transport): {
    auth: {
        login: (v: {
            email: string;
            password: string;
        }) => Promise<unknown>;
        /** Closes the session of our own; the host's own sign-out (`logout_url`, H-3720) comes back when it has one. */
        logout: () => Promise<{
            logout_url?: string;
        } | undefined>;
    };
    me: {
        get: () => Promise<Me>;
    };
    health: () => Promise<Record<string, unknown>>;
    members: {
        list: () => Promise<Member[]>;
        create: (v: NewMember) => Promise<Member>;
        /** `self` changes the account of the session (`/members/me`); otherwise the member `id` (Editor). */
        save: (v: {
            id: string;
            self: boolean;
            patch: MemberPatch;
        }) => Promise<Member>;
        saveLanguage: (language: Language) => Promise<Member>;
        /** Another member's password (Editor): it closes that person's sessions. */
        setPassword: (v: {
            id: string;
            password: string;
        }) => Promise<Member>;
        /** Deleting for good (Editor, UD-240). `purge` takes their history too; without it a member with history is a 409 `member_has_history`. */
        delete: (v: {
            id: string;
            purge?: boolean;
        }) => Promise<DeleteMemberResult>;
    };
    areas: {
        /** Sorted by `position`. */
        list: () => Promise<Area[]>;
        /** The deleted ones (Editor). */
        listDeleted: () => Promise<Area[]>;
        /** Creates the area, or edits `id` when it is given. */
        save: (v: AreaFields) => Promise<Area>;
        /** Soft-deletes (Editor, UD-240): its messages stay and a restore brings it back. */
        delete: (id: string) => Promise<unknown>;
        restore: (id: string) => Promise<Area>;
        /** One DELETE each, in parallel: an Editor may delete every area, so there is no permission to split. */
        deleteMany: (ids: readonly string[]) => Promise<unknown[]>;
        restoreMany: (ids: readonly string[]) => Promise<unknown[]>;
    };
    templates: {
        list: (areaId: string) => Promise<Template[]>;
        listDeleted: (areaId: string) => Promise<Template[]>;
        /** Creates the template, or edits `id` when it is given. */
        save: (areaId: string, v: TemplateFields) => Promise<unknown>;
        /** Every destructive operation requires explicit confirmation (MASTER-SPEC, API conventions). */
        delete: (areaId: string, id: string) => Promise<unknown>;
        restore: (id: string) => Promise<Template>;
        deleteMany: (areaId: string, ids: readonly string[]) => Promise<unknown[]>;
        restoreMany: (ids: readonly string[]) => Promise<unknown[]>;
    };
    messages: {
        /** Server filters plus the negations and «sin respuestas» that the server does not know, applied here. */
        list: ({ query, meId, repliesFeed }: MessagesQuery) => Promise<Message[]>;
        /** What affects the person and the pending of each area. */
        summary: () => Promise<MessageSummary>;
        get: (id: string) => Promise<MessageDetail>;
        /**
         * Edits a published message (UD-071). The request carries the `version` that was read; on 409 `edit_conflict` the message is
         * read again and the same change goes once more (see `sendVersioned`). Returns the saved message.
         */
        patch: (id: string, patch: MessagePatch, versioning?: Versioning<MessageDetail>) => Promise<MessageDetail>;
        /** New files and links on a published message (UD-071): they go at the end and count as an edit, with the version that was read. */
        addAttachments: (id: string, v: {
            files: File[];
            links?: string[];
        }, versioning?: Versioning<MessageDetail>) => Promise<MessageDetail>;
        close: (id: string) => Promise<unknown>;
        reopen: (id: string) => Promise<unknown>;
        setClosed: (v: {
            id: string;
            closed: boolean;
        }) => Promise<unknown>;
        /** Soft-deletes (UD-240): its sender or the Editor; a restore undoes it. */
        delete: (id: string) => Promise<unknown>;
        restore: (id: string) => Promise<MessageDetail>;
        /** Several in one request: all or none, 403 with the ids that are not the person's (UD-253, H-3715). */
        deleteMany: (ids: readonly string[]) => Promise<{
            ids: string[];
        }>;
        restoreMany: (ids: readonly string[]) => Promise<{
            ids: string[];
        }>;
        /** Where the time of the execution of a message went. A 404 means it has no execution. */
        timing: (id: string) => Promise<MessageTiming>;
        /** Queues the `execute` job of a message (Editor). */
        execute: (id: string) => Promise<Record<string, unknown>>;
    };
    replies: {
        /** JSON, or multipart when there are files or links. */
        create: (messageId: string, reply: NewReply) => Promise<unknown>;
        /**
         * Edits the text of a reply, only by its author (UD-253, H-3714). It sends the version read in the thread; on `edit_conflict`
         * it reads the thread again and retries once with the current version. Returns the message with its thread.
         */
        edit: (messageId: string, replyId: string, body: string, versioning?: Versioning<MessageDetail>) => Promise<MessageDetail>;
        /** Soft-deletes (UD-240): its author or the Editor. Returns the message with its thread. */
        delete: (messageId: string, replyId: string) => Promise<MessageDetail>;
        restore: (replyId: string) => Promise<MessageDetail>;
    };
    inputs: {
        get: (id: string) => Promise<InputRecord>;
        /** My inputs in the tray: oldest first, so the ones that arrived first are reviewed first. */
        tray: () => Promise<InputRecord[]>;
        /** Every send of mine, newest first, whatever its state (UD-070); the ones I discarded are not part of it. */
        history: () => Promise<InputRecord[]>;
        /** The sends of everybody (Editor), newest first, one server page. */
        queue: (page: number, limit: number) => Promise<Paged<QueueInput>>;
        /** Sends the input as multipart without progress (a server, a script). Idempotent by content hash (MASTER-SPEC §1.3). */
        create: (input: NewInput, signal?: AbortSignal) => Promise<CreatedInput>;
        /** Sends the input with upload progress (XMLHttpRequest, so it needs a browser or an `xhr` factory). */
        upload: (input: NewInput, onProgress: (fraction: number) => void, signal?: AbortSignal) => Promise<CreatedInput>;
        publish: (inputId: string, proposal: Proposal) => Promise<{
            message_ids?: string[];
        }>;
        /** Saves the proposal draft: what was edited survives closing the tab. */
        saveProposal: (inputId: string, proposal: Proposal) => Promise<Proposal>;
        /** Changes the text of the submitted input. */
        saveText: (inputId: string, text: string) => Promise<InputRecord>;
        /** Requeues the analysis; keeps the text and the extractions. Published: the Editor only, its messages go to the trash. */
        reprocess: (inputId: string) => Promise<ReprocessResult>;
        /** Undoes a discard: the send comes back with the proposal and the edits it had. */
        restore: (inputId: string) => Promise<{
            input_id: string;
            status: string;
        }>;
        /** Deletes for real (UD-240): attachments, jobs and proposal; with `withMessages`, the messages it published too. */
        delete: (v: {
            id: string;
            withMessages: boolean;
        }) => Promise<DeleteInputResult>;
        cancel: (inputId: string) => Promise<unknown>;
    };
    providers: {
        list: () => Promise<ProviderSetting[]>;
        /** The server tests the combination before it applies it: a failure (422 `provider_check_failed`) leaves the previous setting. */
        save: (v: ProviderChange) => Promise<unknown>;
        /** Diagnosis of one function: the provider and the model it uses now. */
        check: (slot: ProviderSlot) => Promise<{
            check: Check;
            slot: ProviderSlot;
            provider: string;
            model: string;
        }>;
    };
    connections: {
        /** Providers with the state of their keys, and the presets that can be added (Editor). */
        list: () => Promise<ConnectionsView>;
        /** Adds a provider with its key; the server tests first and saves nothing when the test fails. */
        add: (v: NewConnection) => Promise<ConnectionResult>;
        /** Replaces a key: tested first, applied only if it works; otherwise the previous key stays. */
        replaceKey: (v: {
            name: string;
            api_key: string;
            model?: string;
        }) => Promise<ConnectionResult>;
        retireKey: (name: string) => Promise<{
            connection: Connection;
        }>;
        delete: (name: string) => Promise<{
            deleted: boolean;
        }>;
        /** Diagnosis of one provider (always answers 200; the body says whether it worked). */
        check: (v: {
            name: string;
            model?: string;
        }) => Promise<{
            name: string;
            check: Check;
        }>;
    };
    project: {
        get: () => Promise<Project>;
        /** Changes the description with text (in-place edit) or with a `.md` file (multipart `file`). */
        save: (v: {
            description: string;
        } | {
            file: File;
        }) => Promise<Project>;
        /** Saves the project name (empty goes back to PROJECT_NAME). */
        saveName: (name: string) => Promise<Project>;
    };
    analysis: {
        get: () => Promise<AnalysisSettings>;
        /** Saves the framing of one or both languages; an empty text goes back to the default. */
        saveFraming: (framing: Partial<Record<Language, string>>) => Promise<AnalysisSettings>;
    };
    publication: {
        get: () => Promise<{
            auto_publish: boolean;
        }>;
        save: (autoPublish: boolean) => Promise<{
            auto_publish: boolean;
        }>;
    };
    telemetry: {
        /** Turns interface telemetry on or off (Editor). */
        setUiEnabled: (enabled: boolean) => Promise<unknown>;
        /** Summary of how the interface is used (Editor). */
        uiSummary: () => Promise<UiSummary>;
        /** Sends a batch of interface events, as an object or as the JSON text already built. `keepalive` lets it outlive the page. */
        sendUi: (batch: object | string, options?: {
            keepalive?: boolean;
        }) => Promise<unknown>;
    };
    jobs: {
        list: (state: JobState, options?: {
            page?: number;
            limit?: number;
        }) => Promise<Paged<unknown>>;
        /** The `execute` jobs that are running now, with their phase. */
        runningExecutions: () => Promise<RunningJob[]>;
        trace: (jobId: string) => Promise<JobTrace>;
        purge: (state: PurgeState) => Promise<{
            purged: number;
        }>;
    };
    audit: {
        list: (page: number, limit: number, action?: string) => Promise<Paged<AuditEntry>>;
    };
    ops: {
        /** Loads the sample set of `ejemplos/`: the inputs enter the tray and go through the real analysis. */
        seed: () => Promise<{
            created: number;
            existing: number;
        }>;
        reset: (scope: ResetScope) => Promise<ResetResult>;
    };
    attachments: {
        /** The text the server extracted from an audio or a video (`GET /attachments/:id/transcript`). */
        transcript: (id: string) => Promise<{
            text?: string;
        }>;
    };
};
export type TeamResources = ReturnType<typeof createResources>;
