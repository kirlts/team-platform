// Every operation of the API an interface calls, as a function. Grouped by what they touch; each one builds the request
// the panel always built (same paths, same bodies, same query strings) and returns what the server answers, typed.
import { applyClientFilters, messagesQueryString } from './filters.js';
import { unwrapList } from './lists.js';
import { attachmentsForm, inputForm, projectFileForm, replyForm, replyHasMedia } from './multipart.js';
import { routes } from './routes.js';
import { uploadInput } from './upload.js';
import { sendVersioned } from './versioning.js';
/** Statuses of an input that still needs the person: running, ready to review or failed (UD-025). */
export const TRAY_STATUSES = ['queued', 'extracting', 'analyzing', 'proposed', 'failed'];
const CONFIRM = 'confirm=true';
export function createResources(t) {
    const call = t.call;
    const messageDetail = (id) => call(routes.messageGet, { params: { id } });
    return {
        // ------------------------------------------------------------ Session
        auth: {
            login: (v) => call(routes.login, { body: v }),
            /** Closes the session of our own; the host's own sign-out (`logout_url`, H-3720) comes back when it has one. */
            logout: () => call(routes.logout),
        },
        me: {
            get: () => call(routes.me),
        },
        health: () => call(routes.health),
        // ------------------------------------------------------------ Team
        members: {
            list: async () => unwrapList(await call(routes.memberList)),
            create: (v) => call(routes.memberCreate, { body: v }),
            /** `self` changes the account of the session (`/members/me`); otherwise the member `id` (Editor). */
            save: (v) => v.self ? call(routes.memberPatchSelf, { body: v.patch }) : call(routes.memberPatch, { params: { id: v.id }, body: v.patch }),
            saveLanguage: (language) => call(routes.memberPatchSelf, { body: { language } }),
            /** Another member's password (Editor): it closes that person's sessions. */
            setPassword: (v) => call(routes.memberPatch, { params: { id: v.id }, body: { password: v.password } }),
            /** Deleting for good (Editor, UD-240). `purge` takes their history too; without it a member with history is a 409 `member_has_history`. */
            delete: (v) => call(routes.memberDelete, { params: { id: v.id }, search: `${CONFIRM}${v.purge ? '&purge=true' : ''}` }),
        },
        // ------------------------------------------------------------ Areas and templates
        areas: {
            /** Sorted by `position`. */
            list: async () => {
                const list = unwrapList(await call(routes.areaList));
                return [...list].sort((a, b) => a.position - b.position);
            },
            /** The deleted ones (Editor). */
            listDeleted: async () => unwrapList(await call(routes.areaList, { search: 'include_deleted=true' })).filter((a) => a.deleted_at),
            /** Creates the area, or edits `id` when it is given. */
            save: (v) => v.id
                ? call(routes.areaPatch, { params: { id: v.id }, body: { title: v.title, description: v.description, color: v.color } })
                : call(routes.areaCreate, { body: { title: v.title, description: v.description, color: v.color } }),
            /** Soft-deletes (Editor, UD-240): its messages stay and a restore brings it back. */
            delete: (id) => call(routes.areaDelete, { params: { id }, search: CONFIRM }),
            restore: (id) => call(routes.areaRestore, { params: { id } }),
            /** One DELETE each, in parallel: an Editor may delete every area, so there is no permission to split. */
            deleteMany: (ids) => Promise.all(ids.map((id) => call(routes.areaDelete, { params: { id }, search: CONFIRM }))),
            restoreMany: (ids) => Promise.all(ids.map((id) => call(routes.areaRestore, { params: { id } }))),
        },
        templates: {
            list: async (areaId) => unwrapList(await call(routes.templateList, { params: { id: areaId } })),
            listDeleted: async (areaId) => unwrapList(await call(routes.templateList, { params: { id: areaId }, search: 'include_deleted=true' })).filter((x) => x.deleted_at),
            /** Creates the template, or edits `id` when it is given. */
            save: (areaId, v) => {
                const { id, ...fields } = v;
                return id
                    ? call(routes.templatePatch, { params: { id: areaId, templateId: id }, body: fields })
                    : call(routes.templateCreate, { params: { id: areaId }, body: fields });
            },
            /** Every destructive operation requires explicit confirmation (MASTER-SPEC, API conventions). */
            delete: (areaId, id) => call(routes.templateDelete, { params: { id: areaId, templateId: id }, search: CONFIRM }),
            restore: (id) => call(routes.templateRestore, { params: { id } }),
            deleteMany: (areaId, ids) => Promise.all(ids.map((id) => call(routes.templateDelete, { params: { id: areaId, templateId: id }, search: CONFIRM }))),
            restoreMany: (ids) => Promise.all(ids.map((id) => call(routes.templateRestore, { params: { id } }))),
        },
        // ------------------------------------------------------------ Messages
        messages: {
            /** Server filters plus the negations and «sin respuestas» that the server does not know, applied here. */
            list: async ({ query, meId, repliesFeed }) => {
                const qs = messagesQueryString(query, repliesFeed);
                const list = unwrapList(await call(routes.messageList, { search: qs }));
                return applyClientFilters(list, query, meId);
            },
            /** What affects the person and the pending of each area. */
            summary: () => call(routes.messageSummary),
            get: messageDetail,
            /**
             * Edits a published message (UD-071). The request carries the `version` that was read; on 409 `edit_conflict` the message is
             * read again and the same change goes once more (see `sendVersioned`). Returns the saved message.
             */
            patch: (id, patch, versioning = {}) => sendVersioned({
                ...versioning,
                fetchCurrent: () => messageDetail(id),
                versionOf: (d) => d?.version,
                send: (version) => call(routes.messagePatch, { params: { id }, body: { ...patch, version } }),
            }),
            /** New files and links on a published message (UD-071): they go at the end and count as an edit, with the version that was read. */
            addAttachments: (id, v, versioning = {}) => sendVersioned({
                ...versioning,
                fetchCurrent: () => messageDetail(id),
                versionOf: (d) => d?.version,
                send: (version) => call(routes.messageAddAttachments, { params: { id }, form: attachmentsForm(version, v.files, v.links) }),
            }),
            close: (id) => call(routes.messageClose, { params: { id } }),
            reopen: (id) => call(routes.messageReopen, { params: { id } }),
            setClosed: (v) => call(v.closed ? routes.messageClose : routes.messageReopen, { params: { id: v.id } }),
            /** Soft-deletes (UD-240): its sender or the Editor; a restore undoes it. */
            delete: (id) => call(routes.messageDelete, { params: { id }, search: CONFIRM }),
            restore: (id) => call(routes.messageRestore, { params: { id } }),
            /** Several in one request: all or none, 403 with the ids that are not the person's (UD-253, H-3715). */
            deleteMany: (ids) => call(routes.messageDeleteMany, { search: CONFIRM, body: { ids } }),
            restoreMany: (ids) => call(routes.messageRestoreMany, { body: { ids } }),
            /** Where the time of the execution of a message went. A 404 means it has no execution. */
            timing: (id) => call(routes.messageTiming, { params: { id } }),
            /** Queues the `execute` job of a message (Editor). */
            execute: (id) => call(routes.messageExecute, { params: { id } }),
        },
        replies: {
            /** JSON, or multipart when there are files or links. */
            create: (messageId, reply) => replyHasMedia(reply)
                ? call(routes.replyCreate, { params: { id: messageId }, form: replyForm(reply) })
                : call(routes.replyCreate, { params: { id: messageId }, body: { body: reply.body, kind: reply.kind } }),
            /**
             * Edits the text of a reply, only by its author (UD-253, H-3714). It sends the version read in the thread; on `edit_conflict`
             * it reads the thread again and retries once with the current version. Returns the message with its thread.
             */
            edit: (messageId, replyId, body, versioning = {}) => sendVersioned({
                ...versioning,
                fetchCurrent: () => messageDetail(messageId),
                versionOf: (d) => d?.replies.find((r) => r.id === replyId)?.version,
                send: (version) => call(routes.replyEdit, { params: { id: messageId, replyId }, body: { body, version } }),
            }),
            /** Soft-deletes (UD-240): its author or the Editor. Returns the message with its thread. */
            delete: (messageId, replyId) => call(routes.replyDelete, { params: { id: messageId, replyId }, search: CONFIRM }),
            restore: (replyId) => call(routes.replyRestore, { params: { id: replyId } }),
        },
        // ------------------------------------------------------------ Inputs (sends)
        inputs: {
            get: (id) => call(routes.inputGet, { params: { id } }),
            /** My inputs in the tray: oldest first, so the ones that arrived first are reviewed first. */
            tray: async () => {
                const list = unwrapList(await call(routes.inputList, { search: `mine=1&status=${TRAY_STATUSES.join(',')}` }));
                return [...list].sort((a, b) => a.created_at.localeCompare(b.created_at));
            },
            /** Every send of mine, newest first, whatever its state (UD-070); the ones I discarded are not part of it. */
            history: async () => unwrapList(await call(routes.inputList, { search: 'mine=1&order=desc' })).filter((i) => i.status !== 'cancelled'),
            /** The sends of everybody (Editor), newest first, one server page. */
            queue: (page, limit) => call(routes.inputList, { search: `all=1&page=${page}&limit=${limit}` }),
            /** Sends the input as multipart without progress (a server, a script). Idempotent by content hash (MASTER-SPEC §1.3). */
            create: (input, signal) => call(routes.inputCreate, { form: inputForm(input), signal }),
            /** Sends the input with upload progress (XMLHttpRequest, so it needs a browser or an `xhr` factory). */
            upload: (input, onProgress, signal) => uploadInput(t, input, onProgress, signal),
            publish: (inputId, proposal) => call(routes.inputPublish, { params: { id: inputId }, body: proposal }),
            /** Saves the proposal draft: what was edited survives closing the tab. */
            saveProposal: (inputId, proposal) => call(routes.inputSaveProposal, { params: { id: inputId }, body: proposal }),
            /** Changes the text of the submitted input. */
            saveText: (inputId, text) => call(routes.inputSaveText, { params: { id: inputId }, body: { text } }),
            /** Requeues the analysis; keeps the text and the extractions. Published: the Editor only, its messages go to the trash. */
            reprocess: (inputId) => call(routes.inputReprocess, { params: { id: inputId } }),
            /** Undoes a discard: the send comes back with the proposal and the edits it had. */
            restore: (inputId) => call(routes.inputRestore, { params: { id: inputId } }),
            /** Deletes for real (UD-240): attachments, jobs and proposal; with `withMessages`, the messages it published too. */
            delete: (v) => call(routes.inputDelete, { params: { id: v.id }, search: `${CONFIRM}${v.withMessages ? '&with_messages=true' : ''}` }),
            cancel: (inputId) => call(routes.inputCancel, { params: { id: inputId } }),
        },
        // ------------------------------------------------------------ Providers
        providers: {
            list: async () => unwrapList(await call(routes.providerList)),
            /** The server tests the combination before it applies it: a failure (422 `provider_check_failed`) leaves the previous setting. */
            save: (v) => {
                const body = { slot: v.slot };
                if (v.provider !== undefined)
                    body.provider = v.provider;
                if (v.model !== undefined)
                    body.model = v.model;
                if (v.base_url !== undefined)
                    body.base_url = v.base_url;
                return call(routes.providerSave, { body });
            },
            /** Diagnosis of one function: the provider and the model it uses now. */
            check: (slot) => call(routes.providerCheck, { params: { slot }, body: {} }),
        },
        connections: {
            /** Providers with the state of their keys, and the presets that can be added (Editor). */
            list: () => call(routes.connectionList),
            /** Adds a provider with its key; the server tests first and saves nothing when the test fails. */
            add: (v) => call(routes.connectionAdd, { body: v }),
            /** Replaces a key: tested first, applied only if it works; otherwise the previous key stays. */
            replaceKey: (v) => call(routes.connectionReplaceKey, { params: { name: v.name }, body: { api_key: v.api_key, ...(v.model ? { model: v.model } : {}) } }),
            retireKey: (name) => call(routes.connectionRetireKey, { params: { name } }),
            delete: (name) => call(routes.connectionDelete, { params: { name } }),
            /** Diagnosis of one provider (always answers 200; the body says whether it worked). */
            check: async (v) => {
                const r = await call(routes.connectionCheck, { params: { name: v.name }, body: v.model ? { model: v.model } : {} });
                return { ...r, name: v.name };
            },
        },
        // ------------------------------------------------------------ Settings
        project: {
            get: () => call(routes.projectGet),
            /** Changes the description with text (in-place edit) or with a `.md` file (multipart `file`). */
            save: (v) => 'file' in v ? call(routes.projectPatch, { form: projectFileForm(v.file) }) : call(routes.projectPatch, { body: { description: v.description } }),
            /** Saves the project name (empty goes back to PROJECT_NAME). */
            saveName: (name) => call(routes.projectPatch, { body: { name } }),
        },
        analysis: {
            get: () => call(routes.analysisGet),
            /** Saves the framing of one or both languages; an empty text goes back to the default. */
            saveFraming: (framing) => call(routes.analysisPatch, { body: { framing } }),
        },
        publication: {
            get: () => call(routes.publicationGet),
            save: (autoPublish) => call(routes.publicationPatch, { body: { auto_publish: autoPublish } }),
        },
        telemetry: {
            /** Turns interface telemetry on or off (Editor). */
            setUiEnabled: (enabled) => call(routes.telemetryPatch, { body: { ui_enabled: enabled } }),
            /** Summary of how the interface is used (Editor). */
            uiSummary: () => call(routes.telemetryUiSummary),
            /** Sends a batch of interface events, as an object or as the JSON text already built. `keepalive` lets it outlive the page. */
            sendUi: (batch, options = {}) => call(routes.telemetrySendUi, typeof batch === 'string' ? { json: batch, keepalive: options.keepalive } : { body: batch, keepalive: options.keepalive }),
        },
        // ------------------------------------------------------------ Operations (Editor)
        jobs: {
            list: (state, options = {}) => call(routes.jobList, { search: `state=${state}${options.page ? `&page=${options.page}` : ''}&limit=${options.limit ?? 1}` }),
            /** The `execute` jobs that are running now, with their phase. */
            runningExecutions: async () => (await call(routes.jobList, { search: 'state=running&limit=50' })).items.filter((j) => j.kind === 'execute'),
            trace: (jobId) => call(routes.jobTrace, { params: { id: jobId } }),
            purge: (state) => call(routes.jobPurge, { search: `state=${state}&${CONFIRM}` }),
        },
        audit: {
            list: (page, limit, action = '') => call(routes.auditList, { search: `page=${page}&limit=${limit}${action ? `&action=${encodeURIComponent(action)}` : ''}` }),
        },
        ops: {
            /** Loads the sample set of `ejemplos/`: the inputs enter the tray and go through the real analysis. */
            seed: () => call(routes.opsSeed, { search: CONFIRM }),
            reset: (scope) => call(routes.opsReset, { search: CONFIRM, body: { scope } }),
        },
        attachments: {
            /** The text the server extracted from an audio or a video (`GET /attachments/:id/transcript`). */
            transcript: (id) => call(routes.attachmentTranscript, { params: { id } }),
        },
    };
}
