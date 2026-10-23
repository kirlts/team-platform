import type { RequestErrorCode } from './generated/error-codes.js';
/** Codes the client itself raises, never the server: there was no answer to read one from. */
export declare const CLIENT_ERROR_CODES: {
    /** The request did not reach the server (status 0). */
    readonly network: "network";
    /** The caller aborted an upload (status 0). */
    readonly cancelled: "cancelled";
    /** The server answered 2xx with a body that is not JSON. */
    readonly invalidResponse: "invalid_response";
};
export type ClientErrorCode = (typeof CLIENT_ERROR_CODES)[keyof typeof CLIENT_ERROR_CODES];
/** What `code` can be: a code of the server, one of the client, or `http_<status>` when the body carried none. */
export type TeamErrorCode = RequestErrorCode | ClientErrorCode | `http_${number}`;
/** The code of the optimistic-concurrency refusal: another edit got in first (UD-071, UD-253). */
export declare const EDIT_CONFLICT = "edit_conflict";
/**
 * API error: `{ code, message }` with the stable code a client translates to its own catalog; `message` is the server's
 * Spanish sentence and is meant to be shown only if the code has no translation. `status` 0 is a failure before an answer.
 */
export declare class TeamApiError extends Error {
    readonly status: number;
    readonly code: string;
    /** The other fields of the body (`cause`, `used_by`, `duration_ms`…), for the codes that carry data. */
    readonly details: Record<string, unknown>;
    constructor(status: number, message: string, code?: string, details?: Record<string, unknown>);
}
/** True for a `TeamApiError`, also across two copies of the package (it is checked by name, not by class identity). */
export declare function isTeamApiError(err: unknown): err is TeamApiError;
/** True when `err` is a `TeamApiError` with this code. */
export declare function hasErrorCode(err: unknown, code: string): err is TeamApiError;
/** The answer to an edit that carried a stale `version`: 409 `edit_conflict`. */
export declare const isEditConflict: (err: unknown) => err is TeamApiError;
/** The error of a response that is not 2xx: reads `{ code, message, ...details }` and falls back to `http_<status>`. */
export declare function errorFromResponse(res: Response): Promise<TeamApiError>;
