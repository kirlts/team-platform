// The operations of the contract the client calls. Each entry names a method and a path of `openapi.json`
// (`GET /api/openapi.json`); the types of `generated/schema.ts` make a path or a method the contract does not
// have a compile error, and `test/routes.test.ts` fails when an operation of the contract is neither here nor in `NOT_IN_CLIENT`.
import type { paths } from './generated/schema.js'

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete'
type MethodsOf<P extends keyof paths> = { [M in Method]: [NonNullable<paths[P][M]>] extends [never] ? never : M }[Method]

/** A contract operation: the HTTP method and the path template (`/api/messages/{id}`), with the contract's own prefix. */
export interface Route {
  readonly method: Uppercase<Method>
  readonly path: string
}

function route<P extends keyof paths & string>(method: MethodsOf<P>, path: P): Route {
  return { method: method.toUpperCase() as Uppercase<Method>, path }
}

/** The contract documents the API under this prefix; the client swaps it for the one configured (`apiPrefix`). */
export const CONTRACT_PREFIX = '/api'

export const routes = {
  login: route('post', '/api/auth/login'),
  logout: route('post', '/api/auth/logout'),
  me: route('get', '/api/me'),
  health: route('get', '/api/health'),

  inputCreate: route('post', '/api/inputs'),
  inputList: route('get', '/api/inputs'),
  inputGet: route('get', '/api/inputs/{id}'),
  inputSaveText: route('patch', '/api/inputs/{id}'),
  inputDelete: route('delete', '/api/inputs/{id}'),
  inputSaveProposal: route('patch', '/api/inputs/{id}/proposal'),
  inputPublish: route('post', '/api/inputs/{id}/publish'),
  inputCancel: route('post', '/api/inputs/{id}/cancel'),
  inputRestore: route('post', '/api/inputs/{id}/restore'),
  inputReprocess: route('post', '/api/inputs/{id}/reprocess'),

  messageList: route('get', '/api/messages'),
  messageSummary: route('get', '/api/messages/summary'),
  messageGet: route('get', '/api/messages/{id}'),
  messageDelete: route('delete', '/api/messages/{id}'),
  messagePatch: route('patch', '/api/messages/{id}'),
  messageRestore: route('post', '/api/messages/{id}/restore'),
  messageDeleteMany: route('post', '/api/messages/delete'),
  messageRestoreMany: route('post', '/api/messages/restore'),
  messageAddAttachments: route('post', '/api/messages/{id}/attachments'),
  messageClose: route('post', '/api/messages/{id}/close'),
  messageReopen: route('post', '/api/messages/{id}/reopen'),
  messageAssessment: route('put', '/api/messages/{id}/assessment'),
  messageTiming: route('get', '/api/messages/{id}/timing'),
  messageExecute: route('post', '/api/messages/{id}/execute'),
  messageDeliver: route('post', '/api/messages/{id}/deliver'),
  messageDiscardDelivery: route('post', '/api/messages/{id}/discard-delivery'),
  messageForward: route('post', '/api/messages/{id}/forward'),
  replyRetry: route('post', '/api/messages/{id}/replies/{replyId}/retry'),

  replyCreate: route('post', '/api/messages/{id}/replies'),
  replyEdit: route('patch', '/api/messages/{id}/replies/{replyId}'),
  replyAddAttachments: route('post', '/api/messages/{id}/replies/{replyId}/attachments'),
  replyDelete: route('delete', '/api/messages/{id}/replies/{replyId}'),
  replyRestore: route('post', '/api/replies/{id}/restore'),

  areaList: route('get', '/api/areas'),
  areaCreate: route('post', '/api/areas'),
  areaPatch: route('patch', '/api/areas/{id}'),
  areaDelete: route('delete', '/api/areas/{id}'),
  areaRestore: route('post', '/api/areas/{id}/restore'),

  templateList: route('get', '/api/areas/{id}/templates'),
  templateCreate: route('post', '/api/areas/{id}/templates'),
  templatePatch: route('patch', '/api/areas/{id}/templates/{templateId}'),
  templateDelete: route('delete', '/api/areas/{id}/templates/{templateId}'),
  templateRestore: route('post', '/api/templates/{id}/restore'),

  memberList: route('get', '/api/members'),
  memberCreate: route('post', '/api/members'),
  memberPatchSelf: route('patch', '/api/members/me'),
  memberPatch: route('patch', '/api/members/{id}'),
  memberDelete: route('delete', '/api/members/{id}'),

  providerList: route('get', '/api/settings/providers'),
  providerSave: route('patch', '/api/settings/providers'),
  providerCheck: route('post', '/api/settings/providers/{slot}/check'),
  projectGet: route('get', '/api/settings/project'),
  projectPatch: route('patch', '/api/settings/project'),
  publicationGet: route('get', '/api/settings/publication'),
  publicationPatch: route('patch', '/api/settings/publication'),
  analysisGet: route('get', '/api/settings/analysis'),
  analysisPatch: route('patch', '/api/settings/analysis'),
  telemetryPatch: route('patch', '/api/settings/telemetry'),

  connectionList: route('get', '/api/settings/connections'),
  connectionAdd: route('post', '/api/settings/connections'),
  connectionReplaceKey: route('put', '/api/settings/connections/{name}/key'),
  connectionRetireKey: route('delete', '/api/settings/connections/{name}/key'),
  connectionDelete: route('delete', '/api/settings/connections/{name}'),
  connectionCheck: route('post', '/api/settings/connections/{name}/check'),

  attachmentFile: route('get', '/api/attachments/{id}'),
  attachmentTranscript: route('get', '/api/attachments/{id}/transcript'),
  replyAttachmentFile: route('get', '/api/replies/attachments/{id}'),
  replyAttachmentTranscript: route('get', '/api/replies/attachments/{id}/transcript'),

  jobList: route('get', '/api/jobs'),
  jobPurge: route('delete', '/api/jobs'),
  jobTrace: route('get', '/api/jobs/{id}/trace'),
  opsReset: route('post', '/api/ops/reset'),
  opsExecuteRuns: route('get', '/api/ops/execute-runs'),
  opsExecuteRunsSummary: route('get', '/api/ops/execute-runs/summary'),
  opsSeed: route('post', '/api/ops/seed'),
  auditList: route('get', '/api/audit'),

  telemetrySendUi: route('post', '/api/telemetry/ui'),
  telemetryUiSummary: route('get', '/api/telemetry/ui-summary'),
  events: route('get', '/api/events'),
} as const satisfies Record<string, Route>

