// The transport: one `fetch` per call with the headers the server demands, the error mapped to `TeamApiError`.
import { CLIENT_ERROR_CODES, errorFromResponse, TeamApiError } from './errors.js';
import { pathOf } from './routes.js';
/** Header the server demands of every unsafe request that carries the session cookie (src/identity/csrf.js): its presence, not its value. */
export const REQUEST_HEADER = 'X-Team-Request';
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
const trimEnd = (s) => s.replace(/\/+$/, '');
/** `''`, `/api` and `api/` all mean the same prefix; an absolute address is kept as it is. */
export function normalizePrefix(raw) {
    const trimmed = trimEnd(raw.trim());
    if (!trimmed)
        return '';
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}
const isAbort = (err) => !!err && typeof err === 'object' && err.name === 'AbortError';
export function createTransport(options = {}) {
    const baseUrl = trimEnd((options.baseUrl ?? '').trim());
    const apiPrefix = normalizePrefix(options.apiPrefix ?? '/api');
    const requestMarker = options.requestMarker ?? 'client';
    const credentials = options.credentials ?? (options.cookieMode === 'cross-origin' ? 'include' : 'same-origin');
    const doFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    const url = (path) => `${baseUrl}${apiPrefix}${path}`;
    const headersFor = (method) => {
        const headers = { Accept: 'application/json' };
        if (!SAFE.has(method.toUpperCase()))
            headers[REQUEST_HEADER] = requestMarker;
        const extra = typeof options.headers === 'function' ? options.headers() : options.headers;
        return { ...headers, ...extra };
    };
    async function request(path, opts = {}) {
        const method = (opts.method ?? 'GET').toUpperCase();
        const headers = headersFor(method);
        let body;
        if (opts.form) {
            body = opts.form; // the runtime sets the multipart boundary
        }
        else if (opts.json !== undefined) {
            headers['Content-Type'] = 'application/json';
            body = opts.json;
        }
        else if (opts.body !== undefined) {
            headers['Content-Type'] = 'application/json';
            body = JSON.stringify(opts.body);
        }
        const settle = options.instrument?.(method, path) ?? (() => undefined);
        let res;
        try {
            res = await doFetch(url(path), { method, headers, body, credentials, signal: opts.signal, ...(opts.keepalive ? { keepalive: true } : {}) });
        }
        catch (err) {
            if (isAbort(err))
                throw err;
            settle({ status: 0 });
            throw new TeamApiError(0, '', CLIENT_ERROR_CODES.network);
        }
        if (!res.ok) {
            settle({ status: res.status });
            throw await errorFromResponse(res);
        }
        if (res.status === 204) {
            settle({ status: res.status });
            return undefined;
        }
        const text = await res.text();
        const data = (text ? JSON.parse(text) : undefined);
        settle({ status: res.status, body: data });
        return data;
    }
    return {
        baseUrl,
        apiPrefix,
        credentials,
        requestMarker,
        instrument: options.instrument,
        eventSource: options.eventSource,
        xhr: options.xhr,
        url,
        headersFor,
        request,
        call: (route, args = {}) => {
            const path = pathOf(route, args.params) + (args.search ? `?${args.search}` : '');
            return request(path, { method: route.method, body: args.body, json: args.json, form: args.form, signal: args.signal, keepalive: args.keepalive });
        },
        raw: (address, init = {}) => doFetch(address, { credentials, headers: headersFor('GET'), signal: init.signal }),
    };
}
