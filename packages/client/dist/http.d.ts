import { type Route } from './routes.js';
/** Header the server demands of every unsafe request that carries the session cookie (src/identity/csrf.js): its presence, not its value. */
export declare const REQUEST_HEADER = "X-Team-Request";
/** What `instrument` receives when the call ends: the status (0 when there was no answer) and the parsed body. */
export interface CallResult {
    status: number;
    body?: unknown;
}
export interface TeamClientOptions {
    /** Origin of the API, without the path: `https://team.example.org`. Empty (the default) for the same origin as the page. */
    baseUrl?: string;
    /** Where the API lives under `baseUrl` (`API_PREFIX` of the server). Default `/api`. */
    apiPrefix?: string;
    /** Headers added to every request, or a function that returns them each time (a token that rotates). */
    headers?: Record<string, string> | (() => Record<string, string>);
    /** The `fetch` to use. By default the global one, looked up at each call. */
    fetch?: typeof fetch;
    /** Value of the `X-Team-Request` header on unsafe requests. Default `client`; the server only checks that it is there. */
    requestMarker?: string;
    /** `COOKIE_MODE` of the server. `cross-origin` sends the session cookie to another origin (`credentials: 'include'`). Default `same-origin`. */
    cookieMode?: 'same-origin' | 'cross-origin';
    /** Overrides what `cookieMode` decides for `fetch`, the upload and the event stream. */
    credentials?: RequestCredentials;
    /**
     * Called before each request with the method and the path relative to the prefix; returns the function that receives the
     * result. It is how an interface counts and times its calls (UD-091) without the client knowing about it.
     */
    instrument?: (method: string, path: string) => (result: CallResult) => void;
    /** Creates the `EventSource` of the event stream. By default the global one, with the credentials of the client. */
    eventSource?: (url: string) => EventSourceLike;
    /** Creates the `XMLHttpRequest` of the upload with progress. By default the global one. */
    xhr?: () => XMLHttpRequest;
}
/** The part of `EventSource` the stream uses; a test or another runtime supplies its own. */
export interface EventSourceLike {
    readyState: number;
    close(): void;
    addEventListener(type: string, listener: (e: MessageEvent) => void): void;
    onopen: ((e: Event) => void) | null;
    onerror: ((e: Event) => void) | null;
    onmessage: ((e: MessageEvent) => void) | null;
}
export interface RequestOptions {
    method?: string;
    body?: unknown;
    /** A body that is already serialized JSON; sent as it is, with the JSON content type. */
    json?: string;
    form?: FormData;
    signal?: AbortSignal;
    /** Lets the request outlive the page (interface telemetry on closing). */
    keepalive?: boolean;
}
/** What a call to a contract route takes. `search` is the query string already serialized, without the `?`. */
export interface CallArgs {
    params?: Readonly<Record<string, string | number>>;
    search?: string;
    body?: unknown;
    json?: string;
    form?: FormData;
    signal?: AbortSignal;
    keepalive?: boolean;
}
/** The settings the transport and the upload share. */
export interface Transport {
    readonly baseUrl: string;
    readonly apiPrefix: string;
    readonly credentials: RequestCredentials;
    readonly requestMarker: string;
    readonly instrument: TeamClientOptions['instrument'];
    readonly eventSource: TeamClientOptions['eventSource'];
    readonly xhr: TeamClientOptions['xhr'];
    /** Absolute (or origin-relative) address of an API path: `baseUrl` + `apiPrefix` + path. */
    url(path: string): string;
    /** The headers of a request: `Accept`, the marker if the method is unsafe, and the extra ones. */
    headersFor(method: string): Record<string, string>;
    request<T = unknown>(path: string, options?: RequestOptions): Promise<T>;
    call<T = unknown>(route: Route, args?: CallArgs): Promise<T>;
    /** An authenticated request to an address the API gave (a transcript, a file); returns the raw response. */
    raw(url: string, init?: {
        signal?: AbortSignal;
    }): Promise<Response>;
}
/** `''`, `/api` and `api/` all mean the same prefix; an absolute address is kept as it is. */
export declare function normalizePrefix(raw: string): string;
export declare function createTransport(options?: TeamClientOptions): Transport;
