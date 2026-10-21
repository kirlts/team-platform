// Perillas del analizador, cada una con su valor por omisión y su fuente (MASTER-SPEC §4.9 y regla 3 de RULES).
// «Provisional» quiere decir que la fuente da una cota y el banco de referencia (§7.11) fija el valor.
// Las fuentes son del informe 02 (consultado el 2026-10-20) y del MASTER-SPEC; las claves [Fn] son las de ese informe.

export const KNOBS = Object.freeze({
  // Esfuerzo de la clasificación: nivel más barato y rápido, para tareas simples y de alto volumen.
  // Informe 02 §10.2, [F4][F5].
  classifyEffort: { value: 'low', source: 'Informe 02 §10.2 [F4][F5]; MASTER-SPEC §7.5 (1: clasificar, esfuerzo low)' },

  // Esfuerzo de la descomposición (y del pase de rescate, que es la misma tarea sobre menos unidades):
  // `medium` hasta que el banco muestre que `low` conserva la cobertura. En `low` aumenta la omisión
  // de comprobaciones en prompts largos. Informe 02 §10.2, [F4][F5].
  decomposeEffort: { value: 'medium', source: 'Informe 02 §10.2 [F4][F5]; MASTER-SPEC §3 y §7.5 (2: descomponer)' },

  // Pensamiento por llamada: `null` deja el adaptativo del modelo; `'disabled'` lo apaga (sólo con esfuerzo `high` o
  // menos, y con la línea «The JSON output format applies to your final answer only.», informe 02 §10.2 [F4]).
  // El banco compara `low` adaptativo, `low` sin pensamiento y `medium` adaptativo (informe 02 §8).
  classifyThinking: { value: null, source: 'Informe 02 §8 y §10.2 [F4]; medición de 2026-10-20 en docs/investigaciones/mediciones/' },
  decomposeThinking: { value: null, source: 'Informe 02 §8 y §10.2 [F4]; medición de 2026-10-20 en docs/investigaciones/mediciones/' },

  // Tope de salida por llamada. Provisional: el banco fija el p95 de salida por mensaje.
  // Informe 02 §10.2 [F1][F3]; MASTER-SPEC §7.5 (provisional: 16.000 y 32.000).
  maxTokens: { value: 16_000, source: 'Informe 02 §10.2 [F1][F3]; MASTER-SPEC §7.5' },

  // Un corte por max_tokens reintenta una vez con el doble. Mismas fuentes.
  maxTokensRetry: { value: 32_000, source: 'Informe 02 §10.2 [F1][F3]; MASTER-SPEC §7.5' },

  // Reintentos por salida inválida: uno, con el error como contexto; después el trabajo falla con el motivo.
  // MASTER-SPEC §7.5; informe 02 §10.2.
  invalidOutputRetries: { value: 1, source: 'MASTER-SPEC §7.5; informe 02 §10.2' },

  // Pases de rescate: uno como máximo, sólo si el cálculo de solapes o huecos no está vacío.
  // Ganancia medida en extracción abierta: +40 % de relaciones. Informe 02 §3.1 [F21] y §10.2.
  rescuePasses: { value: 1, source: 'Informe 02 §3.1 y §10.2 [F21]; MASTER-SPEC §7.5' },

  // Umbral de partición del input, en tokens de entrada. Provisional: frontera de precio de Haiku 5.5
  // (el precio de entrada sube de 0,10 a 0,50 USD por millón sobre 100.000 tokens). Informe 02 §2.2 y §10.2 [F2][F19].
  partitionThresholdTokens: { value: 100_000, source: 'Informe 02 §2.2 y §10.2 [F2]; MASTER-SPEC §7.5 (provisional)' },

  // Estimación de tokens a partir de caracteres, sólo para decidir si hay que partir.
  // Supuesto provisional: unos 4 caracteres por token en español con el tokenizador anterior, y el
  // tokenizador de Haiku 5.5 produce cerca de 30 % más tokens para el mismo texto (guía de migración
  // de Haiku 5.5, consultada el 2026-10-20): 4 / 1,3 ≈ 3. Las llamadas devuelven `usage` real; el banco calibra este valor.
  charsPerToken: { value: 3, source: 'Supuesto provisional; guía de migración de Haiku 5.5 (tokenizador con ~30 % más tokens); lo calibra el banco §7.11' },

  // Trozos descompuestos a la vez cuando se parte el input. Ejemplo de cuatro trozos en paralelo
  // del informe 02 §2.2. El límite de tasa de la cuenta no está medido: es convención hasta el banco.
  partitionConcurrency: { value: 4, source: 'Informe 02 §2.2 (ejemplo de cuatro trozos); provisional hasta el banco §7.11' },

  // Vida de la caché de prompt: 5 minutos por omisión, 1 hora si el acierto medido con
  // `cache_read_input_tokens` es bajo. Informe 02 §7 y §10.2 [F2].
  cacheTtl: { value: '5m', source: 'Informe 02 §7 y §10.2 [F2]' },

  // Tamaño mínimo del prompt de sistema para que se cachee en Haiku 5.5. Informe 02 §7 [F2].
  minCacheableSystemTokens: { value: 512, source: 'Informe 02 §7 y §10.2 [F2]; MASTER-SPEC §7.5' },

  // Ejecutable del harness. Debe estar en el PATH del contenedor o ser una ruta absoluta. MASTER-SPEC §3.
  harnessBin: { value: 'claude', source: 'MASTER-SPEC §3 (analizador alternativo); UD-008' },

  // Plazo del harness: la duración máxima de un trabajo es 900 s. MASTER-SPEC §7.3.
  harnessTimeoutMs: { value: 900_000, source: 'MASTER-SPEC §7.3 (duración máxima por trabajo 900 s)' },

  // Herramientas que el harness puede usar: sólo lectura, sobre su directorio de trabajo. MASTER-SPEC §7.5 («herramientas de lectura permitidas»).
  harnessTools: { value: Object.freeze(['Read']), source: 'MASTER-SPEC §7.5 (herramientas de lectura permitidas)' },

  // Directorio bajo el cual se crea el directorio de trabajo vacío y propio de cada análisis (UD-008).
  // null = el directorio temporal del sistema.
  harnessWorkRoot: { value: null, source: 'UD-008 (directorio de trabajo vacío y propio del adaptador)' },

  // Variables de entorno extra para el proceso del harness.
  harnessEnv: { value: Object.freeze({}), source: 'UD-008' },
});

