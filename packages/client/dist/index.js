// @team-platform/client: everything an interface needs to use Team Platform through its API (UD-010), without React.
// The hooks of TanStack Query are in `@team-platform/client/react`.
export { createTeamClient } from './client.js';
export { createTransport, normalizePrefix, REQUEST_HEADER } from './http.js';
export { CLIENT_ERROR_CODES, EDIT_CONFLICT, errorFromResponse, hasErrorCode, isEditConflict, isTeamApiError, TeamApiError } from './errors.js';
export { REQUEST_ERROR_CODES } from './generated/error-codes.js';
export { CONTRACT_PREFIX, NOT_IN_CLIENT, operationKey, pathOf, routes } from './routes.js';
export { queryKeys } from './keys.js';
export { INVALIDATE, invalidate, invalidateRoots } from './invalidations.js';
export { createQueries, IN_FLIGHT_REFETCH_MS, IN_FLIGHT_STATUSES } from './queries.js';
export { mergeSavedInputText, mergeSavedMessage, mergeSavedThread } from './cache.js';
export { sendVersioned } from './versioning.js';
export { attachmentsForm, inputForm, kindFromMime, projectFileForm, replyForm, replyHasMedia } from './multipart.js';
export { uploadInput } from './upload.js';
export { unwrapList } from './lists.js';
export { createUndoCore, deletion, edit } from './undo.js';
export { connectEvents, EVENT_NAMES, EventsStore, REOPEN_DELAYS_MS } from './events.js';
export { watchEvents } from './watch.js';
export { canSignOut } from './session.js';
export { TRAY_STATUSES } from './resources.js';
export * from './filters.js';
export * from './types.js';
