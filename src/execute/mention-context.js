// What an agent receives when a person mentions it in a reply (UD-278, MASTER-SPEC §7.5 «Menciones»): the WHOLE thread, in order and with who wrote each
// reply and when, and the attachments of the message and of every reply. The images are copied as files the session can open; a document goes with its name
// and, when the platform extracted its text (the files of the message, never the ones of a reply, which are only stored), with that text next to it.
// The platform reads none of it to decide anything: the session is told who called it and which reply, and the model decides what to do (`mode`).
//
// Two steps, because the prompt is built before the job directory exists: `planThread` reads the database and returns the text with the final path of each file
// (`$TEAM_THREAD_DIR/...`); `stageThread` copies the files into `{workdir}/thread` once the directory is there. A machine receives that directory with the rest of
// `{workdir}` and `run.sh` points `TEAM_THREAD_DIR` at its own copy. Nothing here has a cap of its own: every file already passed the cap of its upload.

import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { all, get } from '../db/index.js'
import { iso } from '../db/util.js'
import { blobPath } from '../domain/storage.js'

/** The directory of a job where the files of the thread are left. */
export const threadDir = (workdir) => join(workdir, 'thread')

/** The environment the session reads to know where the files of the thread are. */
export const threadEnv = (workdir) => ({ TEAM_THREAD_DIR: threadDir(workdir) })

