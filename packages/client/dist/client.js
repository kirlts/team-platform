import { connectEvents } from './events.js';
import { createTransport } from './http.js';
import { createResources } from './resources.js';
import { pathOf, routes } from './routes.js';
/**
 * The client of the contract. One per session of one server:
 *
 *   const team = createTeamClient({ baseUrl: 'https://team.example.org', apiPrefix: '/api', cookieMode: 'cross-origin' })
 *   const me = await team.me.get()
 */
export function createTeamClient(options = {}) {
    const transport = createTransport(options);
    const resources = createResources(transport);
    const prefixedUrl = (route, id) => transport.url(pathOf(route, { id }));
    const streamUrl = transport.url(pathOf(routes.events));
    return {
        ...resources,
        transport,
        request: transport.request,
        url: transport.url,
        attachmentUrl: (id) => prefixedUrl(routes.attachmentFile, id),
        replyAttachmentUrl: (id) => prefixedUrl(routes.replyAttachmentFile, id),
        transcriptUrl: (id) => prefixedUrl(routes.attachmentTranscript, id),
        raw: transport.raw,
        openapi: () => transport.request('/openapi.json'),
        events: {
            url: streamUrl,
            connect: (store, opts = {}) => connectEvents(store, streamUrl, opts.factory ??
                transport.eventSource ??
                ((u) => {
                    if (typeof EventSource === 'undefined')
                        throw new Error('No EventSource in this runtime: pass `eventSource` to createTeamClient.');
                    return new EventSource(u, { withCredentials: transport.credentials === 'include' });
                }), opts.onReconnect),
        },
    };
}
