import {
  AIAbortError,
  AIError,
  AIHttpError,
  AINetworkError,
  AIRateLimitError,
  AIServerError,
  AITimeoutError
} from "./errors";
import { getAppLanguage, translate } from "../i18n";

export interface AIResponseLike {
  readonly ok: boolean;
  readonly status: number;
  readonly headers?: Pick<Headers, "get">;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
}

export type AIFetch = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  }
) => Promise<AIResponseLike>;

export interface RetryOptions {
  /** Maximum number of retries after the initial request. Defaults to one. */
  maxRetries?: number;
  /** Delay between attempts. Kept at zero by default so UI callers stay responsive. */
  retryDelayMs?: number;
  /** Per-attempt timeout. Defaults to 30 seconds. */
  timeoutMs?: number;
  /** Absolute deadline shared across attempts, in milliseconds since the Unix epoch. */
  deadlineAt?: number;
  signal?: AbortSignal;
}

function isAbortException(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

function trimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Returns the provider's own error wording from a response body, or undefined
 * when the body carries none. Gateways report failures as `{error:{message}}`,
 * as a plain string in `error` (Cline), or as a `{code, message}` pair.
 */
export function explicitProviderError(body: string): string | undefined {
  if (!body) return undefined;
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as { error?: unknown; message?: unknown };
      const providerError = record.error;
      if (typeof providerError === "object" && providerError !== null) {
        const nested = trimmedString((providerError as { message?: unknown }).message);
        if (nested && nested.length < 500) return nested;
      }
      const direct = trimmedString(providerError) ?? trimmedString(record.message);
      if (direct && direct.length < 500) return direct;
    }
  } catch {
    // Error bodies are diagnostic only; the status-specific error remains useful.
  }
  return undefined;
}

function providerErrorMessage(body: string): string {
  const explicit = explicitProviderError(body);
  if (explicit) return explicit;
  return body ? body.slice(0, 500) : translate(getAppLanguage(), "ai.providerError");
}

function statusError(response: AIResponseLike): AIError {
  const status = response.status;
  if (status === 429) return new AIRateLimitError(undefined, status);
  if (status >= 500 && status <= 599) return new AIServerError(undefined, status);
  return new AIHttpError(translate(getAppLanguage(), "ai.httpError", { status }), status);
}

async function bufferResponse(response: AIResponseLike): Promise<AIResponseLike> {
  if (response.text) {
    const body = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      headers: response.headers,
      text: async () => body,
      json: async () => JSON.parse(body) as unknown
    };
  }
  if (response.json) {
    const value = await response.json();
    const body = JSON.stringify(value);
    return {
      ok: response.ok,
      status: response.status,
      headers: response.headers,
      text: async () => body,
      json: async () => value
    };
  }
  return response;
}

async function withBodyMessage(error: AIError, response: AIResponseLike): Promise<AIError> {
  if (!response.text) return error;
  try {
    const body = await response.text();
    if (body) {
      const message = providerErrorMessage(body);
      if (error instanceof AIRateLimitError) return new AIRateLimitError(message, error.status ?? 429);
      if (error instanceof AIServerError) return new AIServerError(message, error.status ?? 500);
      if (error instanceof AIHttpError) return new AIHttpError(message, error.status ?? 0);
    }
  } catch {
    // Keep the status error when the provider error body cannot be read.
  }
  return error;
}

function retryAfterDelay(response: AIResponseLike): number | undefined {
  const value = response.headers?.get("Retry-After")?.trim();
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value) * 1_000;
  const retryAt = Date.parse(value);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - Date.now()) : undefined;
}

function wait(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new AIAbortError());
  if (delayMs <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    const abort = () => {
      clearTimeout(timer);
      reject(new AIAbortError());
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/**
 * Execute a request with one retry for network errors, timeouts, 429 and 5xx.
 * Other HTTP errors are returned immediately and caller aborts are never retried.
 */
export async function fetchWithRetry(
  fetchImpl: AIFetch,
  input: string,
  init: Omit<NonNullable<Parameters<AIFetch>[1]>, "signal"> = {},
  options: RetryOptions = {}
): Promise<AIResponseLike> {
  const maxRetries = Math.max(0, Math.floor(options.maxRetries ?? 1));
  const timeoutMs = Math.max(1, Math.floor(options.timeoutMs ?? 30_000));
  const retryDelayMs = Math.max(0, Math.floor(options.retryDelayMs ?? 0));
  const deadlineAt = options.deadlineAt ?? Date.now() + (maxRetries + 1) * timeoutMs + maxRetries * retryDelayMs;

  for (let attempt = 0; ; attempt += 1) {
    if (options.signal?.aborted) throw new AIAbortError();
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) throw new AITimeoutError();

    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let rejectCancellation: ((error: AIError) => void) | undefined;
    const cancellation = new Promise<never>((_, reject) => {
      rejectCancellation = reject;
      timeout = setTimeout(() => {
        controller.abort();
        reject(new AITimeoutError());
      }, Math.min(timeoutMs, remainingMs));
    });
    const onParentAbort = () => {
      controller.abort();
      rejectCancellation?.(new AIAbortError());
    };
    options.signal?.addEventListener("abort", onParentAbort, { once: true });

    let error: AIError;
    let delayMs = retryDelayMs;
    try {
      const response = await Promise.race([
        fetchImpl(input, { ...init, signal: controller.signal }).then(bufferResponse),
        cancellation
      ]);
      if (response.ok || (response.status >= 200 && response.status < 300)) return response;
      error = await withBodyMessage(statusError(response), response);
      if (response.status === 429) delayMs = retryAfterDelay(response) ?? retryDelayMs;
    } catch (cause) {
      if (options.signal?.aborted) throw new AIAbortError(undefined, cause);
      if (cause instanceof AIError) error = cause;
      else if (isAbortException(cause)) error = new AITimeoutError(undefined, cause);
      else error = new AINetworkError(translate(getAppLanguage(), "ai.networkError"), cause);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onParentAbort);
    }
    if (!error.retryable || attempt >= maxRetries || delayMs >= deadlineAt - Date.now()) throw error;
    await wait(delayMs, options.signal);
  }
}

export async function retryOperation<T>(
  operation: (attempt: number) => Promise<T>,
  options: Pick<RetryOptions, "maxRetries" | "retryDelayMs" | "signal"> = {}
): Promise<T> {
  const maxRetries = Math.max(0, Math.floor(options.maxRetries ?? 1));
  const retryDelayMs = Math.max(0, Math.floor(options.retryDelayMs ?? 0));

  for (let attempt = 0; ; attempt += 1) {
    if (options.signal?.aborted) throw new AIAbortError();
    try {
      return await operation(attempt);
    } catch (error) {
      if (options.signal?.aborted) throw new AIAbortError(undefined, error);
      const normalized = error instanceof AIError ? error : new AINetworkError(translate(getAppLanguage(), "ai.operationFailed"), error);
      if (!normalized.retryable || attempt >= maxRetries) throw normalized;
      await wait(retryDelayMs, options.signal);
    }
  }
}