const fileName = (name, fallback) => String(name ?? '').replace(/[\\/\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim() || fallback

/**
 * The mention a job carries (`payload.mention`: `{ reply_id, by, earlier? }`), as the session needs it, or `null` when the reply is gone (deleted, or not in this
 * message) and the job runs as any other. `by` is the name of whoever wrote it.
 */
export function loadMention (db, mention, { messageId }) {
  if (!mention?.reply_id) return null
  const reply = get(db, `SELECT r.id, r.created_at, m.name AS by_name FROM replies r JOIN members m ON m.id = r.author_id
                          WHERE r.id = ? AND r.message_id = ? AND r.deleted_at IS NULL`, mention.reply_id, messageId)
  if (!reply) return null
  const earlier = (mention.earlier ?? []).filter((id) => get(db, 'SELECT 1 AS ok FROM replies WHERE id = ? AND message_id = ? AND deleted_at IS NULL', id, messageId))
  return { replyId: reply.id, by: reply.by_name, at: iso(reply.created_at), earlier }
}

/**
 * The thread as text, and the files that go with it: `{ text, files }`, each file `{ sha256, rel, text }` (`rel` under the thread directory; `text` is the
 * extracted text that goes in a sidecar `<rel>.txt`, or null). `marked`: the ids of the replies that mention the agent; they are flagged in the text.
 */
export function planThread (db, { messageId, marked = [] }) {
  const message = get(db, `SELECT m.id, m.title, m.body, m.created_at, p.name AS author FROM messages m JOIN members p ON p.id = m.author_id WHERE m.id = ?`, messageId)
  const files = []
  const taken = new Set()
  const place = (dir, name, row, text) => {
    let rel = `${dir}/${fileName(name, `file-${row.id}`)}`
    for (let n = 2; taken.has(rel); n++) rel = `${dir}/${n}-${fileName(name, `file-${row.id}`)}`
    taken.add(rel)
    files.push({ sha256: row.sha256, rel, text })
    return rel
  }
  const describe = (list, dir, extractedOf) => list.map((a) => {
    if (a.kind === 'link') return `- link: ${a.path}`
    const rel = place(dir, a.name, a, extractedOf(a))
    const bits = [a.kind, a.mime, `${a.size} bytes`].filter(Boolean).join(', ')
    const text = extractedOf(a) ? `; extracted text: $TEAM_THREAD_DIR/${rel}.txt` : ''
    return `- ${fileName(a.name, 'file')} (${bits}): $TEAM_THREAD_DIR/${rel}${text}`
  })
  const messageFiles = all(db, `SELECT a.id, a.kind, a.name, a.path, a.mime, a.size, a.sha256, a.extracted_text FROM message_attachments ma JOIN attachments a ON a.id = ma.attachment_id
                                 WHERE ma.message_id = ? ORDER BY ma.position, a.id`, messageId)
  const out = [`## Message ${message.id}: ${message.title}`, `by ${message.author}, ${iso(message.created_at)}`, '', message.body.trim() || '(empty)']
  if (messageFiles.length) out.push('', 'attachments of the message:', ...describe(messageFiles, 'message', (a) => (a.extracted_text && a.extracted_text.trim() ? a.extracted_text : null)))
  const replies = all(db, `SELECT r.id, r.kind, r.body, r.created_at, r.forwarded_to, p.name AS author, p.kind AS author_kind, t.name AS forwarded_name
                             FROM replies r JOIN members p ON p.id = r.author_id LEFT JOIN members t ON t.id = r.forwarded_to
                            WHERE r.message_id = ? AND r.deleted_at IS NULL ORDER BY r.id`, messageId)
  const replyFiles = new Map()
  for (const f of all(db, `SELECT ra.id, ra.reply_id, ra.kind, ra.name, ra.path, ra.mime, ra.size, ra.sha256, ra.extracted_text FROM reply_attachments ra
                            WHERE ra.reply_id IN (${replies.map(() => '?').join(',') || 'NULL'}) ORDER BY ra.reply_id, ra.position, ra.id`, ...replies.map((r) => r.id))) {
    if (!replyFiles.has(f.reply_id)) replyFiles.set(f.reply_id, [])
    replyFiles.get(f.reply_id).push(f)
  }
  replies.forEach((r, i) => {
    const what = r.kind === 'forward' ? `forwarded the message to ${r.forwarded_name}, reason` : r.kind === 'answer' ? 'replied' : r.kind
    out.push('', `## Reply ${i + 1} (id ${r.id}): ${r.author} (${r.author_kind}) ${what}, ${iso(r.created_at)}${marked.includes(r.id) ? '  <- THIS REPLY MENTIONS YOU' : ''}`, '', r.body.trim() || '(no text)')
    const list = replyFiles.get(r.id) ?? []
    if (list.length) out.push('', 'attachments of this reply:', ...describe(list, `reply-${r.id}`, () => null))
    // UD-279: what was said in the audio or video of this reply, as text (a reply is read by the extractor only for its speech).
    for (const a of list.filter((x) => x.extracted_text && x.extracted_text.trim())) out.push('', `transcript of ${fileName(a.name, 'file')}:`, a.extracted_text.trim())
  })
  return { text: out.join('\n'), files }
}

/** Copies the files of the plan into `{workdir}/thread` (and the sidecars with the extracted text). Returns how many files were left. */
export async function stageThread ({ config, plan, workdir }) {
  let n = 0
  for (const f of plan.files) {
    const target = join(threadDir(workdir), f.rel)
    await mkdir(dirname(target), { recursive: true })
    await copyFile(blobPath(config, f.sha256), target)
    if (f.text) await writeFile(`${target}.txt`, f.text)
    n++
  }
  return n
}

/** The `mentioned` block of the prompt: who called, which reply, what is expected, and the thread. */
export function mentionBlock (mention, plan, review = null) {
  const lines = [
    `mentioned by: ${mention.by}`,
    `reply: ${mention.replyId} (${mention.at})${mention.earlier.length ? `; earlier replies that also mention you and were not attended yet: ${mention.earlier.join(', ')}` : ''}`,
    '',
    'A teammate called you into this thread with the reply marked below. The thread follows complete, in order, with its attachments; read all of it before you act, not only that reply.',
    '- Do what that reply asks, or answer what it asks. You decide which one it is and say it in `mode` of your final output (`resolve` to carry out a change, `investigate` to answer, explain or recommend without changing anything). The system never reads the words; it reads `mode`.',
    '- You always answer in this thread. Your first reply (`team reply`) or your final `summary` is that answer; with more to say you may send the first one early and the rest at the end. `summary` is addressed to the person named in `mentioned by`.',
    '- Do not set `close` in this run: a mention is a request inside a conversation, and the people in it decide when it ends.',
    '- The files of the thread are in `$TEAM_THREAD_DIR`: open the images and the documents with your file tools. A link is listed with its address.',
    ...(review ? reviewLines(review) : []),
    '',
    plan.text
  ]
  return lines.join('\n')
}

/**
 * UD-280: the message has a change that waits for review (a held delivery). The person answers in the thread, in their own words, and the model says in `review`
 * what they asked for; the system carries it out. `review` here: `{ branch, reason, byIsEditor, editors }`, all of it facts the system knows.
 */
function reviewLines (review) {
  return [
    '',
    'REVIEW PENDING: this message has a change that is not in production yet and waits for a person.',
    `- branch: ${review.branch}; why it was held: ${review.reason || '(no reason given)'}. The summary, the screenshots labeled «Propuesta» and the walkthrough video you left are in the thread below.`,
    `- the person who mentioned you ${review.byIsEditor ? 'is an Editor: they can approve and discard' : `is NOT an Editor, so they cannot approve or discard (Editors: ${review.editors.join(', ') || 'none'})`}.`,
    '- Read what the person wrote as their answer to that review, and say in `review` of your final output what they asked, whatever the words:',
    '  `approve`: they want it delivered to production as it is. Change nothing; the system delivers it, only if they are an Editor.',
    '  `discard`: they want it dropped. Change nothing and write `review_reason`: the reason they gave, in one line.',
    '  `iterate`: they want something changed, or something else done on the same branch. Work on the branch `' + review.branch + '` as in any run: when you finish, leave the review material again (a summary, screenshots with the «Propuesta» label and the walkthrough video by steps).',
    '  `none`: they ask a question, ask for another view, or say something that settles nothing. Answer it, change nothing, deliver nothing; the review stays as it is.',
    '- With `approve`, `discard` or `none` you change no code and push nothing. Your `summary` is one or two short sentences for that person about what you understood and what comes next. Do not claim the delivery happened: the system posts that when it ends.'
  ]
}
