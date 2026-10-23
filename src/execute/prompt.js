// The prompt and the output schema of an `execute` job (UD-254, UD-255, MS §7.5 «Ejecución»). The prompt is code and goes
// in English (RULES 1); the replies the session writes go in the language of the person who sent the message.

import { compileOutputSchema, parseTemplate } from '../analyze/templates.js'
import { HELP as TEAM_HELP } from '../../scripts/team.mjs'

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
export function finalSchema (declared, { validation = false } = {}) {
  const description = 'Closing reply to the sender: two short paragraphs, no internal jargon, addressed to them.'
  // The grammar of --json-schema keeps A4's plain string; the check after the run also rejects an empty one.
  const summary = { type: 'string', ...(validation ? { minLength: 1 } : {}), description }
  if (!declared || typeof declared !== 'object' || declared.type !== 'object') {
    return { type: 'object', additionalProperties: false, required: ['summary'], properties: { summary } }
  }
  return {
    ...declared,
    required: [...new Set([...(declared.required ?? []), 'summary'])],
    properties: { ...(declared.properties ?? {}), summary }
  }
}

const block = (title, text) => `<${title}>\n${String(text ?? '').trim() || '(empty)'}\n</${title}>`

/**
 * Builds the prompt. `message`: { id, title, body, fields, area, status }; `template`: the row with `body_markdown`;
 * `author` and `agent`: { name, profile, language }; `project`: { name, description }. With `deliver` (UD-263) the system delivers the
 * branch after the session, so the session stops at the push; `deliverFailure` ({ output }) is the second pass after that delivery failed.
 */
export function buildExecutePrompt ({ message, template, author, agent, project, jobId, maxSubagents, branch, hostInstructions = '', deliver = false, deliverFailure = null }) {
  const language = LANGUAGE_NAMES[author?.language] ?? LANGUAGE_NAMES['es-419']
  const fields = Object.entries(message.fields ?? {}).map(([k, v]) => `- ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n')
  return [
    `You are ${agent.name}, a member of the team of «${project.name}». A teammate sent the message below and it was assigned to you. You work unattended: nobody answers questions during the run. Do what the message asks, following the rules of the repository you are in (its CLAUDE.md and docs), then report.`,
    block('project_description', project.description),
    block('your_profile', agent.profile),
    block('sender', `${author.name}\n\n${author.profile ?? ''}`),
    block('message', [`id: ${message.id}`, `area: ${message.area ?? ''}`, `title: ${message.title}`, '', message.body, '', 'fields:', fields || '(none)'].join('\n')),
    block('template', template?.body_markdown ?? '(no template)'),
    ...(deliverFailure ? [block('delivery_failure', [
      `The delivery of the branch \`${branch}\` failed. The branch already holds your previous pass: fetch it and continue from it, do not start over. Read the output of the delivery below, fix the cause on the same branch, run the checks for the parts you touch, push the branch and finish. Nobody delivers by hand: the system runs the delivery again after you finish.`,
      '',
      String(deliverFailure.output ?? '').trim() || '(empty)'
    ].join('\n'))] : []),
    '## How you work',
    `- Parallelize. Split the work into the independent parts and run them at the same time: up to ${maxSubagents} subagents at once (Agent tool), plus parallel tool calls for independent reads and commands. Do not do in series what does not depend on a previous result; doing everything in series is the usual failure, and it also fills your context.`,
    deliver
      ? `- Work on the branch \`${branch}\` (create it if it is not the current one). Never push to \`main\`. When the work and the checks are done, push the branch: the system delivers it to production after you finish.`
      : `- Work on the branch \`${branch}\` (create it if it is not the current one). Never push to \`main\`: leave the branch; a person delivers it.`,
    '- Run the checks the repository asks for the parts you touched before you finish.',
    '## Replies to the sender (at least two)',
    deliverFailure
      ? '1. This is a second pass after a failed delivery: the sender already got your first reply, so do not send another one.'
      : `1. Now, before any other work, send the first reply: what you understood and where you start. Example: \`team reply ${message.id} --body "Recibido. Empiezo por …"\`.`,
    `2. When you finish, your final structured output carries \`summary\`: two short paragraphs addressed directly to ${author.name}, in ${language}, without internal jargon, written for their profile and the project. The worker posts it as your closing reply; do not post it yourself. The rest of the output follows the template's output format.`,
    `- Report progress at each milestone with \`team progress ${jobId} --percent N --phrase "…"\` (a short phrase of what you are doing).`,
    `- Do not close the message: a person closes it after reading your replies.`,
    '## The `team` command (in your PATH, already authenticated as you)',
    '```',
    TEAM_HELP,
    '```',
    ...(String(hostInstructions).trim() ? ['## Rules of the host (they take precedence over the defaults above)', block('host_instructions', hostInstructions)] : []),
    ...(deliver ? ['## Delivery (takes precedence over any delivery step in the rules above)', `The delivery is not yours. After you finish, the system runs the host's delivery command on \`${branch}\`. Finish when the branch is pushed with every check the rules above ask for before a delivery (the judge's mark, if they name it). Do not deploy, do not wait for a deploy, and do not run the delivery steps of the rules above. Your final structured output is still required.`] : [])
  ].join('\n\n')
}
