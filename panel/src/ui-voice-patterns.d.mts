export const MAX_WORDS: number
export const MAX_WORDS_ERROR: number
export const MAX_HINT_CHARS: number
export const ES_COLLOQUIAL_IMPERATIVES: Set<string>
export function breaksVoice(key: string, text: string, lang: 'es' | 'en'): 'length' | 'opening' | 'person' | 'imperative' | 'punctuation' | 'gerund' | 'vague' | null
export type VoicePattern = { id: string; lang: 'es' | 'en' | 'any'; source: string; flags: string }
export const VOICE_PATTERNS: VoicePattern[]
export function voicePatterns(lang?: 'es' | 'en'): VoicePattern[]
