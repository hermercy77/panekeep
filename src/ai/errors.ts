/** Errors raised by the local AI pipeline. */
import { getAppLanguage, translate } from "../i18n";

export type AIErrorCode =
  | "configuration"
  | "network"
  | "timeout"
  | "rate_limit"
  | "server"
  | "http"
  | "invalid_json"
  | "validation"
  | "conflict"
  | "aborted";

export class AIError extends Error {
  readonly code: AIErrorCode;
  readonly retryable: boolean;
  readonly status?: number;
  readonly cause?: unknown;

  constructor(
    message: string,
    code: AIErrorCode,
    options: { retryable?: boolean; status?: number; cause?: unknown } = {}
  ) {
    super(message);
    this.name = "AIError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.status = options.status;
    this.cause = options.cause;
  }
}

export class AIConfigError extends AIError {
  constructor(message: string, cause?: unknown) {
    super(message, "configuration", { cause });
    this.name = "AIConfigError";
  }
}

export class AINetworkError extends AIError {
  constructor(message: string, cause?: unknown) {
    super(message, "network", { retryable: true, cause });
    this.name = "AINetworkError";
  }
}

export class AITimeoutError extends AIError {
  constructor(message = translate(getAppLanguage(), "ai.requestTimedOut"), cause?: unknown) {
    super(message, "timeout", { retryable: true, cause });
    this.name = "AITimeoutError";
  }
}

export class AIRateLimitError extends AIError {
  constructor(message = translate(getAppLanguage(), "ai.rateLimited"), status = 429, cause?: unknown) {
    super(message, "rate_limit", { retryable: true, status, cause });
    this.name = "AIRateLimitError";
  }
}

export class AIServerError extends AIError {
  constructor(message = translate(getAppLanguage(), "ai.serverError"), status = 500, cause?: unknown) {
    super(message, "server", { retryable: true, status, cause });
    this.name = "AIServerError";
  }
}

export class AIHttpError extends AIError {
  constructor(message: string, status: number, cause?: unknown) {
    super(message, "http", { status, cause });
    this.name = "AIHttpError";
  }
}

export class AIInvalidJsonError extends AIError {
  constructor(message = translate(getAppLanguage(), "ai.invalidJson"), cause?: unknown) {
    super(message, "invalid_json", { cause });
    this.name = "AIInvalidJsonError";
  }
}

export class AIValidationError extends AIError {
  readonly issues: readonly unknown[];

  constructor(message: string, issues: readonly unknown[] = [], cause?: unknown) {
    super(message, "validation", { cause });
    this.name = "AIValidationError";
    this.issues = issues;
  }
}

export class AISnapshotConflictError extends AIError {
  constructor(message = translate(getAppLanguage(), "ai.tabsChanged"), cause?: unknown) {
    super(message, "conflict", { cause });
    this.name = "AISnapshotConflictError";
  }
}

/** Backwards-friendly short name used by callers handling optimistic updates. */
export class AIConflictError extends AISnapshotConflictError {
  constructor(message = translate(getAppLanguage(), "ai.tabsChanged"), cause?: unknown) {
    super(message, cause);
    this.name = "AIConflictError";
  }
}

export class AIAbortError extends AIError {
  constructor(message = translate(getAppLanguage(), "ai.requestAborted"), cause?: unknown) {
    super(message, "aborted", { cause });
    this.name = "AIAbortError";
  }
}

export function isAIError(error: unknown): error is AIError {
  return error instanceof AIError;
}
