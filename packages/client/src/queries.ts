// The reads, as `{ queryKey, queryFn }`: what `useQuery` of any TanStack adapter takes (React, Vue, Svelte, Solid) or
// `queryClient.fetchQuery`. The key and the function travel together, so two screens that read the same thing share one cache entry.
import type { TeamClient } from './client.js'
import { messagesQueryString, type MessageQuery } from './filters.js'
import { queryKeys } from './keys.js'
import { JOB_STATES, type JobState } from './types.js'

export interface MessagesParams {
  query: MessageQuery
  meId: string
  /** Only messages with replies, ordered by the latest (Inicio). */
  repliesFeed?: boolean
}

export function createQueries(client: TeamClient) {
  return {
    me: () => ({ queryKey: queryKeys.me(), queryFn: () => client.me.get() }),
    members: () => ({ queryKey: queryKeys.members(), queryFn: () => client.members.list() }),
    areas: () => ({ queryKey: queryKeys.areas(), queryFn: () => client.areas.list() }),
    deletedAreas: () => ({ queryKey: queryKeys.deletedAreas(), queryFn: () => client.areas.listDeleted() }),
    templates: (areaId: string | undefined) => ({ queryKey: queryKeys.templates(areaId), queryFn: () => client.templates.list(areaId as string) }),
    deletedTemplates: (areaId: string | undefined) => ({ queryKey: queryKeys.deletedTemplates(areaId), queryFn: () => client.templates.listDeleted(areaId as string) }),
    messages: (p: MessagesParams) => ({
      queryKey: queryKeys.messages(messagesQueryString(p.query, p.repliesFeed), p.meId),
      queryFn: () => client.messages.list(p),
    }),
    summary: () => ({ queryKey: queryKeys.summary(), queryFn: () => client.messages.summary() }),
    message: (id: string | undefined) => ({ queryKey: queryKeys.message(id), queryFn: () => client.messages.get(id as string) }),
    input: (id: string | undefined) => ({ queryKey: queryKeys.input(id), queryFn: () => client.inputs.get(id as string) }),
    tray: () => ({ queryKey: queryKeys.tray(), queryFn: () => client.inputs.tray() }),
    history: () => ({ queryKey: queryKeys.history(), queryFn: () => client.inputs.history() }),
    queue: (page: number, limit: number) => ({ queryKey: queryKeys.queue(page, limit), queryFn: () => client.inputs.queue(page, limit) }),
    providers: () => ({ queryKey: queryKeys.providers(), queryFn: () => client.providers.list() }),
    connections: () => ({ queryKey: queryKeys.connections(), queryFn: () => client.connections.list() }),
    project: () => ({ queryKey: queryKeys.project(), queryFn: () => client.project.get() }),
    analysisSettings: () => ({ queryKey: queryKeys.analysisSettings(), queryFn: () => client.analysis.get() }),
    publication: () => ({ queryKey: queryKeys.publication(), queryFn: () => client.publication.get() }),
    /** One request per state, the total of each. */
    jobCounts: () => ({
      queryKey: queryKeys.jobCounts(),
      queryFn: async () => {
        const totals = await Promise.all(JOB_STATES.map(async (state) => (await client.jobs.list(state)).total))
        return Object.fromEntries(JOB_STATES.map((state, i) => [state, totals[i]])) as Record<JobState, number>
      },
    }),
    sessionSteps: (messageId: string) => ({ queryKey: queryKeys.sessionSteps(messageId), queryFn: () => client.messages.session(messageId) }),
    messageTiming: (messageId: string) => ({ queryKey: queryKeys.messageTiming(messageId), queryFn: () => client.messages.timing(messageId) }),
    runningExecutions: () => ({ queryKey: queryKeys.runningExecutions(), queryFn: () => client.jobs.runningExecutions() }),
    executeRunsSummary: (days: number) => ({ queryKey: queryKeys.executeRunsSummary(days), queryFn: () => client.ops.executeRunsSummary(days) }),
    jobTrace: (jobId: string) => ({ queryKey: queryKeys.jobTrace(jobId), queryFn: () => client.jobs.trace(jobId) }),
    audit: (page: number, limit: number, action: string) => ({ queryKey: queryKeys.audit(page, limit, action), queryFn: () => client.audit.list(page, limit, action) }),
    uiSummary: () => ({ queryKey: queryKeys.uiSummary(), queryFn: () => client.telemetry.uiSummary() }),
  }
}

export type TeamQueries = ReturnType<typeof createQueries>

/** Sends of the queue still in the analysis: the list asks again while any is (the event stream reaches the sender, not the Editor who watches the queue). */
export const IN_FLIGHT_STATUSES: ReadonlySet<string> = new Set(['queued', 'extracting', 'analyzing'])

/** While a listed send is still in the analysis the list asks again every two seconds, and it stops when none is. */
export const IN_FLIGHT_REFETCH_MS = 2000
