/**
 * A small browser API adapter keeps the state engine independent from whether
 * WXT exposes the promise based `browser` namespace or Chromium's `chrome`
 * namespace. It also makes the engine straightforward to exercise with a
 * fake API in unit/integration tests.
 */

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
}

export function getBrowserApi(source?: BrowserLike): BrowserLike {
  if (source) return source;
  const scope = globalThis as unknown as { browser?: BrowserLike; chrome?: BrowserLike };
  const candidate = scope.browser ?? scope.chrome;
  if (!candidate) throw new Error("Tab Fridge browser API is unavailable");
  return candidate;
}

/** Invoke either a promise-style or callback-style WebExtension API method. */
export async function invokeBrowser<T>(
  owner: Record<string, any> | undefined,
  methodName: string,
  ...args: any[]
): Promise<T> {
  const method = owner?.[methodName];
  if (typeof method !== "function") {
    throw new Error(`Browser API method is unavailable: ${methodName}`);
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

    try {
      const result = method.call(owner, ...args, finish);
      if (result && typeof result.then === "function") {
        result.then(finish, (error: unknown) => {
          // Some implementations reject when a callback is supplied. Retry
          // once in their native promise form.
          if (settled) return;
          try {
            const retry = method.call(owner, ...args);
            if (retry && typeof retry.then === "function") retry.then(finish, fail);
            else if (retry !== undefined) finish(retry as T);
            else fail(error);
          } catch (retryError) {
            fail(retryError);
          }
        });
      } else if (result !== undefined) {
        finish(result as T);
      }
      // A callback API resolves through finish. An API that returns undefined
      // without invoking its callback is considered failed after its own
      // implementation reports an error; there is no safe second mutation.
    } catch (error) {
      try {
        const retry = method.call(owner, ...args);
        if (retry && typeof retry.then === "function") retry.then(finish, fail);
        else if (retry !== undefined) finish(retry as T);
        else fail(error);
      } catch (retryError) {
        fail(retryError);
      }
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

