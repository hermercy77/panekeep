import { addBrowserListener, getBrowserApi, invokeBrowser, type BrowserLike } from "../browser/api";
import { BrowserStateEngine } from "../browser/stateEngine";
import {
  BACKGROUND_MESSAGE_SOURCE,
  STATE_UPDATED_ACTION,
  isBackgroundRequest,
  isUiActionMessage
} from "../shared/messages";
import { initializeAppLanguage, subscribeAppLanguage, translate, type AppLanguage } from "../i18n";

let engine: BrowserStateEngine | undefined;
let startPromise: Promise<BrowserStateEngine> | undefined;
let runtimeHandlersRegistered = false;
let wakeHandlersRegistered = false;
let backgroundReady = false;
const removeEngineHandlers: Array<() => void> = [];

/** Starts the singleton MV3 service-worker state engine. */
export function startBackground(options: { api?: BrowserLike } = {}): Promise<BrowserStateEngine> {
  if (startPromise) return startPromise;
  const api = options.api ?? getBrowserApi();
  const stateEngine = new BrowserStateEngine({ api });
  engine = stateEngine;
  const startup = (async () => {
    const language = await initializeAppLanguage();
    await configureSidePanelAction(api, language);
    removeEngineHandlers.push(subscribeAppLanguage((next) => {
      void configureActionTitle(api, next);
    }));
    await stateEngine.start();
    removeEngineHandlers.push(registerStateBroadcast(api, stateEngine));
    backgroundReady = true;
    return stateEngine;
  })().catch((error) => {
    for (const remove of removeEngineHandlers.splice(0)) remove();
    backgroundReady = false;
    startPromise = undefined;
    engine = undefined;
    throw error;
  });
  startPromise = startup;
  void startup.catch(() => undefined);
  registerRuntimeHandlers(api);
  if (!wakeHandlersRegistered) {
    wakeHandlersRegistered = true;
    registerBrowserWakeup(api, () => {
      if (backgroundReady) return;
      void startBackground({ api }).then((activeEngine) => activeEngine.syncFromBrowser()).catch(() => undefined);
    });
  }
  return startup;
}

async function configureActionTitle(api: BrowserLike, language: AppLanguage): Promise<void> {
  if (typeof api.action?.setTitle !== "function") return;
  try {
    await invokeBrowser<void>(api.action, "setTitle", { title: translate(language, "extension.actionTitle") });
  } catch {
    // The manifest-localized title remains available on browsers without this API.
  }
}

async function configureSidePanelAction(api: BrowserLike, language: AppLanguage): Promise<void> {
  await configureActionTitle(api, language);
  if (typeof api.sidePanel?.setPanelBehavior !== "function") return;
  try {
    await invokeBrowser<void>(api.sidePanel, "setPanelBehavior", { openPanelOnActionClick: true });
  } catch (error) {
    console.warn("PaneKeep could not enable toolbar side-panel toggling", error);
  }
}

export function getBackgroundEngine(): BrowserStateEngine | undefined {
  return engine;
}

function registerRuntimeHandlers(api: BrowserLike): void {
  if (runtimeHandlersRegistered || !api.runtime) return;
  runtimeHandlersRegistered = true;

  addBrowserListener(api.runtime.onMessage, (message: unknown, _sender: unknown, sendResponse?: (response: unknown) => void) => {
    const uiMessage = isUiActionMessage(message) ? message : undefined;
    if (!isBackgroundRequest(message) && !uiMessage) return false;
    const work = startBackground({ api })
      .then((stateEngine) => isBackgroundRequest(message)
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
  });

  addBrowserListener(api.runtime.onSuspend, () => {
    void engine?.flush().catch(() => undefined);
  });
}

export function registerStateBroadcast(
  api: BrowserLike,
  stateEngine: Pick<BrowserStateEngine, "subscribe">
): () => void {
  if (typeof api.runtime?.sendMessage !== "function") return () => undefined;
  return stateEngine.subscribe((snapshot) => {
    try {
      const pending = api.runtime?.sendMessage({
        source: BACKGROUND_MESSAGE_SOURCE,
        action: STATE_UPDATED_ACTION,
        snapshot
      });
      if (pending && typeof pending.catch === "function") {
        void pending.catch(() => undefined);
      }
    } catch {
      // The side panel may be closed. Browser events should still be persisted,
      // and the next opened UI will fetch the latest snapshot normally.
    }
  });
}

export function registerBrowserWakeup(api: BrowserLike, onWake: () => void): () => void {
  const events = [
    api.tabs?.onCreated,
    api.tabs?.onRemoved,
    api.tabs?.onUpdated,
    api.tabs?.onMoved,
    api.tabs?.onActivated,
    api.tabs?.onAttached,
    api.tabs?.onDetached,
    api.tabs?.onReplaced,
    api.windows?.onCreated,
    api.windows?.onRemoved,
    api.windows?.onFocusChanged,
    api.tabGroups?.onCreated,
    api.tabGroups?.onRemoved,
    api.tabGroups?.onUpdated,
    api.tabGroups?.onMoved
  ];
  const removers = events.map((event) => addBrowserListener(event, onWake));
  return () => removers.forEach((remove) => remove());
}
