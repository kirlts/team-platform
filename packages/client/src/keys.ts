// The cache keys. A key starts with the root that names the kind of data (`messages`, `message`, `inputs`…); an invalidation
// by root refreshes every key under it, which is how one change reaches every list and detail that shows it.
//
//   ['me'] ['members'] ['areas'] ['templates', areaId] ['messages', qs, meId] ['message', id]
//   ['inputs', id] ['providers'] ['connections'] ['project'] …

/** The first element of every key. */
export type QueryRoot =
  | 'me'
  | 'members'
  | 'areas'
  | 'templates'
  | 'messages'
  | 'message'
  | 'inputs'
  | 'providers'
  | 'connections'
  | 'models'
  | 'project'
  | 'analysis-settings'
  | 'publication'
  | 'jobs'
  | 'session'
  | 'audit'
  | 'telemetry'
  | 'ops'

export const queryKeys = {
  me: () => ['me'] as const,
  members: () => ['members'] as const,
  areas: () => ['areas'] as const,
  /** Under `areas`: restoring an area refreshes it with the live list. */
  deletedAreas: () => ['areas', 'deleted'] as const,
  templates: (areaId: string | undefined) => ['templates', areaId] as const,
  /** Under `templates/<area>`: restoring a template refreshes it with the live list. */
  deletedTemplates: (areaId: string | undefined) => ['templates', areaId, 'deleted'] as const,
  /** `qs` is the query string sent to the server (see `messagesQueryString`); `meId` because «para mí» changes with the person. */
  messages: (qs: string, meId: string) => ['messages', qs, meId] as const,
  /** Under `messages`, so every change to a message refreshes it. */
  summary: () => ['messages', 'summary'] as const,
  /** Under `messages`, so every change to a message refreshes it. */
  messageTiming: (messageId: string) => ['messages', 'timing', messageId] as const,
  /** The steps of the session of a message's agent. Its own root: a step arrives every few seconds and must not make the lists stale. */
  sessionSteps: (messageId: string) => ['session', messageId] as const,
  message: (id: string | undefined) => ['message', id] as const,
  input: (id: string | undefined) => ['inputs', id] as const,
  tray: () => ['inputs', 'tray'] as const,
  history: () => ['inputs', 'history'] as const,
  queue: (page: number, limit: number) => ['inputs', 'queue', page, limit] as const,
  providers: () => ['providers'] as const,
  connections: () => ['connections'] as const,
  /** The models a test of a provider listed; written by the tests, never fetched. */
  models: (name: string) => ['models', name] as const,
  project: () => ['project'] as const,
  analysisSettings: () => ['analysis-settings'] as const,
  publication: () => ['publication'] as const,
  jobCounts: () => ['jobs', 'counts'] as const,
  runningExecutions: () => ['jobs', 'running-executions'] as const,
  executeRunsSummary: (days: number) => ['ops', 'execute-runs', 'summary', days] as const,
  jobTrace: (jobId: string) => ['jobs', 'trace', jobId] as const,
  audit: (page: number, limit: number, action: string) => ['audit', page, limit, action] as const,
  uiSummary: () => ['telemetry', 'ui-summary'] as const,
}
