/** The saved message over the one in the cache; the thread stays when the answer does not carry it. */
export function mergeSavedMessage(old, saved) {
    return old ? { ...old, ...saved, replies: saved.replies ?? old.replies } : saved;
}
/** The message with its thread as the server returned it after a reply edit, over the cached one. */
export function mergeSavedThread(old, saved) {
    return old ? { ...old, ...saved } : saved;
}
/** The text of the input as the server saved it; nothing is invented when the input is not in the cache. */
export function mergeSavedInputText(old, saved) {
    return old ? { ...old, text: saved.text ?? old.text } : old;
}
