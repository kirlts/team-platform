import type { NewInput, NewReply } from './types.js';
/** POST /inputs: `text`, `files`, `links` and, to send in the name of another member, `as_member_id` (UD-255). */
export declare function inputForm(input: NewInput): FormData;
/** True when a reply carries files or links, so its submit is multipart; otherwise it goes as JSON. */
export declare const replyHasMedia: (reply: Pick<NewReply, "files" | "links">) => boolean;
/** POST /messages/:id/replies with media: `body`, `kind`, `files`, `links`. */
export declare function replyForm(reply: NewReply): FormData;
/** POST /messages/:id/attachments: new files and links on a published message, with the `version` that was read (UD-071). */
export declare function attachmentsForm(version: number | undefined, files: readonly File[], links?: readonly string[]): FormData;
/** PATCH /settings/project with a `.md` file in the `file` field. */
export declare function projectFileForm(file: File): FormData;
/** Kind of a local file: by its declared type and, when the system declares none (a .wav often arrives empty), by its extension. */
export declare function kindFromMime(mime: string, name?: string): 'image' | 'video' | 'audio' | 'document';
