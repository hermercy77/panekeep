import { afterEach, describe, expect, it, vi } from "vitest";
import { registerStateBroadcast } from "../../src/background/serviceWorker";
import { createBrowserAdapter } from "../../src/ui-state/adapter";
import type { PaneKeepSnapshot } from "../../src/ui-state/model";

const firstSnapshot: PaneKeepSnapshot = {
  windows: [{ key: "window:1", nativeId: 1, name: "窗口 1", order: 0, isCurrent: true, expanded: true }],
  workspaces: [],
  tabs: []
};

const secondSnapshot: PaneKeepSnapshot = {
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
    let stateListener: ((snapshot: PaneKeepSnapshot) => void) | undefined;
    const sendMessage = vi.fn(() => Promise.reject(new Error("no receiver")));
    const unsubscribe = vi.fn();
    const engine = {
      subscribe(listener: (snapshot: PaneKeepSnapshot) => void) {
        stateListener = listener;
        return unsubscribe;
      }
    };

    const remove = registerStateBroadcast({ tabs: {}, windows: {}, runtime: { sendMessage } }, engine);
    stateListener?.(secondSnapshot);

    expect(sendMessage).toHaveBeenCalledWith({
      source: "panekeep-background",
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
    const snapshots: PaneKeepSnapshot[] = [];
    const unsubscribe = adapter.subscribe?.((snapshot) => snapshots.push(snapshot));

    runtimeListener?.({ source: "unrelated", action: "state.updated", snapshot: secondSnapshot });
    expect(snapshots).toHaveLength(0);

    runtimeListener?.({
      source: "panekeep-background",
      action: "state.updated",
      snapshot: secondSnapshot
    });
    expect(snapshots).toEqual([secondSnapshot]);

    unsubscribe?.();
    expect(removeListener).toHaveBeenCalledWith(runtimeListener);
  });
});
