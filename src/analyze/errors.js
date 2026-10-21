// Errores tipados del analizador. Los resultados de dominio (rechazo, corte, salida inválida) no
// se lanzan: `analyze` los devuelve con `status` (ver index.js). Estos errores son de operación.

export class AnalyzeError extends Error {
  constructor(message, meta = {}) {
    super(message, meta.cause ? { cause: meta.cause } : undefined);
    this.name = this.constructor.name;
    this.code = 'analyze_error';
    // Llamadas al modelo hechas antes del fallo: el núcleo las guarda en llm_calls aunque el trabajo falle.
    this.calls = meta.calls ?? [];
  }
}

/** El bundle no sirve para analizar (sin texto, sin áreas, plantilla ausente). */
export class AnalyzeInputError extends AnalyzeError {
  constructor(message, meta) {
    super(message, meta);
    this.code = 'input';
  }
}

/** Plantilla mal formada: frontmatter ilegible, campos inválidos, límites excedidos. */
export class TemplateError extends AnalyzeError {
  constructor(message, meta = {}) {
    super(message, meta);
    this.code = 'template';
    this.source = meta.source ?? null;
  }
}

/** `claude` no está instalado o no se puede ejecutar (ANALYZER=harness). */
export class HarnessUnavailableError extends AnalyzeError {
  constructor(message, meta = {}) {
    super(message, meta);
    this.code = 'harness_unavailable';
    this.bin = meta.bin ?? null;
  }
}

/** `claude -p` terminó con error, se pasó del plazo o devolvió algo que no es JSON. */
export class HarnessError extends AnalyzeError {
  constructor(message, meta = {}) {
    super(message, meta);
    this.code = 'harness';
    this.exitCode = meta.exitCode ?? null;
    this.stderr = meta.stderr ?? null;
  }
}
