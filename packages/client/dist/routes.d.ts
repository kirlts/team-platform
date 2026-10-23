type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
/** A contract operation: the HTTP method and the path template (`/api/messages/{id}`), with the contract's own prefix. */
export interface Route {
    readonly method: Uppercase<Method>;
    readonly path: string;
}
/** The contract documents the API under this prefix; the client swaps it for the one configured (`apiPrefix`). */
export declare const CONTRACT_PREFIX = "/api";
export declare const routes: {
    readonly login: Route;
    readonly logout: Route;
    readonly me: Route;
    readonly health: Route;
    readonly inputCreate: Route;
    readonly inputList: Route;
    readonly inputGet: Route;
    readonly inputSaveText: Route;
    readonly inputDelete: Route;
    readonly inputSaveProposal: Route;
    readonly inputPublish: Route;
    readonly inputCancel: Route;
    readonly inputRestore: Route;
    readonly inputReprocess: Route;
    readonly messageList: Route;
    readonly messageSummary: Route;
    readonly messageGet: Route;
    readonly messageDelete: Route;
    readonly messagePatch: Route;
    readonly messageRestore: Route;
    readonly messageDeleteMany: Route;
    readonly messageRestoreMany: Route;
    readonly messageAddAttachments: Route;
    readonly messageClose: Route;
    readonly messageReopen: Route;
    readonly messageTiming: Route;
    readonly messageExecute: Route;
    readonly replyCreate: Route;
    readonly replyEdit: Route;
    readonly replyDelete: Route;
    readonly replyRestore: Route;
    readonly areaList: Route;
    readonly areaCreate: Route;
    readonly areaPatch: Route;
    readonly areaDelete: Route;
    readonly areaRestore: Route;
    readonly templateList: Route;
    readonly templateCreate: Route;
    readonly templatePatch: Route;
    readonly templateDelete: Route;
    readonly templateRestore: Route;
    readonly memberList: Route;
    readonly memberCreate: Route;
    readonly memberPatchSelf: Route;
    readonly memberPatch: Route;
    readonly memberDelete: Route;
    readonly providerList: Route;
    readonly providerSave: Route;
    readonly providerCheck: Route;
    readonly projectGet: Route;
    readonly projectPatch: Route;
    readonly publicationGet: Route;
    readonly publicationPatch: Route;
    readonly analysisGet: Route;
    readonly analysisPatch: Route;
    readonly telemetryPatch: Route;
    readonly connectionList: Route;
    readonly connectionAdd: Route;
    readonly connectionReplaceKey: Route;
    readonly connectionRetireKey: Route;
    readonly connectionDelete: Route;
    readonly connectionCheck: Route;
    readonly attachmentFile: Route;
    readonly attachmentTranscript: Route;
    readonly replyAttachmentFile: Route;
    readonly jobList: Route;
    readonly jobPurge: Route;
    readonly jobTrace: Route;
    readonly opsReset: Route;
    readonly opsSeed: Route;
    readonly auditList: Route;
    readonly telemetrySendUi: Route;
    readonly telemetryUiSummary: Route;
    readonly events: Route;
};
/**
 * Operations of the contract that an interface does not call, with the reason. `test/routes.test.ts` demands that every
 * operation is in `routes` or here, so a new route of the server cannot go unnoticed by the client.
 */
export declare const NOT_IN_CLIENT: Readonly<Record<string, string>>;
export declare const operationKey: (r: Route) => string;
/** The relative path (`/messages/ab12`) of a route with its `{params}` filled and encoded; relative to the API prefix. */
export declare function pathOf(r: Route, params?: Readonly<Record<string, string | number>>): string;
export {};
