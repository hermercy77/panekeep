import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserAdapter, ORGANIZATION_PREVIEW_TIMEOUT_MS } from "../../src/ui-state/adapter";

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as typeof globalThis & { chrome?: unknown }).chrome;
});

describe("browser adapter organization deadline", () => {
  it("returns an actionable error instead of leaving the AI dialog loading forever", async () => {
    vi.useFakeTimers();
    const messages: Array<{ action: string; payload?: { requestId?: string } }> = [];
    (globalThis as typeof globalThis & { chrome?: unknown }).chrome = {
      runtime: {
        sendMessage: (message: { action: string; payload?: { requestId?: string } }) => {
          messages.push(message);
          return message.action === "organization.cancel"
            ? Promise.resolve({ ok: true, result: { cancelled: true } })
            : new Promise(() => undefined);
        }
      }
    };
    const pending = createBrowserAdapter().requestOrganization("purpose", ["tab-1"]);
    const rejection = expect(pending).rejects.toThrow("AI 整理超过 59 秒");

    await vi.advanceTimersByTimeAsync(ORGANIZATION_PREVIEW_TIMEOUT_MS);

    await rejection;
    expect(messages.map((message) => message.action)).toEqual(["organization.preview", "organization.cancel"]);
    expect(messages[1].payload?.requestId).toBe(messages[0].payload?.requestId);
  });

  it("allocates one deadline per 50-tab provider batch", async () => {
    vi.useFakeTimers();
    (globalThis as typeof globalThis & { chrome?: unknown }).chrome = {
      runtime: {
        sendMessage: () => new Promise(() => undefined)
      }
    };
    let settled = false;
    const pending = createBrowserAdapter()
      .requestOrganization("purpose", Array.from({ length: 51 }, (_, index) => `tab-${index}`))
      .finally(() => { settled = true; });

    await vi.advanceTimersByTimeAsync(ORGANIZATION_PREVIEW_TIMEOUT_MS);
    expect(settled).toBe(false);
    const rejection = expect(pending).rejects.toThrow("AI 整理超过 118 秒");
    await vi.advanceTimersByTimeAsync(ORGANIZATION_PREVIEW_TIMEOUT_MS);

    await rejection;
  });

  it("derives the batch count from live unclassified tabs when IDs are omitted", async () => {
    vi.useFakeTimers();
    const tabs = Array.from({ length: 51 }, (_, index) => ({
      id: `tab-${index}`,
      windowKey: "window:1",
      workspaceId: null,
      kind: "normal",
      url: `https://example.test/${index}`,
      index,
      pinned: false
    }));
    (globalThis as typeof globalThis & { chrome?: unknown }).chrome = {
      runtime: {
        sendMessage: (message: { action: string }) => message.action === "refresh"
          ? Promise.resolve({ ok: true, result: {
              windows: [{ key: "window:1", nativeId: 1, name: "Window 1", order: 0, isCurrent: true, expanded: true }],
              workspaces: [],
              tabs
            } })
          : new Promise(() => undefined)
      }
    };
    let settled = false;
    const pending = createBrowserAdapter().requestOrganization("purpose").finally(() => { settled = true; });

    await vi.advanceTimersByTimeAsync(ORGANIZATION_PREVIEW_TIMEOUT_MS);
    expect(settled).toBe(false);
    const rejection = expect(pending).rejects.toThrow("AI 整理超过 118 秒");
    await vi.advanceTimersByTimeAsync(ORGANIZATION_PREVIEW_TIMEOUT_MS);

    await rejection;
  });
});
