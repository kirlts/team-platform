/** POST /inputs: `text`, `files`, `links` and, to send in the name of another member, `as_member_id` (UD-255). */
export function inputForm(input) {
    const form = new FormData();
    form.append('text', input.text);
    for (const file of input.files)
        form.append('files', file, file.name);
    for (const link of input.links)
        form.append('links', link);
    if (input.asMemberId)
        form.append('as_member_id', input.asMemberId);
    return form;
}
/** True when a reply carries files or links, so its submit is multipart; otherwise it goes as JSON. */
export const replyHasMedia = (reply) => !!reply.files?.length || !!reply.links?.length;
/** POST /messages/:id/replies with media: `body`, `kind`, `files`, `links`. */
export function replyForm(reply) {
    const form = new FormData();
    form.append('body', reply.body);
    form.append('kind', reply.kind);
    for (const f of reply.files ?? [])
        form.append('files', f, f.name);
    for (const l of reply.links ?? [])
        form.append('links', l);
    return form;
}
/** POST /messages/:id/attachments: new files and links on a published message, with the `version` that was read (UD-071). */
export function attachmentsForm(version, files, links = []) {
    const form = new FormData();
    form.append('version', String(version));
    for (const f of files)
        form.append('files', f);
    for (const l of links)
        form.append('links', l);
    return form;
}
/** PATCH /settings/project with a `.md` file in the `file` field. */
export function projectFileForm(file) {
    const form = new FormData();
    form.append('file', file, file.name);
    return form;
}
const EXTENSION_KIND = {
    png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', heic: 'image', heif: 'image', avif: 'image',
    mp4: 'video', mov: 'video', webm: 'video', mkv: 'video', m4v: 'video',
    mp3: 'audio', m4a: 'audio', aac: 'audio', wav: 'audio', wave: 'audio', ogg: 'audio', flac: 'audio',
};
/** Kind of a local file: by its declared type and, when the system declares none (a .wav often arrives empty), by its extension. */
export function kindFromMime(mime, name = '') {
    if (mime.startsWith('image/'))
        return 'image';
    if (mime.startsWith('video/'))
        return 'video';
    if (mime.startsWith('audio/'))
        return 'audio';
    if (mime === '' || mime === 'application/octet-stream')
        return EXTENSION_KIND[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'document';
    return 'document';
}
