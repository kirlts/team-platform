// Credential scanner for HP-007 (docs/TEST.md, MASTER-SPEC section 4.6): looks for provider keys and private keys in
// text. Used by the test and by scripts/check-secrets.mjs, which the pre-commit hook runs. Test support: nothing here
// is imported from production code.

/** Names of the patterns that look at variable names, not at the shape of a key: tests assign made-up values on purpose. */
const GENERIC = new Set(['key assigned to a literal'])

/** [name, pattern]. Each pattern matches the secret itself, not just the name of the variable that would hold it. */
export const SECRET_PATTERNS = [
  ['Anthropic key', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['Groq key', /gsk_[A-Za-z0-9]{20,}/],
  ['OpenAI-style key', /\bsk-[A-Za-z0-9]{32,}/],
  ['OpenRouter key', /sk-or-[A-Za-z0-9_-]{20,}/],
  ['Google API key', /AIza[0-9A-Za-z_-]{35}/],
  ['AWS access key id', /\bAKIA[0-9A-Z]{16}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}/],
  ['private key block', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
  // A variable that holds a key, set to a literal value: `ANTHROPIC_API_KEY=abc...`. Empty values and `${...}` do not count.
  ['key assigned to a literal', /\b[A-Z][A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD)\s*[=:]\s*['"]?(?![\s'"$#]|\.\.\.|<)[A-Za-z0-9+/_-]{16,}/]
]

/** Findings in `text`: [{ line, name }]. In a test file (`isTest`) the generic by-name pattern is not applied. */
export function findSecrets (text, { isTest = false } = {}) {
  const found = []
  text.split('\n').forEach((lineText, index) => {
    for (const [name, pattern] of SECRET_PATTERNS) {
      if (isTest && GENERIC.has(name)) continue
      if (pattern.test(lineText)) found.push({ line: index + 1, name })
    }
  })
  return found
}
