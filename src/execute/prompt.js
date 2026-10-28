// The prompt and the output schema of an `execute` job (UD-254, UD-255, MS §7.5 «Ejecución»). The prompt is code and goes
// in English (RULES 1); the replies the session writes go in the language of the person who sent the message.

import { compileOutputSchema, parseTemplate } from '../analyze/templates.js'
import { helpText } from '../../scripts/team.mjs'
import { decisionCheckSchema } from './decision-check.js'

/** What a forwarded job may do (UD-272): carry the work out, or investigate and recommend without changing anything. */
export const FORWARD_MODES = ['resolve', 'investigate']
export const REVIEW_ACTIONS = ['approve', 'discard', 'iterate', 'none'] // UD-280: what the person asked about a change that waits for review

const LANGUAGE_NAMES = { 'es-419': 'Spanish (Latin America)', en: 'English' }

/**
 * The declared output of the template (A4, `compileOutputSchema`): `{ grammar, validation }`, or nulls without an `output`
 * block. `grammar` goes to `--json-schema`; `validation` (optional fields nullable) checks the `result`.
 */
export function declaredOutput (template) {
  if (!template?.output) return { grammar: null, validation: null }
  return { grammar: compileOutputSchema(template), validation: compileOutputSchema(template, { validation: true }) }
}

/** The parsed template, or the raw row when this build's parser does not read it (e.g. an `output` block it does not know). */
export function readTemplate (row) {
  if (!row?.body_markdown) return null
  try { return { ...parseTemplate(row.body_markdown, { source: `template ${row.id}` }), id: row.id, body_markdown: row.body_markdown } } catch { return { id: row.id, name: row.name, body_markdown: row.body_markdown } }
}

/**
 * The schema the session must satisfy: the template's declared output (A4) plus a required `summary`, the closing reply
 * to the sender. Without a declared output, only `summary`.
 */
