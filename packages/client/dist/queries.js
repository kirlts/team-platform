import { messagesQueryString } from './filters.js';
import { queryKeys } from './keys.js';
import { JOB_STATES } from './types.js';
export function createQueries(client) {
    return {
        me: () => ({ queryKey: queryKeys.me(), queryFn: () => client.me.get() }),
        members: () => ({ queryKey: queryKeys.members(), queryFn: () => client.members.list() }),
        areas: () => ({ queryKey: queryKeys.areas(), queryFn: () => client.areas.list() }),
        deletedAreas: () => ({ queryKey: queryKeys.deletedAreas(), queryFn: () => client.areas.listDeleted() }),
        templates: (areaId) => ({ queryKey: queryKeys.templates(areaId), queryFn: () => client.templates.list(areaId) }),
        deletedTemplates: (areaId) => ({ queryKey: queryKeys.deletedTemplates(areaId), queryFn: () => client.templates.listDeleted(areaId) }),
        messages: (p) => ({
            queryKey: queryKeys.messages(messagesQueryString(p.query, p.repliesFeed), p.meId),
            queryFn: () => client.messages.list(p),
        }),
        summary: () => ({ queryKey: queryKeys.summary(), queryFn: () => client.messages.summary() }),
        message: (id) => ({ queryKey: queryKeys.message(id), queryFn: () => client.messages.get(id) }),
        input: (id) => ({ queryKey: queryKeys.input(id), queryFn: () => client.inputs.get(id) }),
        tray: () => ({ queryKey: queryKeys.tray(), queryFn: () => client.inputs.tray() }),
        history: () => ({ queryKey: queryKeys.history(), queryFn: () => client.inputs.history() }),
        queue: (page, limit) => ({ queryKey: queryKeys.queue(page, limit), queryFn: () => client.inputs.queue(page, limit) }),
        providers: () => ({ queryKey: queryKeys.providers(), queryFn: () => client.providers.list() }),
        connections: () => ({ queryKey: queryKeys.connections(), queryFn: () => client.connections.list() }),
        project: () => ({ queryKey: queryKeys.project(), queryFn: () => client.project.get() }),
        analysisSettings: () => ({ queryKey: queryKeys.analysisSettings(), queryFn: () => client.analysis.get() }),
        publication: () => ({ queryKey: queryKeys.publication(), queryFn: () => client.publication.get() }),
        /** One request per state, the total of each. */
        jobCounts: () => ({
            queryKey: queryKeys.jobCounts(),
            queryFn: async () => {
                const totals = await Promise.all(JOB_STATES.map(async (state) => (await client.jobs.list(state)).total));
                return Object.fromEntries(JOB_STATES.map((state, i) => [state, totals[i]]));
            },
        }),
        messageTiming: (messageId) => ({ queryKey: queryKeys.messageTiming(messageId), queryFn: () => client.messages.timing(messageId) }),
        runningExecutions: () => ({ queryKey: queryKeys.runningExecutions(), queryFn: () => client.jobs.runningExecutions() }),
        jobTrace: (jobId) => ({ queryKey: queryKeys.jobTrace(jobId), queryFn: () => client.jobs.trace(jobId) }),
        audit: (page, limit, action) => ({ queryKey: queryKeys.audit(page, limit, action), queryFn: () => client.audit.list(page, limit, action) }),
        uiSummary: () => ({ queryKey: queryKeys.uiSummary(), queryFn: () => client.telemetry.uiSummary() }),
    };
}
/** Sends of the queue still in the analysis: the list asks again while any is (the event stream reaches the sender, not the Editor who watches the queue). */
export const IN_FLIGHT_STATUSES = new Set(['queued', 'extracting', 'analyzing']);
/** While a listed send is still in the analysis the list asks again every two seconds, and it stops when none is. */
export const IN_FLIGHT_REFETCH_MS = 2000;