/**
 * Operations of the contract that an interface does not call, with the reason. `test/routes.test.ts` demands that every
 * operation is in `routes` or here, so a new route of the server cannot go unnoticed by the client.
 */
export const NOT_IN_CLIENT: Readonly<Record<string, string>> = {
  'GET /api/host/notices': 'Question of the host site about one of its people, with the host\'s signed token and no session of ours (UD-301); no interface of the team calls it.',
  'POST /api/jobs/{id}/marks': 'Callback of the worker that runs an `execute` job: the time of one part of the work, with that job agent as the only caller.',
  'POST /api/jobs/{id}/mentions/take': 'Callback of the session that runs an `execute` job: takes the mentions written while it works (UD-285), with that job agent as the only caller.',
  'POST /api/jobs/{id}/progress': 'Callback of the worker that runs an `execute` job, with that job agent as the only caller; no interface reports progress.',
}

export const operationKey = (r: Route) => `${r.method} ${r.path}`

/** The relative path (`/messages/ab12`) of a route with its `{params}` filled and encoded; relative to the API prefix. */
export function pathOf(r: Route, params: Readonly<Record<string, string | number>> = {}): string {
  const rest = r.path.startsWith(CONTRACT_PREFIX) ? r.path.slice(CONTRACT_PREFIX.length) : r.path
  return rest.replace(/\{(\w+)\}/g, (_m, name: string) => {
    const value = params[name]
    if (value === undefined) throw new Error(`Route ${operationKey(r)} needs the parameter «${name}»`)
    return encodeURIComponent(String(value))
  })
}
