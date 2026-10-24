// Typed provider errors (MASTER-SPEC §7.5 and §7.6).
// The analyzer decides by `code`, never by the message text.

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
    // A refusal or a cut-off still costs tokens: the core stores them in llm_calls.
    this.usage = meta.usage ?? null;
    this.duration_ms = meta.duration_ms ?? null;
  }
}

/** A key, a model or a URL is missing: the call cannot even be assembled. */
export class ProviderConfigError extends ProviderError {
  constructor(message, meta) {
    super(message, meta);
    this.code = 'config';
  }
}

/** Unsuccessful HTTP response or network failure (status 0). */
export class ProviderHttpError extends ProviderError {
  constructor(message, meta = {}) {
    super(message, meta);
    this.code = 'http';
    this.status = meta.status ?? 0;
    this.retryable = meta.retryable ?? false;
    this.retryAfterMs = meta.retryAfterMs ?? null;
    this.body = meta.body ?? null;
    // The account has no balance or quota left (402, or a 429 that says so): waiting does not bring it back, but another provider can still answer.
    this.quota = meta.quota ?? false;
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
 * `stop_reason: "refusal"` (Anthropic) or `content_filter`/`refusal` (compatibles).
 * It is not retried the same way: the refusal tends to repeat (report 02, F4).
 */
export class ProviderRefusalError extends ProviderError {
  constructor(message, meta = {}) {
    super(message, meta);
    this.code = 'refusal';
    this.category = meta.category ?? null;
    this.explanation = meta.explanation ?? null;
  }
}

/** `stop_reason: "max_tokens"` / `finish_reason: "length"`: the output was cut off. */
export class ProviderMaxTokensError extends ProviderError {
  constructor(message, meta = {}) {
    super(message, meta);
    this.code = 'max_tokens';
    this.maxTokens = meta.maxTokens ?? null;
  }
}

/** The response arrived but is not JSON, is empty or does not meet the schema (validated JSON mode). */
export class ProviderOutputError extends ProviderError {
  constructor(message, meta = {}) {
    super(message, meta);
    this.code = 'invalid_output';
    this.raw = meta.raw ?? null;
    this.errors = meta.errors ?? [];
  }
}

/** The provider does not support that input (for example, native PDF on an OpenAI-compatible one). */
export class ProviderUnsupportedError extends ProviderError {
  constructor(message, meta) {
    super(message, meta);
    this.code = 'unsupported';
  }
}
