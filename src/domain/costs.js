// Costo de una llamada a un proveedor (columna `llm_calls.cost_usd`). Los proveedores informan tokens, no
// dólares; el precio por modelo es configuración (`config.pricing`, fuentes en src/config.js). Un modelo sin
// precio conocido cuesta 0 en la tabla: no se inventa una tarifa.

export function llmCostUsd (config, model, usage = {}) {
  const p = config.pricing.llmPerMTok[model]
  if (!p) return 0
  const loginResponse = usage.input_tokens ?? 0
  const outText = usage.output_tokens ?? 0
  const cache = usage.cached_tokens ?? 0
  const cacheWriteTokens = usage.cache_creation_tokens ?? 0
  return (loginResponse * p.input + outText * p.output + cache * p.cached + cacheWriteTokens * p.input * config.pricing.cacheWriteFactor) / 1e6
}

export function speechCostUsd (config, seconds) {
  return (seconds / 3600) * config.pricing.speechUsdPerHour
}
