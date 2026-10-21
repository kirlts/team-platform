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

/** The language a set is written in, after the fallback. */
export function resolveLanguage(language) {
  return promptSet(language).LANGUAGE;
}

// ---------------------------------------------------------------------------------------------
// First call: classify
// ---------------------------------------------------------------------------------------------

export function classifySystem({ areas, templates, language }) {
  const set = promptSet(language);
  return [set.CLASSIFY_INSTRUCTIONS, set.catalogBlock({ areas, templates })];
}

export function attachmentsBlock(attachments, units, language) {
  return promptSet(language).attachmentsBlock(attachments, units);
}

export function membersBlock(members, language) {
  return promptSet(language).membersBlock(members);
}

export function classifyUser({ units, attachments, language, secondPass = false }) {
  const set = promptSet(language);
  const note = secondPass ? [set.SECOND_PASS_NOTE, ''] : [];
  return [...note, set.attachmentsBlock(attachments, units), '', set.INPUT_HEADING, renderUnits(units, set.LANGUAGE)].join('\n');
}

// ---------------------------------------------------------------------------------------------
// Second call: decompose
// ---------------------------------------------------------------------------------------------

export function decomposeSystem(template, language) {
  const set = promptSet(language);
  return [set.DECOMPOSE_INSTRUCTIONS, set.templateBlock(template)];
}

export function decomposeUser({ members, attachments, units, scopeNote, language }) {
  const set = promptSet(language);
  const parts = [set.membersBlock(members), '', set.attachmentsBlock(attachments, units), ''];
  if (scopeNote) parts.push(scopeNote, '');
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

export function harnessPrompt({ unitCount, retryErrors, language }) {
  return promptSet(language).harnessPrompt({ unitCount, retryErrors });
}
