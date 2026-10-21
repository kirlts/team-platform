// Utilidades de tiempo y serialización compartidas por todos los módulos.

export const iso = (ms) => (ms === null || ms === undefined ? null : new Date(ms).toISOString())

export function parseJson (textValue, fallback = null) {
  if (textValue === null || textValue === undefined || textValue === '') return fallback
  try { return JSON.parse(textValue) } catch { return fallback }
}
