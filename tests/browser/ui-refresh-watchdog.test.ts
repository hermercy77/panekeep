import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserAdapter } from "../../src/ui-state/adapter";
import type { TabFridgeSnapshot } from "../../src/ui-state/model";

const snapshot: TabFridgeSnapshot = {
  windows: [{ key: "window:1", nativeId: 1, name: "窗口 1", order: 0, isCurrent: true, expanded: true }],
  workspaces: [],
  tabs: []
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup() {
  let tabListener: (() => void) | undefined;
  let runtimeListener: ((message: unknown) => unknown) | undefined;
  const sendMessage = vi.fn(async () => ({ ok: true, result: snapshot, snapshot }));
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage,
      onMessage: {
        addListener: vi.fn((listener: (message: unknown) => unknown) => { runtimeListener = listener; }),
        removeListener: vi.fn()
      }
    },
    tabs: {
      onCreated: {
        addListener: vi.fn((listener: () => void) => { tabListener = listener; }),
        removeListener: vi.fn()
      }
    }
  });
  const unsubscribe = createBrowserAdapter().subscribe?.(() => undefined);
  return { sendMessage, tabListener: () => tabListener?.(), runtimeListener: (message: unknown) => runtimeListener?.(message), unsubscribe };
}

describe("UI refresh watchdog", () => {
  it("rescans when a browser event is not followed by a background broadcast", async () => {
    vi.useFakeTimers();
    const harness = setup();
    harness.tabListener();
    await vi.advanceTimersByTimeAsync(400);
    expect(harness.sendMessage).toHaveBeenCalledWith({ source: "tab-fridge-ui", action: "refresh", payload: undefined });
    harness.unsubscribe?.();
  });

  it("cancels the rescan when the background broadcasts first", async () => {
    vi.useFakeTimers();
    const harness = setup();
    harness.tabListener();
    harness.runtimeListener({ source: "tab-fridge-background", action: "state.updated", snapshot });
    await vi.advanceTimersByTimeAsync(400);
    expect(harness.sendMessage).not.toHaveBeenCalled();
    harness.unsubscribe?.();
  });
});
