// How an answer is written into what the cache already holds. Pure: the cache itself (`setQueryData`) is the caller's.
import type { InputRecord, MessageDetail } from './types.js'

/** The saved message over the one in the cache; the thread stays when the answer does not carry it. */
export function mergeSavedMessage(old: MessageDetail | undefined, saved: MessageDetail): MessageDetail {
  return old ? { ...old, ...saved, replies: saved.replies ?? old.replies } : saved
}

/** The message with its thread as the server returned it after a reply edit, over the cached one. */
export function mergeSavedThread(old: MessageDetail | undefined, saved: MessageDetail): MessageDetail {
  return old ? { ...old, ...saved } : saved
}

/** The text of the input as the server saved it; nothing is invented when the input is not in the cache. */
export function mergeSavedInputText(old: InputRecord | undefined, saved: InputRecord): InputRecord | undefined {
  return old ? { ...old, text: saved.text ?? old.text } : old
}
