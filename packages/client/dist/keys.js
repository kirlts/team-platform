// The cache keys. A key starts with the root that names the kind of data (`messages`, `message`, `inputs`…); an invalidation
// by root refreshes every key under it, which is how one change reaches every list and detail that shows it.
//
//   ['me'] ['members'] ['areas'] ['templates', areaId] ['messages', qs, meId] ['message', id]
//   ['inputs', id] ['providers'] ['connections'] ['project'] …
export const queryKeys = {
    me: () => ['me'],
    members: () => ['members'],
    areas: () => ['areas'],
    /** Under `areas`: restoring an area refreshes it with the live list. */
    deletedAreas: () => ['areas', 'deleted'],
    templates: (areaId) => ['templates', areaId],
    /** Under `templates/<area>`: restoring a template refreshes it with the live list. */
    deletedTemplates: (areaId) => ['templates', areaId, 'deleted'],
    /** `qs` is the query string sent to the server (see `messagesQueryString`); `meId` because «para mí» changes with the person. */
    messages: (qs, meId) => ['messages', qs, meId],
    /** Under `messages`, so every change to a message refreshes it. */
    summary: () => ['messages', 'summary'],
    /** Under `messages`, so every change to a message refreshes it. */
    messageTiming: (messageId) => ['messages', 'timing', messageId],
    message: (id) => ['message', id],
    input: (id) => ['inputs', id],
    tray: () => ['inputs', 'tray'],
    history: () => ['inputs', 'history'],
    queue: (page, limit) => ['inputs', 'queue', page, limit],
    providers: () => ['providers'],
    connections: () => ['connections'],
    /** The models a test of a provider listed; written by the tests, never fetched. */
    models: (name) => ['models', name],
    project: () => ['project'],
    analysisSettings: () => ['analysis-settings'],
    publication: () => ['publication'],
    jobCounts: () => ['jobs', 'counts'],
    runningExecutions: () => ['jobs', 'running-executions'],
    jobTrace: (jobId) => ['jobs', 'trace', jobId],
    audit: (page, limit, action) => ['audit', page, limit, action],
    uiSummary: () => ['telemetry', 'ui-summary'],
};