export function finalSchema (declared, { validation = false, autoClose = true, forwarded = false, reviewing = false, light = false } = {}) {
  const description = 'Closing reply to the sender, as to a project manager: two short paragraphs, what happened, what changes for those who use the product and the decision left to them, if any. No paths, file names, commands, component names or jargon. Say only what is built and checked: never that something will be published, will be visible soon or that the publication starts (the system posts this text only after production confirmed it, and a promise here can be false). Address the sender the way their profile says; with no instruction, in Spanish use «tú», never «usted».'
  // The grammar of --json-schema keeps A4's plain string; the check after the run also rejects an empty one.
  const summary = { type: 'string', ...(validation ? { minLength: 1 } : {}), description }
  // UD-268: optional screenshots of the interface for the closing reply (the first reply carries its own with `team reply --captures`).
  const captures = {
    type: 'array',
    description: 'Screenshots for the closing reply (the «after» of the first reply\'s «before»). Omit when the interface shows nothing useful. A change that draws a screen also carries the walkthrough video (WebM) from `team walkthrough`, first: the person who reviews a held change expects it (UD-275).',
    items: {
      type: 'object', additionalProperties: false, required: ['path', 'alt', 'masked', 'place', 'as'],
      properties: {
        path: { type: 'string', description: 'File inside $TEAM_CAPTURES_DIR' }, alt: { type: 'string', description: 'One line: what the image shows, quoting the texts and numbers on screen; never the name of a format («24-hour clock»), which reads as a quantity.' },
        masked: { type: 'boolean', description: 'true when the tool hid the personal data' }, place: { type: 'string', description: 'Route or menu of the view' }, as: { type: 'string', description: 'Clinic and role it was seen as' }
      }
    }
  }
  // UD-298: whether the change alters what a person sees on a screen, and why there is no capture when there is none. The system reads the boolean; the reason is the sentence it writes in the reply.
  const screen = {
    touches_screen: { type: 'boolean', description: 'Always declare it (message 136: a new control on a screen closed with no screenshot because the field was left out). true when the change alters what a person sees on a screen (an interface, a text of a screen, an email or message someone reads). Then the output carries at least one screenshot or the walkthrough video in `captures`.' },
    no_capture_reason: { type: 'string', description: 'With `touches_screen` true and no capture or video: one short sentence with why you could not record (the browser did not open, the view needs data that does not exist). The system writes it in the closing reply. Omit when `captures` is not empty.' }
  }
  // UD-271: the session asks to close the message; the system closes only when its own checks pass too (auto-close.js). Both are optional. Without EXECUTE_AUTO_CLOSE the grammar does not offer them, but the validation still accepts them: an output that carries them is not a malformed output.
  const closing = autoClose || validation
    ? {
        close: { type: 'boolean', description: 'true only when the three conditions of «Closing the message» hold; false when in doubt.' },
        close_reason: { type: 'string', description: 'One line in the reply language: why nothing is left for the sender. Required with close true.' }
      }
    : {}
  // UD-295: a session on the light model says, as a parameter, that it cannot close the work: the system reads the field and relaunches the work on the escalation model.
  const escalation = light || validation
    ? { cannot_close: { type: 'boolean', description: 'true when you could not finish the work with what you have: the checks stay red after your own attempts, the change turned out bigger than the message says, or you are guessing. The system then continues on a stronger model, on the same branch. false or omitted when you finished.' } }
    : {}
  // UD-314: whether the work stands unfulfilled because of something outside it (an access, a dependency, an external service). The system reads the boolean, never the words: the reply
  // carries «Reintentar» and the message is not closed. Independent of `outcome`: a change can be pushed and its check in production still be impossible.
  const unmet = {
    unfulfilled: { type: 'boolean', description: 'true when part of what was asked could not be done because of something outside the work: an access or permission you lack, a dependency that is missing, an external service that does not answer. Say what stopped you in `summary`. A person fixes it and retries with one click. false or omitted when everything asked was done. Never true for a decision that is a person\'s (`needs_decision`) or a limit of your own (`cannot_close`).' }
  }
  // UD-272: a message forwarded to the agent. `mode` is what the model understood from the reason (the system reads the field, never the text): `investigate` means
  // no change, no delivery, no close. `attachments` are the documents the reason asked for. Only the grammar of a forwarded job offers them; the validation always accepts them.
  const forwarding = forwarded || validation
    ? {
        mode: { type: 'string', enum: FORWARD_MODES, description: '`resolve` when the sender wants the work carried out; `investigate` when they want to understand or decide first: then no code is changed and nothing is delivered or closed.' },
        approved: { type: 'boolean', description: 'true only when the person who mentioned you already asked, in their own words and in this thread, for the change to be implemented and published (a «yes», «go ahead», «do it all» answering your proposal counts; a request to look at it first does not). The system then delivers what you finish without holding it again. false or omitted otherwise (UD-286).' },
        approved_reply: { type: 'string', description: 'With `approved` true: the id of the reply, or its words in one line, where the person asked for it. Omit otherwise.' },
        attachments: {
          type: 'array',
          description: 'Documents for the closing reply, only when the reason asks for one: PDF files written inside $TEAM_ATTACHMENTS_DIR. Omit otherwise.',
          items: {
            type: 'object', additionalProperties: false, required: ['path', 'name'],
            properties: { path: { type: 'string', description: 'File inside $TEAM_ATTACHMENTS_DIR' }, name: { type: 'string', description: 'Name the sender sees, in the reply language' } }
          }
        }
      }
    : {}
  // UD-280: a mention on a message with a change waiting for review. `review` is what the person asked, read by the system, never the words; `review_reason` is the reason of a discard.
  const review = reviewing || validation
    ? {
        review: { type: 'string', enum: REVIEW_ACTIONS, description: '`approve` when the person wants the change delivered; `discard` when they want it dropped; `iterate` when they want it changed on the same branch; `none` when they ask or say something that leaves the review as it is.' },
        review_reason: { type: 'string', description: 'With `discard`: one line, in the reply language, with the reason the person gave. Omit otherwise.' }
      }
    : {}
  if (!declared || typeof declared !== 'object' || declared.type !== 'object') {
    return { type: 'object', additionalProperties: false, required: ['summary', 'touches_screen'], properties: { summary, captures, ...screen, ...unmet, ...closing, ...forwarding, ...review, ...escalation } }
  }
  // UD-269: `decision_check` is optional in the grammar; the check after the run requires it with `needs_decision` (decision-check.js).
  return {
    ...declared,
    required: [...new Set([...(declared.required ?? []), 'summary', 'touches_screen'])],
    properties: { ...(declared.properties ?? {}), summary, captures, ...screen, ...unmet, ...closing, ...forwarding, ...review, ...escalation, decision_check: decisionCheckSchema({ validation }) }
  }
}

