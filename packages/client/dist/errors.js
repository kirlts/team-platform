/** Codes the client itself raises, never the server: there was no answer to read one from. */
export const CLIENT_ERROR_CODES = {
    /** The request did not reach the server (status 0). */
    network: 'network',
    /** The caller aborted an upload (status 0). */
    cancelled: 'cancelled',
    /** The server answered 2xx with a body that is not JSON. */
    invalidResponse: 'invalid_response',
};
/** The code of the optimistic-concurrency refusal: another edit got in first (UD-071, UD-253). */
export const EDIT_CONFLICT = 'edit_conflict';
/**
 * API error: `{ code, message }` with the stable code a client translates to its own catalog; `message` is the server's
 * Spanish sentence and is meant to be shown only if the code has no translation. `status` 0 is a failure before an answer.
 */
export class TeamApiError extends Error {
    status;
    code;
    /** The other fields of the body (`cause`, `used_by`, `duration_ms`…), for the codes that carry data. */
    details;
    constructor(status, message, code = '', details = {}) {
        super(message);
        this.name = 'TeamApiError';
        this.status = status;
        this.code = code;
        this.details = details;
    }
}
/** True for a `TeamApiError`, also across two copies of the package (it is checked by name, not by class identity). */
export function isTeamApiError(err) {
    return err instanceof TeamApiError || (err instanceof Error && err.name === 'TeamApiError' && typeof err.code === 'string');
}
/** True when `err` is a `TeamApiError` with this code. */
export function hasErrorCode(err, code) {
    return isTeamApiError(err) && err.code === code;
}
/** The answer to an edit that carried a stale `version`: 409 `edit_conflict`. */
export const isEditConflict = (err) => hasErrorCode(err, EDIT_CONFLICT);
/** The error of a response that is not 2xx: reads `{ code, message, ...details }` and falls back to `http_<status>`. */
export async function errorFromResponse(res) {
    let message = '';
    let code = '';
    let details = {};
    try {
        const data = await res.json();
        if (data && typeof data === 'object') {
            const { code: c, message: m, ...rest } = data;
            if (typeof c === 'string')
                code = c;
            details = rest;
            if (typeof m === 'string')
                message = m;
            else if (typeof rest.error === 'string')
                message = rest.error;
        }
    }
    catch {
        // Empty or non-JSON body: only the HTTP status remains.
    }
    return new TeamApiError(res.status, message, code || `http_${res.status}`, details);
}
