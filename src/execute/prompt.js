// The prompt and the output schema of an `execute` job (UD-254, UD-255, MS §7.5 «Ejecución»). The prompt is code and goes
// in English (RULES 1); the replies the session writes go in the language of the person who sent the message.

import { compileOutputSchema, parseTemplate } from '../analyze/templates.js'
import { HELP as TEAM_HELP } from '../../scripts/team.mjs'
import { decisionCheckSchema } from './decision-check.js'

/** What a forwarded job may do (UD-272): carry the work out, or investigate and recommend without changing anything. */
export const FORWARD_MODES = ['resolve', 'investigate']

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
export function finalSchema (declared, { validation = false, autoClose = true, forwarded = false } = {}) {
  const description = 'Closing reply to the sender, as to a project manager: two short paragraphs, what happened, what changes for those who use the product and the decision left to them, if any. No paths, file names, commands, component names or jargon.'
  // The grammar of --json-schema keeps A4's plain string; the check after the run also rejects an empty one.
  const summary = { type: 'string', ...(validation ? { minLength: 1 } : {}), description }
  // UD-268: optional screenshots of the interface for the closing reply (the first reply carries its own with `team reply --captures`).
  const captures = {
    type: 'array',
    description: 'Screenshots for the closing reply (the «after» of the first reply\'s «before»). Omit when the interface shows nothing useful. A walkthrough video (WebM) from `team walkthrough` goes here too.',
    items: {
      type: 'object', additionalProperties: false, required: ['path', 'alt', 'masked', 'place', 'as'],
      properties: {
        path: { type: 'string', description: 'File inside $TEAM_CAPTURES_DIR' }, alt: { type: 'string', description: 'One line' },
        masked: { type: 'boolean', description: 'true when the tool hid the personal data' }, place: { type: 'string', description: 'Route or menu of the view' }, as: { type: 'string', description: 'Clinic and role it was seen as' }
      }
    }
  }
  // UD-271: the session asks to close the message; the system closes only when its own checks pass too (auto-close.js). Both are optional. Without EXECUTE_AUTO_CLOSE the grammar does not offer them, but the validation still accepts them: an output that carries them is not a malformed output.
  const closing = autoClose || validation
    ? {
        close: { type: 'boolean', description: 'true only when the three conditions of «Closing the message» hold; false when in doubt.' },
        close_reason: { type: 'string', description: 'One line in the reply language: why nothing is left for the sender. Required with close true.' }
      }
    : {}
  // UD-272: a message forwarded to the agent. `mode` is what the model understood from the reason (the system reads the field, never the text): `investigate` means
  // no change, no delivery, no close. `attachments` are the documents the reason asked for. Only the grammar of a forwarded job offers them; the validation always accepts them.
  const forwarding = forwarded || validation
    ? {
        mode: { type: 'string', enum: FORWARD_MODES, description: '`resolve` when the sender wants the work carried out; `investigate` when they want to understand or decide first: then no code is changed and nothing is delivered or closed.' },
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
  if (!declared || typeof declared !== 'object' || declared.type !== 'object') {
    return { type: 'object', additionalProperties: false, required: ['summary'], properties: { summary, captures, ...closing, ...forwarding } }
  }
  // UD-269: `decision_check` is optional in the grammar; the check after the run requires it with `needs_decision` (decision-check.js).
  return {
    ...declared,
    required: [...new Set([...(declared.required ?? []), 'summary'])],
    properties: { ...(declared.properties ?? {}), summary, captures, ...closing, ...forwarding, decision_check: decisionCheckSchema({ validation }) }
  }
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
export function buildExecuteParts ({ message, template, author, agent, project, jobId, maxSubagents, branch, hostInstructions = '', deliver = false, deliverFailure = null, retried = false, autoClose = true, forward = null, mention = null }) {
  const language = LANGUAGE_NAMES[author?.language] ?? LANGUAGE_NAMES['es-419']
  const fields = Object.entries(message.fields ?? {}).map(([k, v]) => `- ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n')
  const stable = [
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
    '## Replies to the sender (at least two)',
    '1. Examine the situation first, changing nothing: read the message and, when it points at something on a screen, look at that place the way the rules of the host say, before you read any code. If the request is not yours (`your_profile` and the template say who takes it), end at once with `outcome` `not_mine` and the reason in one line as `summary`, and send no reply. Otherwise send the first reply after that look, not before: what you saw, what you understood and where you start, in two or three short plain sentences for someone who is not technical, with no file paths, component names or jargon. A screenshot you took goes in this same reply with `--captures` (the «before»); if none of them is accepted the command posts nothing and exits non-zero, so fix the captures and call it again. Example: `team reply <message id> --body "Veo … Empiezo por …" --captures <json|file>`, with the id of the `message` block. If the `job` block says this is a second pass after a failed delivery, the sender already got your first reply: do not send another one.',
    '2. When you finish, your final structured output carries `summary`: two short paragraphs addressed directly to the sender (the `sender` block), in the reply language of the `job` block, written the way you would brief a project manager and for their profile: what happened, what changes for the people who use the product and the decision that is left to them, if any. No file paths, file names, commands, component names or jargon, and a figure only when it matters to them. The reply carries nothing else of your output: the technical fields are kept apart for whoever wants them. The worker posts it as your closing reply; do not post it yourself. If the first reply carried a screenshot, take the same place again once the change is done and list it in `captures` (the «after»). The rest of the output follows the template\'s output format.',
    '- Before you end with `needs_decision` or `not_mine`, check in order: 1) is the decision already recorded (host decisions, rules, spec, CLAUDE.md)? 2) do your profile, rules or the template cover it? 3) did the sender already say what they want in the message? 4) is there a technical route that needs no person? 5) is a wrong guess cheap and reversible? If 1 to 4 answers it, it is a constraint: carry it out and say so in `summary`. If 5, decide, act and report. Only what survives goes to a person, cut down to their part, and it arrives with your analysis: before you end with `needs_decision`, take the investigation as far as it goes without deciding, and say in `summary` what you found, your concrete recommendation and the alternatives you discarded, each with why. `needs_decision` requires `decision_check`.',
    '- Report progress at each milestone with `team progress <job id> --percent N --phrase "…"` (the job id is in the `job` block; a short phrase of what you are doing).',
    autoClose
      ? '- Closing the message. Set `close` to true in your final output only when all three hold: 1) what was asked is done and checked (the change is pushed and its checks passed, or you checked and nothing needed to change, with the evidence in `summary`) and `outcome` is `done` or `investigated`; 2) your reply leaves the sender nothing to do: no open question, no pending decision, no warning that asks them to choose, nothing for them to confirm or review; 3) if your first reply carried a screenshot, your final output carries at least one «after». Never with `needs_decision`, `not_mine` or `blocked`, and never when you left unfinished work on the branch. When in doubt, `close` is false. With `close` true, `close_reason` is one line in the reply language saying why nothing is left for the sender. The system closes the message only if its own checks pass too (the delivery in green, the «after» present, nobody replied in the thread meanwhile); otherwise a person closes it after reading your replies.'
      : '- Do not close the message: a person closes it after reading your replies.',
    '## Forwarded messages',
    '- When a `forwarded` block follows the `message` block, the message was assigned to someone else first and a teammate forwarded it to you with the reason written in that block (the reply of kind `forward` in the thread, which `team show` prints, carries the same words). Read the reason as part of the request: it says what they want from you. You decide which of the two it is and say it in `mode` of your final output: `resolve` when they want the work carried out (everything above applies as written), `investigate` when they want to understand the situation or to decide first. The system never reads the reason; it reads `mode`.',
    '- With `mode` `investigate` you change no code, create no branch and push nothing: the system delivers nothing and does not close the message, whatever else your output says. Work out the situation as far as you can go without deciding what belongs to a person, and write it in `summary`: what you found, a concrete recommendation, and the alternatives you discarded with why each one lost. `summary` is addressed to the person who forwarded the message (named in the `forwarded` block) instead of the sender, in this same thread; nobody waits for you to close anything.',
    '- When the reason asks for a PDF, write the file inside `$TEAM_ATTACHMENTS_DIR` and list it in `attachments` of your final output (`path` inside that directory, `name` as the sender will read it). The reply carries the file; one that is not a PDF, is too large or is outside the directory is left out and the reply says so.',
    '## The `team` command (in your PATH, already authenticated as you)',
    '```',
    TEAM_HELP,
    '```',
    ...(String(hostInstructions).trim() ? ['## Rules of the host (they take precedence over the defaults above)', block('host_instructions', hostInstructions)] : []),
    ...(deliver ? ['## Delivery (takes precedence over any delivery step in the rules above)', 'The delivery is not yours. After you finish, the system runs the host\'s delivery command on the branch of the `job` block. Finish when the branch is pushed with every check the rules above ask for before a delivery (the judge\'s mark, if they name it). Do not deploy, do not wait for a deploy, and do not run the delivery steps of the rules above. Your final structured output is still required. When the change touches an interface, record its walkthrough with `team walkthrough` (numbered steps, one screenshot per step and a short video, desktop and/or phone as the change requires) and put the list it prints in `captures`: if the delivery is held for review, a person reviews from those «Propuesta» files and from your `summary`, which then has to let a project manager decide on its own (what changes for who uses the product, the risks, what to look at; no file paths or file names). If the browser or the view is not available, say so in one line in `summary` and keep the screenshots.'] : []),
    block('template', template?.body_markdown ?? '(no template)')
  ]
  const variable = [
    // -- What changes with the message --
    block('sender', `${author.name}\n\n${author.profile ?? ''}`),
    block('message', [`id: ${message.id}`, `area: ${message.area ?? ''}`, `title: ${message.title}`, '', message.body, '', 'fields:', fields || '(none)'].join('\n')),
    ...(forward ? [block('forwarded', `forwarded by: ${forward.by}\n\nreason:\n${forward.reason}`)] : []),
    ...(mention ? [block('mentioned', mention)] : []), // UD-278: who called the agent and the whole thread (src/execute/mention-context.js)
    block('job', [`job id: ${jobId}`, `branch: ${branch}`, `reply language: ${language}`, ...(deliverFailure ? ['pass: second, after a failed delivery'] : []), ...(retried ? ['pass: retry after a failure of the system; your first reply was already sent, do not send another one'] : [])].join('\n')),
    ...(deliverFailure ? [block('delivery_failure', [
      `The delivery of the branch \`${branch}\` failed. The branch already holds your previous pass: fetch it and continue from it, do not start over. Read the output of the delivery below, fix the cause on the same branch, run the checks for the parts you touch, push the branch and finish. Nobody delivers by hand: the system runs the delivery again after you finish.`,
      '',
      String(deliverFailure.output ?? '').trim() || '(empty)'
    ].join('\n'))] : [])
  ]
  return { stable: stable.join('\n\n'), variable: variable.join('\n\n') }
}

/** The whole prompt: the stable part, then the part that changes with the message. */
export function buildExecutePrompt (input) {
  const { stable, variable } = buildExecuteParts(input)
  return `${stable}\n\n${variable}`
}
