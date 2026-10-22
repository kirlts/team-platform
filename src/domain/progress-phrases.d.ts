// Types of the progress catalogue for the panel's tests, which import it to compare both catalogues (H-3722).
type ProgressMessage = string | { one: string; other: string }
export const PROGRESS_PHRASES: Readonly<Record<string, Readonly<Record<'es-419' | 'en', ProgressMessage>>>>
export const PROGRESS_CODES: readonly string[]
export function step(code: string, vars?: Record<string, number>): { code: string; vars: Record<string, number> }
export function isStep(value: unknown): boolean
export function renderPhrase(code: string, vars?: Record<string, number>, language?: string): string | null
export function phraseOf(value: unknown, language?: string): string | null
export function keyOf(value: unknown): string | null
export function codeOfPhrase(phrase: unknown): { code: string; vars: Record<string, number> } | null
