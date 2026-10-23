import type { QueryRoot } from './keys.js';
/** The slice of a TanStack `QueryClient` this file needs; every adapter of TanStack Query (React, Vue, Svelte…) has it. */
export interface QueryClientLike {
    invalidateQueries(filters: {
        queryKey: readonly unknown[];
    }): Promise<unknown>;
}
export declare const INVALIDATE: {
    readonly publish: readonly ["messages", "areas", "inputs"];
    /** A published send sets its messages aside (UD-258): the lists of messages and the counts of areas change with it. */
    readonly reprocess: readonly ["inputs", "messages", "areas"];
    readonly restoreInput: readonly ["inputs"];
    readonly deleteInput: readonly ["inputs", "messages", "areas"];
    readonly cancelInput: readonly ["inputs"];
    readonly reply: readonly ["message", "messages", "areas"];
    /** After an edit of a published message; the detail itself is written with the answer (`mergeSavedMessage`). */
    readonly patchMessage: readonly ["messages", "areas", "inputs"];
    readonly addAttachments: readonly ["messages", "inputs"];
    /** After an edit of a reply; the detail is written with the answer. */
    readonly editReply: readonly ["messages"];
    readonly setClosed: readonly ["message", "messages", "areas"];
    readonly deleteMessage: readonly ["messages", "message", "areas", "inputs"];
    readonly restoreMessage: readonly ["messages", "message", "areas", "inputs"];
    readonly deleteReply: readonly ["message", "messages", "areas"];
    readonly restoreReply: readonly ["message", "messages", "areas"];
    readonly saveArea: readonly ["areas"];
    readonly deleteArea: readonly ["areas", "templates", "messages", "message"];
    readonly restoreArea: readonly ["areas", "templates", "messages", "message"];
    readonly saveTemplate: readonly ["templates", "areas"];
    readonly deleteTemplate: readonly ["templates", "areas"];
    readonly restoreTemplate: readonly ["templates", "areas"];
    readonly saveMember: readonly ["members", "me"];
    readonly deleteMember: readonly ["members", "messages", "message", "inputs"];
    readonly createMember: readonly ["members"];
    /** After the language change settles, whether it worked or not. */
    readonly language: readonly ["me", "members"];
    /** After a rename of the project; the project itself is written with the answer. */
    readonly saveProjectName: readonly ["me"];
    /** After the owner's switch of interface telemetry: `me` carries it. */
    readonly uiTelemetry: readonly ["me"];
    readonly providers: readonly ["providers", "connections"];
    readonly connections: readonly ["connections", "providers"];
    readonly purgeJobs: readonly ["jobs", "audit"];
    readonly jobsChanged: readonly ["jobs"];
    /** A message of somebody else arrived. */
    readonly newMessage: readonly ["messages", "areas"];
    /** The stream came back after a drop: what happened meanwhile arrives by replay, the queries are read again just in case. */
    readonly reconnect: readonly ["inputs", "messages"];
};
export type InvalidationName = keyof typeof INVALIDATE;
/** Invalidates every root of a list; resolves when the queries that were refetched have finished. */
export declare function invalidateRoots(qc: QueryClientLike, roots: readonly QueryRoot[]): Promise<unknown[]>;
/** Invalidates what the named operation makes stale. */
export declare function invalidate(qc: QueryClientLike, name: InvalidationName): Promise<unknown[]>;
