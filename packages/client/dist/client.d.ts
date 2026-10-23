import { type EventSourceFactory, type EventsStore } from './events.js';
import { type TeamClientOptions, type Transport } from './http.js';
import { type TeamResources } from './resources.js';
export interface TeamClient extends TeamResources {
    /** The settings and the transport; `client.transport.request` is the low-level call by relative path. */
    readonly transport: Transport;
    /** A call by relative path (`/messages`, without the prefix) for what the typed functions do not cover. */
    request: Transport['request'];
    /** Address of an API path: `baseUrl` + `apiPrefix` + path. */
    url: Transport['url'];
    /** The file of an attachment of a message or of its input (`GET /attachments/:id`): an address for `<img src>` or a link. */
    attachmentUrl(id: string): string;
    /** The file attached to a reply: it has its own ids and its own route (`GET /replies/attachments/:id`). */
    replyAttachmentUrl(id: string): string;
    /** The text extracted from an audio or a video (`GET /attachments/:id/transcript`). */
    transcriptUrl(id: string): string;
    /** A request with the credentials and headers of the client to an address the API gave (a transcript), as a raw response. */
    raw: Transport['raw'];
    /** The OpenAPI document the server publishes (`GET /openapi.json`, no session). */
    openapi(): Promise<Record<string, unknown>>;
    events: {
        /** Address of the stream (`GET /events`, MASTER-SPEC §7.10). */
        url: string;
        /**
         * Opens the single stream of the session and feeds `store` with its events; returns the function that closes it.
         * `onReconnect` runs when the stream comes back after a drop. `factory` replaces the `EventSource` (a test, another runtime).
         */
        connect(store: EventsStore, options?: {
            onReconnect?: () => void;
            factory?: EventSourceFactory;
        }): () => void;
    };
}
/**
 * The client of the contract. One per session of one server:
 *
 *   const team = createTeamClient({ baseUrl: 'https://team.example.org', apiPrefix: '/api', cookieMode: 'cross-origin' })
 *   const me = await team.me.get()
 */
export declare function createTeamClient(options?: TeamClientOptions): TeamClient;
