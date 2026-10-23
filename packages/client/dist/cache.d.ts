import type { InputRecord, MessageDetail } from './types.js';
/** The saved message over the one in the cache; the thread stays when the answer does not carry it. */
export declare function mergeSavedMessage(old: MessageDetail | undefined, saved: MessageDetail): MessageDetail;
/** The message with its thread as the server returned it after a reply edit, over the cached one. */
export declare function mergeSavedThread(old: MessageDetail | undefined, saved: MessageDetail): MessageDetail;
/** The text of the input as the server saved it; nothing is invented when the input is not in the cache. */
export declare function mergeSavedInputText(old: InputRecord | undefined, saved: InputRecord): InputRecord | undefined;
