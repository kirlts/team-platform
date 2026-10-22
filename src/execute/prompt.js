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
 * `author` and `agent`: { name, profile, language }; `project`: { name, description }.
 */
export function buildExecutePrompt ({ message, template, author, agent, project, jobId, maxSubagents, branch, hostInstructions = '' }) {
  const language = LANGUAGE_NAMES[author?.language] ?? LANGUAGE_NAMES['es-419']
  const fields = Object.entries(message.fields ?? {}).map(([k, v]) => `- ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n')
  return [
    `You are ${agent.name}, a member of the team of «${project.name}». A teammate sent the message below and it was assigned to you. You work unattended: nobody answers questions during the run. Do what the message asks, following the rules of the repository you are in (its CLAUDE.md and docs), then report.`,
    block('project_description', project.description),
    block('your_profile', agent.profile),
    block('sender', `${author.name}\n\n${author.profile ?? ''}`),
    block('message', [`id: ${message.id}`, `area: ${message.area ?? ''}`, `title: ${message.title}`, '', message.body, '', 'fields:', fields || '(none)'].join('\n')),
    block('template', template?.body_markdown ?? '(no template)'),
    '## How you work',
    `- Parallelize. Split the work into the independent parts and run them at the same time: up to ${maxSubagents} subagents at once (Agent tool), plus parallel tool calls for independent reads and commands. Do not do in series what does not depend on a previous result; doing everything in series is the usual failure, and it also fills your context.`,
    `- Work on the branch \`${branch}\` (create it if it is not the current one). Never push to \`main\`: leave the branch; a person delivers it.`,
    '- Run the checks the repository asks for the parts you touched before you finish.',
    '## Replies to the sender (at least two)',
    `1. Now, before any other work, send the first reply: what you understood and where you start. Example: \`team reply ${message.id} --body "Recibido. Empiezo por …"\`.`,
    `2. When you finish, your final structured output carries \`summary\`: two short paragraphs addressed directly to ${author.name}, in ${language}, without internal jargon, written for their profile and the project. The worker posts it as your closing reply; do not post it yourself. The rest of the output follows the template's output format.`,
    `- Report progress at each milestone with \`team progress ${jobId} --percent N --phrase "…"\` (a short phrase of what you are doing).`,
    `- Do not close the message: a person closes it after reading your replies.`,
    '## The `team` command (in your PATH, already authenticated as you)',
    '```',
    TEAM_HELP,
    '```',
    ...(String(hostInstructions).trim() ? ['## Rules of the host (they take precedence over the defaults above)', block('host_instructions', hostInstructions)] : [])
  ].join('\n\n')
}
