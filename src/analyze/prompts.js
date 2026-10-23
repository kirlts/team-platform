// Analyzer prompts (MASTER-SPEC §1.2 and §7.5). There are two complete sets, one written natively in neutral Latin American
// Spanish (prompts-es.js) and one in English (prompts-en.js), and `bundle.language` picks one (UD-018). Each set asks the model
// for its output in its own language, whatever the language of the input. The default is `es-419`.
//
// Construction rules:
//  - The system prompt is stable: whatever changes per input goes in the user message, so the
//    prefix is cached (report 02 §7). The second call carries the chosen template in the system prompt.
//  - The model receives no business rules the system can enforce on its own: area, template,
//    members and attachments are validated afterwards against the database (MASTER-SPEC §1.2).
//  - The content of the input is data, never instructions.
//  - The language is context data (a closed list), never deduced from the text of the input.
import { renderUnits } from './units.js';
import * as en from './prompts-en.js';
import * as es from './prompts-es.js';

/** Languages an account can choose (UD-018). */
export const LANGUAGES = Object.freeze(['es-419', 'en']);
/** Language used when the bundle carries none: neutral Latin American Spanish. */
export const DEFAULT_LANGUAGE = 'es-419';

const SETS = { 'es-419': es, en };

/** The prompt set of a language; an absent or unknown language falls back to the default. */
export function promptSet(language) {
  return SETS[language] ?? SETS[DEFAULT_LANGUAGE];
}

/** The framing a set starts with when the Editor saved none (H-3722). */
export function defaultFraming(language) {
  return promptSet(language).DEFAULT_FRAMING;
}

/** The language a set is written in, after the fallback. */
export function resolveLanguage(language) {
  return promptSet(language).LANGUAGE;
}

// ---------------------------------------------------------------------------------------------
// First call: classify
// ---------------------------------------------------------------------------------------------

export function classifySystem({ areas, templates, project, language, framing }) {
  const set = promptSet(language);
  // H-3722: the framing the Editor saved opens the instructions; without one, the default of the set.
  // UD-024: the project description is the last block of the cached system prompt; with none, the block disappears.
  return [set.classifyInstructions(framing), set.catalogBlock({ areas, templates }), set.projectBlock(project)].filter(Boolean);
}

export function attachmentsBlock(attachments, units, language) {
  return promptSet(language).attachmentsBlock(attachments, units);
}

export function membersBlock(members, language) {
  return promptSet(language).membersBlock(members);
}

export function classifyUser({ units, attachments, language, secondPass = false, coverage = false, context = [], recent, window }) {
  const set = promptSet(language);
  const note = [
    ...(secondPass ? [set.SECOND_PASS_NOTE, ''] : []),
    ...(coverage ? [set.COVERAGE_NOTE, ''] : []),
    ...(window ? [set.windowNote(window), ''] : []),
    ...(context.length > 0 ? [set.contextBlock(context), ''] : []),
  ];
  const recentBlock = set.recentInputsBlock(recent);
  return [...note, set.attachmentsBlock(attachments, units), '', ...(recentBlock ? [recentBlock, ''] : []), set.INPUT_HEADING, renderUnits(units, set.LANGUAGE)].join('\n');
}

/** H-3737: system prompt of the split check of one group; stable, so it is cached across groups. */
export function splitSystem({ language, framing }) {
  return [promptSet(language).splitInstructions(framing)];
}

/** User message of the split check: the units of one group. */
export function splitUser({ units, language }) {
  return promptSet(language).splitBlock(units);
}

// ---------------------------------------------------------------------------------------------
// Second call: decompose
// ---------------------------------------------------------------------------------------------

export function decomposeSystem(template, project, language, framing) {
  const set = promptSet(language);
  return [set.decomposeInstructions(framing), set.templateBlock(template), set.projectBlock(project)].filter(Boolean);
}

export function decomposeUser({ members, attachments, units, scopeNote, language, recent, request }) {
  const set = promptSet(language);
  const recentBlock = set.recentInputsBlock(recent);
  // UD-025: after the members block, outside the cached prefix.
  const parts = [set.membersBlock(members), '', ...(recentBlock ? [recentBlock, ''] : []), set.attachmentsBlock(attachments, units), ''];
  if (scopeNote) parts.push(scopeNote, '');
  if (typeof request === 'string' && request.trim()) parts.push(set.requestNote(request.trim()), '');
  parts.push(set.INPUT_HEADING, renderUnits(units, set.LANGUAGE));
  // The templates are written by the team, in its own language, and weigh more than a rule far above them: the language of
  // the output is repeated after the input (UD-018).
  parts.push('', set.LANGUAGE_RULE, set.FINAL_REMINDER);
  return parts.join('\n');
}

/** Note for a chunk when the input is split (the model must know it does not see everything). */
export function chunkNote({ index, total, first, last, language }) {
  return promptSet(language).chunkNote({ index, total, first, last });
}

// ---------------------------------------------------------------------------------------------
// Retries and rescue
// ---------------------------------------------------------------------------------------------

/** User message that follows an invalid output: the error as context (MASTER-SPEC §7.5). */
export function retryUser(errors, language) {
  return promptSet(language).retryUser(errors);
}

/** Rescue pass: only the conflict (report 02 §3.1 and §3.3; MASTER-SPEC §7.5). */
export function rescueUser({ language, ...rest }) {
  return promptSet(language).rescueUser(rest);
}

// ---------------------------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------------------------

export function harnessPrompt({ unitCount, retryErrors, language, framing }) {
  return promptSet(language).harnessPrompt({ unitCount, retryErrors, framing });
}
