/** The first element of every key. */
export type QueryRoot = 'me' | 'members' | 'areas' | 'templates' | 'messages' | 'message' | 'inputs' | 'providers' | 'connections' | 'models' | 'project' | 'analysis-settings' | 'publication' | 'jobs' | 'audit' | 'telemetry';
export declare const queryKeys: {
    me: () => readonly ["me"];
    members: () => readonly ["members"];
    areas: () => readonly ["areas"];
    /** Under `areas`: restoring an area refreshes it with the live list. */
    deletedAreas: () => readonly ["areas", "deleted"];
    templates: (areaId: string | undefined) => readonly ["templates", string | undefined];
    /** Under `templates/<area>`: restoring a template refreshes it with the live list. */
    deletedTemplates: (areaId: string | undefined) => readonly ["templates", string | undefined, "deleted"];
    /** `qs` is the query string sent to the server (see `messagesQueryString`); `meId` because «para mí» changes with the person. */
    messages: (qs: string, meId: string) => readonly ["messages", string, string];
    /** Under `messages`, so every change to a message refreshes it. */
    summary: () => readonly ["messages", "summary"];
    /** Under `messages`, so every change to a message refreshes it. */
    messageTiming: (messageId: string) => readonly ["messages", "timing", string];
    message: (id: string | undefined) => readonly ["message", string | undefined];
    input: (id: string | undefined) => readonly ["inputs", string | undefined];
    tray: () => readonly ["inputs", "tray"];
    history: () => readonly ["inputs", "history"];
    queue: (page: number, limit: number) => readonly ["inputs", "queue", number, number];
    providers: () => readonly ["providers"];
    connections: () => readonly ["connections"];
    /** The models a test of a provider listed; written by the tests, never fetched. */
    models: (name: string) => readonly ["models", string];
    project: () => readonly ["project"];
    analysisSettings: () => readonly ["analysis-settings"];
    publication: () => readonly ["publication"];
    jobCounts: () => readonly ["jobs", "counts"];
    runningExecutions: () => readonly ["jobs", "running-executions"];
    jobTrace: (jobId: string) => readonly ["jobs", "trace", string];
    audit: (page: number, limit: number, action: string) => readonly ["audit", number, number, string];
    uiSummary: () => readonly ["telemetry", "ui-summary"];
};
