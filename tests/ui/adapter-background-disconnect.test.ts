import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserAdapter } from "../../src/ui-state/adapter";
import { setAppLanguage } from "../../src/i18n";

afterEach(async () => {
  delete (globalThis as typeof globalThis & { chrome?: unknown }).chrome;
  await setAppLanguage("zh-CN");
});

describe("createBrowserAdapter background disconnect safety", () => {
  it("rejects write operations instead of silently falling back to in-memory state when background disconnects", async () => {
    const initialSnapshot = {
      windows: [{ key: "window:1", nativeId: 1, name: "Window 1", order: 0, isCurrent: true, expanded: true }],
      workspaces: [],
      tabs: []
    };
    const sendMessage = vi.fn(async (message: { action?: string }) => {
      if (message.action === "refresh") {
        return { ok: true, result: initialSnapshot, snapshot: initialSnapshot };
      }
      throw new Error("Could not establish connection. Receiving end does not exist.");
    });

    (globalThis as typeof globalThis & { chrome?: unknown }).chrome = {
      runtime: {
        sendMessage,
        onMessage: { addListener: () => undefined, removeListener: () => undefined }
      }
    };

    const adapter = createBrowserAdapter();
    expect(await adapter.getSnapshot()).toEqual(initialSnapshot);

    await expect(adapter.createWorkspace({
      windowKey: "window:1",
      name: "Should fail",
      description: "",
      tags: [],
      color: "blue",
      icon: "folder"
    })).rejects.toThrow("后台服务暂时不可用，请刷新或重试");

    await expect(adapter.deleteWorkspace("workspace:1")).rejects.toThrow("后台服务暂时不可用");
    await expect(adapter.moveTab("tab-1", null)).rejects.toThrow("后台服务暂时不可用");

    // Cached snapshot must remain unchanged after failed writes.
    expect((await adapter.getSnapshot()).workspaces).toEqual([]);
  });

  it("uses localized English error when background returns empty response in extension runtime", async () => {
    await setAppLanguage("en");
    (globalThis as typeof globalThis & { chrome?: unknown }).chrome = {
      runtime: {
        sendMessage: async () => undefined,
        onMessage: { addListener: () => undefined, removeListener: () => undefined }
      }
    };

    const adapter = createBrowserAdapter();
    await expect(adapter.moveWorkspace("workspace:1")).rejects.toThrow("Background service is unavailable");
  });
});
