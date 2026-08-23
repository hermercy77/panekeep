import { describe, expect, it, vi } from "vitest";
import { registerBrowserWakeup } from "../../src/background/serviceWorker";
import type { BrowserLike } from "../../src/browser/api";

function eventHarness() {
  let listener: (() => void) | undefined;
  return {
    event: {
      addListener: vi.fn((next: () => void) => { listener = next; }),
      removeListener: vi.fn()
    },
    fire: () => listener?.()
  };
}

describe("MV3 browser wakeup listeners", () => {
  it("registers tab events synchronously and removes them on cleanup", () => {
    const created = eventHarness();
    const removed = eventHarness();
    const onWake = vi.fn();
    const api = {
      tabs: { onCreated: created.event, onRemoved: removed.event },
      windows: {}
    } as unknown as BrowserLike;

    const cleanup = registerBrowserWakeup(api, onWake);
    expect(created.event.addListener).toHaveBeenCalledOnce();
    expect(removed.event.addListener).toHaveBeenCalledOnce();
    created.fire();
    removed.fire();
    expect(onWake).toHaveBeenCalledTimes(2);

    cleanup();
    expect(created.event.removeListener).toHaveBeenCalledOnce();
    expect(removed.event.removeListener).toHaveBeenCalledOnce();
  });
});
