import { addBrowserListener, getBrowserApi, type BrowserLike } from "../browser/api";
import { BrowserStateEngine } from "../browser/stateEngine";
import { isBackgroundRequest } from "../shared/messages";

let engine: BrowserStateEngine | undefined;
let startPromise: Promise<BrowserStateEngine> | undefined;
let runtimeHandlersRegistered = false;
let removeRuntimeHandlers: Array<() => void> = [];

/** Starts the singleton MV3 service-worker state engine. */
export function startBackground(options: { api?: BrowserLike } = {}): Promise<BrowserStateEngine> {
  if (startPromise) return startPromise;
  startPromise = (async () => {
    const api = options.api ?? getBrowserApi();
    engine = new BrowserStateEngine({ api });
    registerRuntimeHandlers(api, engine);
    await engine.start();
    return engine;
  })().catch((error) => {
    for (const remove of removeRuntimeHandlers.splice(0)) remove();
    runtimeHandlersRegistered = false;
    startPromise = undefined;
    engine = undefined;
    throw error;
  });
  return startPromise;
}

export function getBackgroundEngine(): BrowserStateEngine | undefined {
  return engine;
}

function registerRuntimeHandlers(api: BrowserLike, stateEngine: BrowserStateEngine): void {
  if (runtimeHandlersRegistered || !api.runtime) return;
  runtimeHandlersRegistered = true;

  removeRuntimeHandlers.push(addBrowserListener(api.runtime.onMessage, (message: unknown, _sender: unknown, sendResponse?: (response: unknown) => void) => {
    const uiMessage = isUiMessage(message) ? message : undefined;
    if (!isBackgroundRequest(message) && !uiMessage) return false;
    const work = startPromise
      ?.then(() => isBackgroundRequest(message)
        ? stateEngine.handleRequest(message)
        : stateEngine.handleUiAction(uiMessage as { source?: string; action: string; payload?: unknown }))
      .then((response) => {
        if (sendResponse) sendResponse(response);
        return response;
      })
      .catch((error: unknown) => {
        const response = { ok: false, error: error instanceof Error ? error.message : String(error) };
        if (sendResponse) sendResponse(response);
        return response;
      });
    // Callback-style Chromium keeps the channel open; promise-style browsers
    // receive the same Promise directly.
    return sendResponse ? true : work;
  }));

  removeRuntimeHandlers.push(addBrowserListener(api.runtime.onSuspend, () => {
    void stateEngine.flush();
  }));
}

function isUiMessage(value: unknown): value is { source?: string; action: string; payload?: unknown } {
  return typeof value === "object"
    && value !== null
    && "action" in value
    && typeof (value as { action?: unknown }).action === "string";
}
