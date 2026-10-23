import type { RequestErrorCode } from './generated/error-codes.js'

/** Codes the client itself raises, never the server: there was no answer to read one from. */
export const CLIENT_ERROR_CODES = {
  /** The request did not reach the server (status 0). */
  network: 'network',
  /** The caller aborted an upload (status 0). */
  cancelled: 'cancelled',
  /** The server answered 2xx with a body that is not JSON. */
  invalidResponse: 'invalid_response',
} as const

export type ClientErrorCode = (typeof CLIENT_ERROR_CODES)[keyof typeof CLIENT_ERROR_CODES]

/** What `code` can be: a code of the server, one of the client, or `http_<status>` when the body carried none. */
export type TeamErrorCode = RequestErrorCode | ClientErrorCode | `http_${number}`

/** The code of the optimistic-concurrency refusal: another edit got in first (UD-071, UD-253). */
export const EDIT_CONFLICT = 'edit_conflict'

/**
 * API error: `{ code, message }` with the stable code a client translates to its own catalog; `message` is the server's
 * Spanish sentence and is meant to be shown only if the code has no translation. `status` 0 is a failure before an answer.
 */
export class TeamApiError extends Error {
  readonly status: number
  readonly code: string
  /** The other fields of the body (`cause`, `used_by`, `duration_ms`…), for the codes that carry data. */
  readonly details: Record<string, unknown>
  constructor(status: number, message: string, code = '', details: Record<string, unknown> = {}) {
    super(message)
    this.name = 'TeamApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

/** True for a `TeamApiError`, also across two copies of the package (it is checked by name, not by class identity). */
export function isTeamApiError(err: unknown): err is TeamApiError {
  return err instanceof TeamApiError || (err instanceof Error && err.name === 'TeamApiError' && typeof (err as { code?: unknown }).code === 'string')
}

/** True when `err` is a `TeamApiError` with this code. */
export function hasErrorCode(err: unknown, code: string): err is TeamApiError {
  return isTeamApiError(err) && err.code === code
}

/** The answer to an edit that carried a stale `version`: 409 `edit_conflict`. */
export const isEditConflict = (err: unknown): err is TeamApiError => hasErrorCode(err, EDIT_CONFLICT)

/** The error of a response that is not 2xx: reads `{ code, message, ...details }` and falls back to `http_<status>`. */
export async function errorFromResponse(res: Response): Promise<TeamApiError> {
  let message = ''
  let code = ''
  let details: Record<string, unknown> = {}
  try {
    const data = await res.json()
    if (data && typeof data === 'object') {
      const { code: c, message: m, ...rest } = data as Record<string, unknown>
      if (typeof c === 'string') code = c
      details = rest
      if (typeof m === 'string') message = m
      else if (typeof rest.error === 'string') message = rest.error
    }
  } catch {
    // Empty or non-JSON body: only the HTTP status remains.
  }
  return new TeamApiError(res.status, message, code || `http_${res.status}`, details)
}
