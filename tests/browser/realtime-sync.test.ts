import { afterEach, describe, expect, it, vi } from "vitest";
import { registerStateBroadcast } from "../../src/background/serviceWorker";
import { createBrowserAdapter } from "../../src/ui-state/adapter";
import type { TabFridgeSnapshot } from "../../src/ui-state/model";

const firstSnapshot: TabFridgeSnapshot = {
  windows: [{ key: "window:1", nativeId: 1, name: "窗口 1", order: 0, isCurrent: true, expanded: true }],
  workspaces: [],
  tabs: []
};

const secondSnapshot: TabFridgeSnapshot = {
  ...firstSnapshot,
  tabs: [{
    id: "2",
    windowKey: "window:1",
    workspaceId: null,
    kind: "normal",
    url: "https://example.com",
    title: "Example",
    index: 0,
    pinned: false
  }]
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("real-time browser state bridge", () => {
  it("broadcasts every engine snapshot without failing when no UI receives it", () => {
    let stateListener: ((snapshot: TabFridgeSnapshot) => void) | undefined;
    const sendMessage = vi.fn(() => Promise.reject(new Error("no receiver")));
    const unsubscribe = vi.fn();
    const engine = {
      subscribe(listener: (snapshot: TabFridgeSnapshot) => void) {
        stateListener = listener;
        return unsubscribe;
      }
    };

    const remove = registerStateBroadcast({ tabs: {}, windows: {}, runtime: { sendMessage } }, engine);
    stateListener?.(secondSnapshot);

    expect(sendMessage).toHaveBeenCalledWith({
      source: "tab-fridge-background",
      action: "state.updated",
      snapshot: secondSnapshot
    });
    remove();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("updates subscribers from valid notifications and removes the runtime listener", () => {
    let runtimeListener: ((message: unknown) => unknown) | undefined;
    const removeListener = vi.fn();
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true, result: firstSnapshot, snapshot: firstSnapshot })),
        onMessage: {
          addListener: vi.fn((listener: (message: unknown) => unknown) => {
            runtimeListener = listener;
          }),
          removeListener
        }
      }
    });

    const adapter = createBrowserAdapter();
    const snapshots: TabFridgeSnapshot[] = [];
    const unsubscribe = adapter.subscribe?.((snapshot) => snapshots.push(snapshot));

    runtimeListener?.({ source: "unrelated", action: "state.updated", snapshot: secondSnapshot });
    expect(snapshots).toHaveLength(0);

    runtimeListener?.({
      source: "tab-fridge-background",
      action: "state.updated",
      snapshot: secondSnapshot
    });
    expect(snapshots).toEqual([secondSnapshot]);

    unsubscribe?.();
    expect(removeListener).toHaveBeenCalledWith(runtimeListener);
  });
});