/**
 * The stable part of a direct fix on a light model (UD-295): the same duties in a third of the words. What a hard rule needs is not said here
 * as prose but enforced by hooks the invocation declares (`sessionSettings`): the checks before finishing, the map of the repository at the start.
 * The prompt describes the space the model works in; it does not ask it to remember rules. Tokens of this part, measured: docs/investigaciones/mediciones/.
 */
const COMPACT_TEAM = [
  'team reply <message id> --body "…" [--captures <json|file>]   post a reply as you',
  'team progress <job id> --percent N --phrase "…"                 report a milestone',
  'team show <message id>                                          the message with its thread, as JSON',
  'team walkthrough --url <address> --steps <json|file> --place <route> --as <role> --profile both   video and screenshots of the steps (a change that draws a screen)',
  'team --help                                                     every command'
].join('\n')

function compactStable ({ agent, project, deliver, autoClose, template, hostInstructions, forwardedOrMentioned }) {
  return [
    `You are ${agent.name}, a member of the team of «${project.name}». Unattended: nobody answers during the run. Do what the \`message\` block asks, following the rules of the repository you are in, then report. The \`job\` block has your ids, branch and reply language.`,
    block('project_description', project.description),
    block('your_profile', agent.profile),
    '## Rules',
    `- Branch: the one in \`job\`; never push \`main\`. ${deliver ? 'Push it when done: the system delivers it after you finish.' : 'Leave the branch: a person delivers it.'}`,
    '- Smallest change that does what the message asks. Subagents and parallel tool calls for independent reads; no series of what does not depend on a result.',
    '- Before you finish, the checks of the repository for the files you changed must pass; a hook of this session blocks the end until they do. Write the missing test first.',
    '- First look, changing nothing. Not yours (see `your_profile`): end `not_mine`, no reply. Otherwise one `team reply` in two or three plain sentences for someone who is not technical (what you saw, where you start), after that look.',
    '- Final output: `summary` is two short paragraphs for the sender, in the reply language: what happened, what changes for those who use the product, the decision left to them. Plain words only. The worker posts it. Say only what is built and checked, never that it will be published or seen soon: the worker posts it after production confirmed it. Address the sender the way their profile says (no instruction: «tú», never «usted»). Example: «Listo, Ana: el botón de la ficha ahora dice Aceptar. Revisé que el resto de la pantalla quedó igual.»',
    '- `summary` opens with the result in two or three lines (checked, came out, not checked). Attach a screenshot of the result and, when it can be watched, the `team walkthrough` video; what cannot be shown goes in `no_capture_reason` and the message closes anyway. A second pass after a failed delivery still reports the result of the whole request.',
    '- If something outside the work stops part of what was asked (an access you lack, a missing dependency, an external service down): say it in `summary` and end with `unfulfilled` true, even if the rest is done. Never `unfulfilled` false while saying you could not do it.',
    '- If you cannot finish it (the checks stay red after your own attempts, it is bigger than the message says, you are guessing): end with `cannot_close` true and what you did in `summary`; a stronger model continues on the same branch. A decision that is a person\'s: `needs_decision`, with `decision_check`.',
    autoClose ? '- `close` true only when it is done and checked, your reply leaves the sender nothing to do and `outcome` is `done` or `investigated`; otherwise false, with `close_reason` when true.' : '- Do not close the message.',
    ...(forwardedOrMentioned ? ['- A `forwarded` or `mentioned` block is part of the request. `mode` `investigate` changes no code and delivers nothing; `resolve` carries the work out.'] : []),
    '## `team` (in your PATH, already authenticated)',
    COMPACT_TEAM,
    ...(String(hostInstructions).trim() ? [block('host_instructions', hostInstructions)] : []),
    block('template', template?.body_markdown ?? '(no template)')
  ]
}