const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

/** Valores por omisión, sin las fuentes. */
export const DEFAULT_CONFIG = Object.freeze(Object.fromEntries(Object.entries(KNOBS).map(([k, v]) => [k, v.value])));

/**
 * Mezcla ajustes sobre los valores por omisión y valida tipos. Una perilla desconocida es un error:
 * un nombre mal escrito no debe pasar en silencio.
 */
export function resolveConfig(overrides = {}) {
  const config = { ...DEFAULT_CONFIG };
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (!(key in KNOBS)) throw new TypeError(`Perilla desconocida del analizador: «${key}»`);
    if (value !== undefined) config[key] = value;
  }
  for (const key of ['classifyEffort', 'decomposeEffort']) {
    if (!EFFORTS.has(config[key])) throw new TypeError(`${key} debe ser uno de ${[...EFFORTS].join(', ')}`);
  }
  for (const key of ['maxTokens', 'maxTokensRetry', 'partitionThresholdTokens', 'charsPerToken', 'partitionConcurrency', 'minCacheableSystemTokens', 'harnessTimeoutMs']) {
    if (!Number.isFinite(config[key]) || config[key] <= 0) throw new TypeError(`${key} debe ser un número positivo`);
  }
  for (const key of ['invalidOutputRetries', 'rescuePasses']) {
    if (!Number.isInteger(config[key]) || config[key] < 0) throw new TypeError(`${key} debe ser un entero mayor o igual a 0`);
  }
  for (const key of ['classifyThinking', 'decomposeThinking']) {
    if (config[key] !== null && config[key] !== 'disabled') throw new TypeError(`${key} debe ser null o «disabled»`);
  }
  if (config.cacheTtl !== '5m' && config.cacheTtl !== '1h') throw new TypeError('cacheTtl debe ser «5m» o «1h»');
  return config;
}
