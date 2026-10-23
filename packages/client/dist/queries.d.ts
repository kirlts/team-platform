import type { TeamClient } from './client.js';
import { type MessageQuery } from './filters.js';
export interface MessagesParams {
    query: MessageQuery;
    meId: string;
    /** Only messages with replies, ordered by the latest (Inicio). */
    repliesFeed?: boolean;
}
export declare function createQueries(client: TeamClient): {
    me: () => {
        queryKey: readonly ["me"];
        queryFn: () => Promise<import("./types.js").Me>;
    };
    members: () => {
        queryKey: readonly ["members"];
        queryFn: () => Promise<import("./types.js").Member[]>;
    };
    areas: () => {
        queryKey: readonly ["areas"];
        queryFn: () => Promise<import("./types.js").Area[]>;
    };
    deletedAreas: () => {
        queryKey: readonly ["areas", "deleted"];
        queryFn: () => Promise<import("./types.js").Area[]>;
    };
    templates: (areaId: string | undefined) => {
        queryKey: readonly ["templates", string | undefined];
        queryFn: () => Promise<import("./types.js").Template[]>;
    };
    deletedTemplates: (areaId: string | undefined) => {
        queryKey: readonly ["templates", string | undefined, "deleted"];
        queryFn: () => Promise<import("./types.js").Template[]>;
    };
    messages: (p: MessagesParams) => {
        queryKey: readonly ["messages", string, string];
        queryFn: () => Promise<import("./types.js").Message[]>;
    };
    summary: () => {
        queryKey: readonly ["messages", "summary"];
        queryFn: () => Promise<import("./types.js").MessageSummary>;
    };
    message: (id: string | undefined) => {
        queryKey: readonly ["message", string | undefined];
        queryFn: () => Promise<import("./types.js").MessageDetail>;
    };
    input: (id: string | undefined) => {
        queryKey: readonly ["inputs", string | undefined];
        queryFn: () => Promise<import("./types.js").InputRecord>;
    };
    tray: () => {
        queryKey: readonly ["inputs", "tray"];
        queryFn: () => Promise<import("./types.js").InputRecord[]>;
    };
    history: () => {
        queryKey: readonly ["inputs", "history"];
        queryFn: () => Promise<import("./types.js").InputRecord[]>;
    };
    queue: (page: number, limit: number) => {
        queryKey: readonly ["inputs", "queue", number, number];
        queryFn: () => Promise<import("./types.js").Paged<import("./types.js").QueueInput>>;
    };
    providers: () => {
        queryKey: readonly ["providers"];
        queryFn: () => Promise<import("./types.js").ProviderSetting[]>;
    };
    connections: () => {
        queryKey: readonly ["connections"];
        queryFn: () => Promise<import("./types.js").ConnectionsView>;
    };
    project: () => {
        queryKey: readonly ["project"];
        queryFn: () => Promise<import("./types.js").Project>;
    };
    analysisSettings: () => {
        queryKey: readonly ["analysis-settings"];
        queryFn: () => Promise<import("./types.js").AnalysisSettings>;
    };
    publication: () => {
        queryKey: readonly ["publication"];
        queryFn: () => Promise<{
            auto_publish: boolean;
        }>;
    };
    /** One request per state, the total of each. */
    jobCounts: () => {
        queryKey: readonly ["jobs", "counts"];
        queryFn: () => Promise<Record<"queued" | "failed" | "cancelled" | "running" | "done", number>>;
    };
    messageTiming: (messageId: string) => {
        queryKey: readonly ["messages", "timing", string];
        queryFn: () => Promise<import("./types.js").MessageTiming>;
    };
    runningExecutions: () => {
        queryKey: readonly ["jobs", "running-executions"];
        queryFn: () => Promise<import("./types.js").RunningJob[]>;
    };
    jobTrace: (jobId: string) => {
        queryKey: readonly ["jobs", "trace", string];
        queryFn: () => Promise<import("./types.js").JobTrace>;
    };
    audit: (page: number, limit: number, action: string) => {
        queryKey: readonly ["audit", number, number, string];
        queryFn: () => Promise<import("./types.js").Paged<import("./types.js").AuditEntry>>;
    };
    uiSummary: () => {
        queryKey: readonly ["telemetry", "ui-summary"];
        queryFn: () => Promise<import("./types.js").UiSummary>;
    };
};
export type TeamQueries = ReturnType<typeof createQueries>;
/** Sends of the queue still in the analysis: the list asks again while any is (the event stream reaches the sender, not the Editor who watches the queue). */
export declare const IN_FLIGHT_STATUSES: ReadonlySet<string>;
/** While a listed send is still in the analysis the list asks again every two seconds, and it stops when none is. */
export declare const IN_FLIGHT_REFETCH_MS = 2000;
