// Account language (UD-018): one setting per account with exactly two values. It selects the language of the prompts
// the model receives, of the messages the analysis writes, and of the panel. It travels to the analyzer as context
// data (`bundle.language`) and is never inferred from any text.

import { badRequest } from './errors.js'

export const LANGUAGES = ['es-419', 'en']
export const DEFAULT_LANGUAGE = 'es-419' // neutral Latin American Spanish, set by Martín (UD-018)

/** Returns `value` when it is one of the two supported languages; otherwise a 400 with a code the panel translates. */
export function requireLanguage (value) {
  if (!LANGUAGES.includes(value)) {
    throw badRequest(`El idioma debe ser uno de: ${LANGUAGES.join(', ')}.`, 'language_invalid')
  }
  return value
}
