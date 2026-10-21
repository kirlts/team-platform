// Typed analyzer errors. Domain results (refusal, cut-off, invalid output) are not
// thrown: `analyze` returns them with `status` (see index.js). These errors are operational.

export class AnalyzeError extends Error {
  constructor(message, meta = {}) {
    super(message, meta.cause ? { cause: meta.cause } : undefined);
    this.name = this.constructor.name;
    this.code = 'analyze_error';
    // Model calls made before the failure: the core stores them in llm_calls even if the job fails.
    this.calls = meta.calls ?? [];
  }
}

/** The bundle cannot be analyzed (no text, no areas, missing template). */
export class AnalyzeInputError extends AnalyzeError {
  constructor(message, meta) {
    super(message, meta);
    this.code = 'input';
  }
}

/** Malformed template: unreadable frontmatter, invalid fields, limits exceeded. */
export class TemplateError extends AnalyzeError {
  constructor(message, meta = {}) {
    super(message, meta);
    this.code = 'template';
    this.source = meta.source ?? null;
  }
}

/** `claude` is not installed or cannot be run (ANALYZER=harness). */
export class HarnessUnavailableError extends AnalyzeError {
  constructor(message, meta = {}) {
    super(message, meta);
    this.code = 'harness_unavailable';
    this.bin = meta.bin ?? null;
  }
}

/** `claude -p` ended with an error, ran past its deadline or returned something that is not JSON. */
export class HarnessError extends AnalyzeError {
  constructor(message, meta = {}) {
    super(message, meta);
    this.code = 'harness';
    this.exitCode = meta.exitCode ?? null;
    this.stderr = meta.stderr ?? null;
  }
}
