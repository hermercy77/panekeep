import {
  AIAbortError,
  AIError,
  AIHttpError,
  AINetworkError,
  AIRateLimitError,
  AIServerError,
  AITimeoutError
} from "./errors";

export interface AIResponseLike {
  readonly ok: boolean;
  readonly status: number;
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

function providerErrorMessage(body: string): string {
  if (!body) return "AI provider returned an error";
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === "object" && parsed !== null && "error" in parsed) {
      const providerError = (parsed as { error?: unknown }).error;
      if (typeof providerError === "object" && providerError !== null && "message" in providerError) {
        const message = (providerError as { message?: unknown }).message;
        if (typeof message === "string" && message.length < 500) return message;
      }
    }
  } catch {
    // Error bodies are diagnostic only; the status-specific error remains useful.
  }
  return body.slice(0, 500);
}

function statusError(response: AIResponseLike): AIError {
  const status = response.status;
  if (status === 429) return new AIRateLimitError(undefined, status);
  if (status >= 500 && status <= 599) return new AIServerError(undefined, status);
  return new AIHttpError(`AI provider returned HTTP ${status}`, status);
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

function wait(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
      timer = undefined;
      resolve();
    }, delayMs);
    const abort = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      reject(new AIAbortError());
    };
    if (signal?.aborted) {
      abort();
      return;
    }
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

  for (let attempt = 0; ; attempt += 1) {
    if (options.signal?.aborted) throw new AIAbortError();

    const controller = new AbortController();
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onParentAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onParentAbort, { once: true });

    try {
      const response = await fetchImpl(input, { ...init, signal: controller.signal });
      if (response.ok || (response.status >= 200 && response.status < 300)) return response;
      const error = await withBodyMessage(statusError(response), response);
      if (!error.retryable || attempt >= maxRetries) throw error;
      await wait(retryDelayMs, options.signal);
    } catch (error) {
      if (options.signal?.aborted) throw new AIAbortError(undefined, error);
      if (timedOut || isAbortException(error)) {
        const timeoutError = new AITimeoutError(undefined, error);
        if (attempt >= maxRetries) throw timeoutError;
        await wait(retryDelayMs, options.signal);
        continue;
      }
      if (error instanceof AIError) {
        if (!error.retryable || attempt >= maxRetries) throw error;
        await wait(retryDelayMs, options.signal);
        continue;
      }
      const networkError = new AINetworkError("Unable to reach AI provider", error);
      if (attempt >= maxRetries) throw networkError;
      await wait(retryDelayMs, options.signal);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      timeout = undefined;
      options.signal?.removeEventListener("abort", onParentAbort);
    }
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
      const normalized = error instanceof AIError ? error : new AINetworkError("AI operation failed", error);
      if (!normalized.retryable || attempt >= maxRetries) throw normalized;
      await wait(retryDelayMs, options.signal);
    }
  }
}
