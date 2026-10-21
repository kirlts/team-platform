// Errores tipados de los proveedores (MASTER-SPEC §7.5 y §7.6).
// El analizador decide por `code`, nunca por el texto del mensaje.

export class ProviderError extends Error {
  /**
   * @param {string} message
   * @param {{provider?: string, model?: string, usage?: object, duration_ms?: number, cause?: unknown}} [meta]
   */
  constructor(message, meta = {}) {
    super(message, meta.cause ? { cause: meta.cause } : undefined);
    this.name = this.constructor.name;
    this.code = 'provider_error';
    this.provider = meta.provider ?? null;
    this.model = meta.model ?? null;
    // Un rechazo o un corte igual cuestan tokens: el núcleo los guarda en llm_calls.
    this.usage = meta.usage ?? null;
    this.duration_ms = meta.duration_ms ?? null;
  }
}

/** Falta una llave, un modelo o una URL: no se puede ni armar la llamada. */
export class ProviderConfigError extends ProviderError {
  constructor(message, meta) {
    super(message, meta);
    this.code = 'config';
  }
}

/** Respuesta HTTP no exitosa o fallo de red (status 0). */
export class ProviderHttpError extends ProviderError {
  constructor(message, meta = {}) {
    super(message, meta);
    this.code = 'http';
    this.status = meta.status ?? 0;
    this.retryable = meta.retryable ?? false;
    this.retryAfterMs = meta.retryAfterMs ?? null;
    this.body = meta.body ?? null;
  }
}

export class ProviderTimeoutError extends ProviderError {
  constructor(message, meta = {}) {
    super(message, meta);
    this.code = 'timeout';
    this.timeoutMs = meta.timeoutMs ?? null;
  }
}

/**
 * `stop_reason: "refusal"` (Anthropic) o `content_filter`/`refusal` (compatibles).
 * No se reintenta igual: el rechazo suele repetirse (informe 02, F4).
 */
export class ProviderRefusalError extends ProviderError {
  constructor(message, meta = {}) {
    super(message, meta);
    this.code = 'refusal';
    this.category = meta.category ?? null;
    this.explanation = meta.explanation ?? null;
  }
}

/** `stop_reason: "max_tokens"` / `finish_reason: "length"`: la salida quedó cortada. */
export class ProviderMaxTokensError extends ProviderError {
  constructor(message, meta = {}) {
    super(message, meta);
    this.code = 'max_tokens';
    this.maxTokens = meta.maxTokens ?? null;
  }
}

/** La respuesta llegó pero no es JSON, está vacía o no cumple el esquema (modo JSON validado). */
export class ProviderOutputError extends ProviderError {
  constructor(message, meta = {}) {
    super(message, meta);
    this.code = 'invalid_output';
    this.raw = meta.raw ?? null;
    this.errors = meta.errors ?? [];
  }
}

/** El proveedor no admite esa entrada (por ejemplo, PDF nativo en un compatible con OpenAI). */
export class ProviderUnsupportedError extends ProviderError {
  constructor(message, meta) {
    super(message, meta);
    this.code = 'unsupported';
  }
}
