/**
 * A small browser API adapter keeps the state engine independent from whether
 * WXT exposes the promise based `browser` namespace or Chromium's `chrome`
 * namespace. It also makes the engine straightforward to exercise with a
 * fake API in unit/integration tests.
 */
import { getAppLanguage, translate } from "../i18n";

export type BrowserEvent = {
  addListener?: (listener: (...args: any[]) => unknown) => void;
  removeListener?: (listener: (...args: any[]) => unknown) => void;
};

export interface BrowserLike {
  tabs: Record<string, any>;
  windows: Record<string, any>;
  tabGroups?: Record<string, any>;
  runtime?: Record<string, any>;
  sidePanel?: Record<string, any>;
  action?: Record<string, any>;
}

export function getBrowserApi(source?: BrowserLike): BrowserLike {
  if (source) return source;
  const scope = globalThis as unknown as { browser?: BrowserLike; chrome?: BrowserLike };
  const candidate = scope.browser ?? scope.chrome;
  if (!candidate) throw new Error(translate(getAppLanguage(), "browser.unavailable"));
  return candidate;
}

export function isBrowserSignatureError(error: unknown): boolean {
  const message = typeof error === "object" && error !== null && "message" in error
    ? String(error.message)
    : String(error);
  return /no matching signature|invalid (?:method )?(?:signature|invocation)|(?:signature|invocation) mismatch/i.test(message)
    || /too many arguments|unexpected number of arguments|expected (?:at (?:most|least) )?\d+ arguments?/i.test(message)
    || /callbacks?(?: argument| parameter)? (?:(?:is|are) )?(?:required|not (?:a function|allowed|supported|accepted))/i.test(message)
    || /(?:unexpected|invalid|missing) callback|(?:cannot|does not) accept (?:a )?callback/i.test(message);
}

export function getBrowserLastError(): Error | undefined {
  const lastError = (globalThis as typeof globalThis & {
    chrome?: { runtime?: { lastError?: { message?: string } } };
  }).chrome?.runtime?.lastError;
  return lastError ? new Error(lastError.message || translate(getAppLanguage(), "error.generic")) : undefined;
}

/** Invoke either a promise-style or callback-style WebExtension API method. */
export async function invokeBrowser<T>(
  owner: Record<string, any> | undefined,
  methodName: string,
  ...args: any[]
): Promise<T> {
  const method = owner?.[methodName];
  if (typeof method !== "function") {
    throw new Error(translate(getAppLanguage(), "browser.methodUnavailable", { method: methodName }));
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (value: T): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const callback = (value: T): void => {
      const error = getBrowserLastError();
      if (error) fail(error);
      else finish(value);
    };
    const retryWithoutCallback = (error: unknown): void => {
      if (settled) return;
      if (!isBrowserSignatureError(error)) {
        fail(error);
        return;
      }
      try {
        const retry = method.call(owner, ...args);
        if (retry && typeof retry.then === "function") retry.then(finish, fail);
        else if (retry !== undefined) finish(retry as T);
        else fail(error);
      } catch (retryError) {
        fail(retryError);
      }
    };

    try {
      const result = method.call(owner, ...args, callback);
      if (result && typeof result.then === "function") {
        result.then(finish, retryWithoutCallback);
      } else if (result !== undefined) {
        finish(result as T);
      }
    } catch (error) {
      retryWithoutCallback(error);
    }
  });
}

export function addBrowserListener(
  event: BrowserEvent | undefined,
  listener: (...args: any[]) => unknown
): () => void {
  if (!event?.addListener) return () => undefined;
  event.addListener(listener);
  return () => event.removeListener?.(listener);
}