const block = (title, text) => `<${title}>\n${String(text ?? '').trim() || '(empty)'}\n</${title}>`

/**
 * Builds the prompt. `message`: { id, title, body, fields, area, status }; `template`: the row with `body_markdown`;
 * `author` and `agent`: { name, profile, language }; `project`: { name, description }. With `deliver` (UD-263) the system delivers the
 * branch after the session, so the session stops at the push; `deliverFailure` ({ output }) is the second pass after that delivery failed.
 *
 * Order (docs/investigaciones/mediciones/2026-10-23-tokens-y-cache.md): everything that is the same from one job to the next comes first, and what changes per job comes last, so that two
 * consecutive sessions of the same agent share the longest possible start of the prompt. First the contract, the project, the
 * profile of the agent, how to work, the replies, the `team` help, the rules of the host and the template; then the sender, the
 * message and the `job` block (ids, branch, reply language), which are the only blocks that vary with the message.
 * The text of the instructions does not mention an id, a branch or a name that changes: it points to the `job` block.
 */
export function buildExecuteParts ({ message, template, author, agent, project, jobId, maxSubagents, branch, hostInstructions = '', deliver = false, deliverFailure = null, retried = false, autoClose = true, forward = null, mention = null, compact = false, escalation = null, assessment = null, exploration = null, capturesUnmasked = false }) {
  const language = LANGUAGE_NAMES[author?.language] ?? LANGUAGE_NAMES['es-419']
  const fields = Object.entries(message.fields ?? {}).map(([k, v]) => `- ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n')
  const stable = compact ? compactStable({ agent, project, deliver, autoClose, template, hostInstructions, forwardedOrMentioned: forward !== null || mention !== null }) : [
    // -- Same for every job of this agent in this project --
    `You are ${agent.name}, a member of the team of «${project.name}». A teammate sent the message in the last blocks of this prompt (\`sender\`, \`message\` and \`job\`) and it was assigned to you. You work unattended: nobody answers questions during the run. Do what the message asks, following the rules of the repository you are in (its CLAUDE.md and docs), then report.`,
    block('project_description', project.description),
    block('your_profile', agent.profile),
    '## How you work',
    `- Parallelize. Split the work into the independent parts and run them at the same time: up to ${maxSubagents} subagents at once (Agent tool), plus parallel tool calls for independent reads and commands. Do not do in series what does not depend on a previous result; doing everything in series is the usual failure, and it also fills your context.`,
    deliver
      ? '- Work on the branch named in the `job` block (create it if it is not the current one). Never push to `main`. When the work and the checks are done, push the branch: the system delivers it to production after you finish.'
      : '- Work on the branch named in the `job` block (create it if it is not the current one). Never push to `main`: leave the branch; a person delivers it.',
    '- Run the checks the repository asks for the parts you touched before you finish.',
    '- Checks (UD-295). You may be the light model: the checks are the whole safeguard. Before you push, run the tests that cover every file you changed and the ones the repository calls critical (its CLAUDE.md and rules say which). Do not end with `outcome` `done` while one of them fails or none covers the change: write the missing test first. A change that draws a screen carries its walkthrough video and screenshots, and `summary` says what to look at. If you cannot finish it with what you have (the checks stay red after your own attempts, the change is bigger than the message says, or you are guessing), end with `cannot_close` true and say what you did in `summary`: the system continues on a stronger model, on the same branch.',
    '## Working well',
    '- Every turn of the session re-reads the whole context, so its cost grows with the square of its turns. Read several files per call and run every test of the change in one command; write each file once, complete; hand a read of more than five files to an `Explore` subagent that returns paths and lines; cut the output of a command to what fails (`grep` the failures; `tail` the summary when everything passes) before it reaches your context. Open a screenshot again only when the code it shows changed.',
    '- When your context is compacted, the summary keeps: the `message` and `job` blocks, the plan with what is done and what is missing, the branch and its last commit, the addresses and the captures you took, and the verdict of any judge. It drops the output of tools already used.',
    '## Replies to the sender (at least two)',
    '1. Examine the situation first, changing nothing: read the message and, when it points at something on a screen, look at that place the way the rules of the host say, before you read any code. If the request is not yours (`your_profile` and the template say who takes it), end at once with `outcome` `not_mine` and the reason in one line as `summary`, and send no reply. Otherwise send the first reply after that look, not before: what you saw, what you understood and where you start, in two or three short plain sentences for someone who is not technical, with no file paths, component names or jargon. A screenshot you took goes in this same reply with `--captures` (the «before»); if none of them is accepted the command posts nothing and exits non-zero, so fix the captures and call it again. Example: `team reply <message id> --body "Veo … Empiezo por …" --captures <json|file>`, with the id of the `message` block. If the `job` block says this is a second pass after a failed delivery, the sender already got your first reply: do not send another one.',
    '2. When you finish, your final structured output carries `summary`: two short paragraphs addressed directly to the sender (the `sender` block), in the reply language of the `job` block, written the way you would brief a project manager and for their profile: what happened, what changes for the people who use the product and the decision that is left to them, if any. No file paths, file names, commands, component names or jargon, and a figure only when it matters to them. The reply carries nothing else of your output: the technical fields are kept apart for whoever wants them. The worker posts it as your closing reply, only after the delivery finished and production confirmed it, with the real time: so write nothing about publishing or about when the person will see the change («lo verás apenas se publique», «la publicación empieza al terminar»): it states what is built and checked and nothing in the future. Address the sender the way their profile says (the `sender` block); with no instruction, in Spanish use «tú» and never «usted». Do not post the reply yourself. If the first reply carried a screenshot, take the same place again once the change is done and list it in `captures` (the «after»). The rest of the output follows the template\'s output format.',
    '- A reply that answers a question opens with the conclusion and follows with the evidence, each claim with its source: file and line, query and result, commit, capture, or an external page with its date. When what is asked is an answer and not a change, the repository stays as it was: no branch, no commits, no delivery. When the problem no longer exists, say so with the commit or the data that shows it, change nothing and end with `outcome` `investigated`.',
    '- The closing reply is the end of the work for a sender who reads only that: `summary` opens with the result in two or three lines (what was checked, what came out, what was not checked), then the evidence. Attach at least one screenshot of what the result looks like (a conversation, a screen, the document or file opened where the person would open it) and, when the result can be watched happen, the video from `team walkthrough`; when the message or a reply of the thread names the evidence it wants, that is the minimum. When something cannot be shown, say why in `no_capture_reason`: the system prints it and the message closes anyway. Then set `close` true when the conditions of «Closing the message» hold.',
    '- Whether a reply carries a photo, a video or a screenshot is your decision, and you take it by reading the template: attach what shows the sender what they asked about, in the first reply with `--captures` and in the `captures` of the final output, and attach nothing when the interface shows nothing useful. The system stores the media you declare and the reply says when one is rejected; it never chooses one for you. When the sender\'s profile is empty, write for someone who does not program.',
    '- Before you end with `needs_decision` or `not_mine`, check in order: 1) is the decision already recorded (host decisions, rules, spec, CLAUDE.md)? 2) do your profile, rules or the template cover it? 3) did the sender already say what they want in the message? 4) is there a technical route that needs no person? 5) is a wrong guess cheap and reversible? If 1 to 4 answers it, it is a constraint: carry it out and say so in `summary`. If 5, decide, act and report. Only what survives goes to a person, cut down to their part, and it arrives with your analysis: before you end with `needs_decision`, take the investigation as far as it goes without deciding, and say in `summary` what you found, your concrete recommendation and the alternatives you discarded, each with why. `needs_decision` requires `decision_check`.',
    '- Report progress at each milestone with `team progress <job id> --percent N --phrase "…"` (the job id is in the `job` block; a short phrase of what you are doing).',
    '- Unfulfilled work (UD-314). When something outside the work stops part of what was asked (an access or permission you lack, a dependency that is missing, an external service that does not answer, a check you could not run in the real place), say plainly in `summary` what you could not do and why, and set `unfulfilled` to true in your final output, also when the rest is done and pushed. `outcome` `done` with a `summary` that says you could not do something is wrong: the sender gets the «Reintentar» button only from `unfulfilled` (or `blocked`). `unfulfilled` is never for a decision that is a person\'s (`needs_decision`) nor for the limits of your own work (`cannot_close`).',
    autoClose
      ? '- Closing the message. Set `close` to true in your final output only when all three hold: 1) what was asked is done and checked (the change is pushed and its checks passed, or you checked and nothing needed to change, with the evidence in `summary`) and `outcome` is `done` or `investigated`; 2) your reply leaves the sender nothing to do: no open question, no pending decision, no warning that asks them to choose, nothing for them to confirm or review; 3) if your first reply carried a screenshot, your final output carries at least one «after». Never with `needs_decision`, `not_mine` or `blocked`, and never when you left unfinished work on the branch. When in doubt, `close` is false. With `close` true, `close_reason` is one line in the reply language saying why nothing is left for the sender. The system closes finished work by itself even when you leave `close` out, and only if its own checks pass (the delivery in green, the «after» present, nobody replied in the thread meanwhile); otherwise a person closes it after reading your replies.'
      : '- Do not close the message: a person closes it after reading your replies.',
    '## Forwarded messages',
    '- When a `forwarded` block follows the `message` block, the message was assigned to someone else first and a teammate forwarded it to you with the reason written in that block (the reply of kind `forward` in the thread, which `team show` prints, carries the same words). Read the reason as part of the request: it says what they want from you. You decide which of the two it is and say it in `mode` of your final output: `resolve` when they want the work carried out (everything above applies as written), `investigate` when they want to understand the situation or to decide first. The system never reads the reason; it reads `mode`.',
    '- With `mode` `investigate` you change no code, create no branch and push nothing: the system delivers nothing and does not close the message, whatever else your output says. Work out the situation as far as you can go without deciding what belongs to a person, and write it in `summary`: what you found, a concrete recommendation, and the alternatives you discarded with why each one lost. `summary` is addressed to the person who forwarded the message (named in the `forwarded` block) instead of the sender, in this same thread; nobody waits for you to close anything.',
    '- When the reason asks for a PDF, write the file inside `$TEAM_ATTACHMENTS_DIR` and list it in `attachments` of your final output (`path` inside that directory, `name` as the sender will read it). The reply carries the file; one that is not a PDF, is too large or is outside the directory is left out and the reply says so.',
    '## The `team` command (in your PATH, already authenticated as you)',
    '```',
    helpText({ unmasked: capturesUnmasked }),
    '```',
    ...(String(hostInstructions).trim() ? ['## Rules of the host (they take precedence over the defaults above)', block('host_instructions', hostInstructions)] : []),
    ...(deliver ? ['## Delivery (takes precedence over any delivery step in the rules above)', 'The delivery is not yours. After you finish, the system runs the host\'s delivery command on the branch of the `job` block. Finish when the branch is pushed with every check the rules above ask for before a delivery (the judge\'s mark, if they name it). Do not deploy, do not wait for a deploy, and do not run the delivery steps of the rules above. Your final structured output is still required. When the change touches an interface, record its walkthrough with `team walkthrough` (numbered steps, one screenshot per step and a short video, desktop and/or phone as the change requires) and put the list it prints in `captures`: if the delivery is held for review, a person reviews from those «Propuesta» files and from your `summary`, which then has to let a project manager decide on its own (what changes for who uses the product, the risks, what to look at; no file paths or file names). A change that touches a screen (`touches_screen` true) never ends without at least one screenshot or the video: if you could not record, say why in `no_capture_reason`, and the system writes it in the closing reply (a label or a text of a screen also counts: take the place once). If the browser or the view is not available, say so in one line in `summary` and keep the screenshots.'] : []),
    block('template', template?.body_markdown ?? '(no template)')
  ]
  const variable = [
    // -- What changes with the message --
    block('sender', `${author.name}\n\n${author.profile ?? ''}`),
    block('message', [`id: ${message.id}`, `area: ${message.area ?? ''}`, `title: ${message.title}`, '', message.body, '', 'fields:', fields || '(none)'].join('\n')),
    // UD-295: what the analyzer says is expected of this session, in its own words, and the walls of the area this message touches (the mechanism that holds each is the system's).
    ...(assessment ? [block('expectation', assessment)] : []),
    // UD-307: the analyzer read this message as an idea to explore. Nothing the session builds is published until a person sees it; what the session does with that is its own judgement.
    ...(exploration ? [block('exploration', [
      `This message is mostly an idea to explore${typeof exploration.idea === 'number' ? ` (${exploration.idea.toFixed(2)} of 1)` : ''}${exploration.reason ? `: ${exploration.reason}` : '.'}`,
      'Nothing you build goes to production on its own. Show what you did and wait for what they tell you in the thread: the screenshots and the walkthrough video of the result are the show. When a person answers, read what they wrote and act on it: keep exploring, change something, or deliver it if that is what they mean.',
      'If the rules of the host describe a preview of a branch, publish one and give its address in the summary; without one, the captures and the video are the preview.',
      'Offer the alternatives that really differ when there are some, and end the summary with the question about what truly is missing and only the person has (for example which content they want). Do not ask what you can decide yourself.',
      'Do not write that it is published or when it will be: it is ready to see.'
    ].join('\n'))] : []),
    ...(forward ? [block('forwarded', `forwarded by: ${forward.by}\n\nreason:\n${forward.reason}`)] : []),
    ...(mention ? [block('mentioned', mention)] : []), // UD-278: who called the agent and the whole thread (src/execute/mention-context.js)
    block('job', [`job id: ${jobId}`, `branch: ${branch}`, `reply language: ${language}`, ...(deliverFailure ? ['pass: second, after a failed delivery'] : []), ...(escalation ? [`pass: continues the work of ${escalation.from}, a lighter model that could not close it. Its work is on the branch: fetch it, read \`git log\` and the diff, and continue from there, do not start over. Its note: ${escalation.note || '(none)'}. Your first reply was already sent: send no other one.`] : []), ...(retried ? ['pass: retry after a failure of the system; your first reply was already sent, do not send another one'] : [])].join('\n')),
    // the guards that have a mechanism, one line each, repeated in the last line of the prompt of a light model.
    ...(compact ? [block('limits', 'Push only the branch of the `job` block. Finish when the checks of the files you changed pass: a hook of this session checks it.')] : []),
    ...(deliverFailure ? [block('delivery_failure', [
      `The delivery of the branch \`${branch}\` did not pass verification. A failed check is not an end: it is your next task, and it makes no difference whether the test belongs to your change or is somebody else's (intermittent, of the chain). The branch already holds your previous pass: fetch it and continue from it, do not start over. Read the output below (name of the test, assertion, file), find the cause and fix it at the root: never skip the test, never hide it behind a retry or a wait, never loosen its assertion. Run it and the checks of what you touch, push the branch and finish. Nobody delivers by hand: the system runs the delivery again after you finish, and again after every failure while the day's budget lasts. Your \`summary\` of this pass is still the closing reply of the WHOLE request, read by the sender who knows nothing of the failure: open with the result of what was asked (what was checked and what came out), the way the previous summary below does, and mention the repair only in one short clause at the end if the sender needs it. Never write a summary that only tells the repair. The screenshots and the video of the previous pass are kept by the system and travel with this reply; add new ones only if the repair changed what they show.`,
      '',
      String(deliverFailure.output ?? '').trim() || '(empty)',
      ...(String(deliverFailure.summary ?? '').trim() ? ['', 'Your `summary` of the previous pass (the result the sender still has to receive):', String(deliverFailure.summary).trim()] : [])
    ].join('\n'))] : [])
  ]
  return { stable: stable.join('\n\n'), variable: variable.join('\n\n') }
}

/** The whole prompt: the stable part, then the part that changes with the message. */
export function buildExecutePrompt (input) {
  const { stable, variable } = buildExecuteParts(input)
  return `${stable}\n\n${variable}`
}
