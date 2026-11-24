import { describe, expect, it, vi } from "vitest";
import { registerBrowserWakeup } from "../../src/background/serviceWorker";
import type { BrowserLike } from "../../src/browser/api";

function eventHarness<Args extends unknown[]>() {
  const listeners = new Set<(...args: Args) => unknown>();
  return {
    event: {
      addListener: vi.fn((listener: (...args: Args) => unknown) => { listeners.add(listener); }),
      removeListener: vi.fn((listener: (...args: Args) => unknown) => { listeners.delete(listener); })
    },
    fire: (...args: Args) => [...listeners].map((listener) => listener(...args))
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

  it.each(["runtime message", "browser event"])("retries failed cold startup on a %s", async (trigger) => {
    vi.resetModules();
    const { startBackground, getBackgroundEngine } = await import("../../src/background/serviceWorker");
    const { DexieStateRepository } = await import("../../src/storage/repository");
    const load = vi.spyOn(DexieStateRepository.prototype, "load")
      .mockRejectedValueOnce(new Error("Database temporarily unavailable"))
      .mockResolvedValue({ windows: [], workspaces: [], tabs: [] });
    const replace = vi.spyOn(DexieStateRepository.prototype, "replace").mockResolvedValue(undefined);
    const message = eventHarness<[unknown, unknown, ((response: unknown) => void)?]>();
    const created = eventHarness<[]>();
    const api: BrowserLike = {
      tabs: { onCreated: created.event },
      windows: { getAll: async () => [{ id: 42, type: "normal", tabs: [] }] },
      runtime: { onMessage: message.event }
    };
    const request = { source: "panekeep-ui", action: "snapshot" };

    try {
      const startup = startBackground({ api });
      const sendFailure = vi.fn();
      expect(message.fire(request, {}, sendFailure)).toEqual([true]);
      await expect(startup).rejects.toThrow("Database temporarily unavailable");
      await vi.waitFor(() => expect(sendFailure).toHaveBeenCalledWith({
        ok: false, error: "Database temporarily unavailable"
      }));
      expect(getBackgroundEngine()).toBeUndefined();
      expect(message.event.removeListener).not.toHaveBeenCalled();
      expect(created.event.removeListener).not.toHaveBeenCalled();

      if (trigger === "browser event") {
        created.fire();
        await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
      }
      const [response] = message.fire(request, {});
      await expect(response).resolves.toMatchObject({
        ok: true, snapshot: { windows: [{ nativeId: 42 }], workspaces: [], tabs: [] }
      });
      expect(load).toHaveBeenCalledTimes(2);
      expect(message.event.addListener).toHaveBeenCalledOnce();
    } finally {
      await getBackgroundEngine()?.stop();
      load.mockRestore();
      replace.mockRestore();
    }
  });
});
