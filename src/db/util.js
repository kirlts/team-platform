// Utilidades de tiempo y serialización compartidas por todos los módulos.

export const iso = (ms) => (ms === null || ms === undefined ? null : new Date(ms).toISOString())

export function parseJson (texto, omision = null) {
  if (texto === null || texto === undefined || texto === '') return omision
  try { return JSON.parse(texto) } catch { return omision }
}
