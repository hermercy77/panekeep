import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AIConflictError,
  AIValidationError,
  MockAIClient,
  fingerprintTabs,
  organizeTabs
} from "../../src/ai";
import { organizationOutputTokenBudget } from "../../src/ai/pipeline";
import { tabsFixture } from "./fixtures/organization-response";

describe("organization pipeline", () => {
  afterEach(() => vi.useRealTimers());

  it("supports purpose/type modes and batches all tabs", async () => {
    const client = new MockAIClient();
    const preview = await organizeTabs({ tabs: tabsFixture, mode: "type", client, batchSize: 2 });
    expect(preview.mode).toBe("type");
    expect(preview.sourceTabIds).toEqual(["tab-1", "tab-2", "tab-3"]);
    expect(preview.sourceFingerprint).toBe(fingerprintTabs(tabsFixture));
    expect(client.requests).toHaveLength(2);
  });

  it("rejects the entire result when one batch is invalid", async () => {
    const client = new MockAIClient({
      responses: [
        {
          groups: [{ id: "one", name: "One", description: "", tags: [], existingWorkspaceId: null, tabIds: ["tab-1", "tab-2"] }],
          unclassifiedTabIds: []
        },
        { groups: [], unclassifiedTabIds: [] },
        { groups: [], unclassifiedTabIds: [] }
      ]
    });
    await expect(organizeTabs({ tabs: tabsFixture, mode: "purpose", client, batchSize: 2 }))
      .rejects.toBeInstanceOf(AIValidationError);
  });

  it("retries one invalid assignment with a corrective ID checklist", async () => {
    const client = new MockAIClient({
      responses: [
        { groups: [{ id: "first", name: "First", description: "", tags: [], existingWorkspaceId: null, tabIds: ["tab-1", "tab-2"] }], unclassifiedTabIds: [] },
        { groups: [{ id: "fixed", name: "Fixed", description: "", tags: [], existingWorkspaceId: null, tabIds: ["tab-1", "tab-2", "tab-3"] }], unclassifiedTabIds: [] }
      ]
    });

    const preview = await organizeTabs({ tabs: tabsFixture, mode: "purpose", client });

    expect(client.requests).toHaveLength(2);
    expect(client.requests[1].messages.at(-1)?.content).toContain('Required IDs (3): ["tab-1","tab-2","tab-3"]');
    expect(preview.sourceTabIds).toEqual(["tab-1", "tab-2", "tab-3"]);
  });

  it("merges different batch group IDs that target the same existing workspace and preserves its metadata", async () => {
    const client = new MockAIClient({
      responses: [
        { groups: [{ id: "batch-one", name: "AI rename", description: "changed", tags: ["changed"], existingWorkspaceId: "workspace-1", tabIds: ["tab-1", "tab-2"] }], unclassifiedTabIds: [] },
        { groups: [{ id: "batch-two", name: "Another rename", description: "different", tags: [], existingWorkspaceId: "workspace-1", tabIds: ["tab-3"] }], unclassifiedTabIds: [] }
      ]
    });

    const preview = await organizeTabs({
      tabs: tabsFixture,
      mode: "purpose",
      client,
      batchSize: 2,
      existingWorkspaces: [{ id: "workspace-1", name: "Canonical", description: "Original", tags: ["kept"] }]
    });

    expect(preview.groups).toEqual([expect.objectContaining({
      name: "Canonical",
      description: "Original",
      tags: ["kept"],
      existingWorkspaceId: "workspace-1",
      tabIds: ["tab-1", "tab-2", "tab-3"]
    })]);
  });

  it("rejects a response that references an unknown existing workspace before preview", async () => {
    const client = new MockAIClient({
      response: {
        groups: [{ id: "unknown", name: "Unknown", description: "", tags: [], existingWorkspaceId: "missing-workspace", tabIds: ["tab-1", "tab-2", "tab-3"] }],
        unclassifiedTabIds: []
      }
    });

    await expect(organizeTabs({
      tabs: tabsFixture,
      mode: "purpose",
      client,
      existingWorkspaces: [{ id: "workspace-1", name: "Known", description: "", tags: [] }]
    })).rejects.toThrow("missing-workspace");
  });

  it("detects a snapshot change before returning a preview", async () => {
    const client = new MockAIClient();
    const changed = { ...tabsFixture[0], title: "Changed" };
    await expect(organizeTabs({
      tabs: tabsFixture,
      mode: "purpose",
      client,
      getCurrentTabs: () => [changed, tabsFixture[1], tabsFixture[2]]
    })).rejects.toBeInstanceOf(AIConflictError);
  });

  it("does not reject a preview when only activation and last-visited metadata changed", async () => {
    const client = new MockAIClient();
    const currentTabs = tabsFixture.map((tab, index) => ({
      ...tab,
      active: index === 1,
      lastActivatedAt: 100 + index
    }));

    await expect(organizeTabs({
      tabs: tabsFixture,
      mode: "purpose",
      client,
      getCurrentTabs: () => currentTabs
    })).resolves.toMatchObject({ sourceTabIds: ["tab-1", "tab-2", "tab-3"] });
  });

  it("keeps local organization overhead negligible for 50 tabs", async () => {
    const tabs = Array.from({ length: 50 }, (_, index) => ({
      id: `tab-${index + 1}`,
      windowKey: index < 25 ? "window-1" : "window-2",
      workspaceId: null,
      kind: "normal" as const,
      url: `https://example.com/project/${index + 1}`,
      title: `Project tab ${index + 1}`,
      index,
      pinned: false
    }));
    const client = new MockAIClient();
    const startedAt = performance.now();

    const preview = await organizeTabs({ tabs, mode: "purpose", client, batchSize: 20 });

    expect(performance.now() - startedAt).toBeLessThan(1_000);
    expect(preview.sourceTabIds).toHaveLength(50);
    expect(client.requests).toHaveLength(3);
  });

  it("runs provider batches concurrently with a bounded worker pool", async () => {
    vi.useFakeTimers();
    const tabs = Array.from({ length: 8 }, (_, index) => ({
      id: `parallel-${index + 1}`,
      windowKey: "window-1",
      workspaceId: null,
      kind: "normal" as const,
      url: `https://example.com/${index + 1}`,
      title: `Tab ${index + 1}`,
      index,
      pinned: false
    }));
    const client = new MockAIClient({ latencyMs: 50 });

    const pending = organizeTabs({ tabs, mode: "purpose", client, batchSize: 1, requestConcurrency: 3 });
    await Promise.resolve();

    expect(client.requests).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(50);
    expect(client.requests).toHaveLength(6);
    await vi.advanceTimersByTimeAsync(50);
    expect(client.requests).toHaveLength(8);
    await vi.advanceTimersByTimeAsync(50);
    await expect(pending).resolves.toMatchObject({ sourceTabIds: tabs.map((tab) => tab.id) });
  });

  it("stops scheduling new batches after the first provider failure", async () => {
    const tabs = Array.from({ length: 8 }, (_, index) => ({
      id: `failure-${index + 1}`,
      windowKey: "window-1",
      workspaceId: null,
      kind: "normal" as const,
      url: `https://example.com/failure/${index + 1}`,
      title: `Failure ${index + 1}`,
      index,
      pinned: false
    }));
    const client = new MockAIClient({
      handler: async (_messages, callIndex) => {
        if (callIndex === 0) throw new Error("provider failed");
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { groups: [], unclassifiedTabIds: [] };
      }
    });

    await expect(organizeTabs({ tabs, mode: "purpose", client, batchSize: 1, requestConcurrency: 3 }))
      .rejects.toThrow("provider failed");
    expect(client.requests.length).toBeLessThanOrEqual(3);
  });

  it("scales the JSON output budget with the selected tab count", () => {
    expect(organizationOutputTokenBudget(3)).toBe(512);
    expect(organizationOutputTokenBudget(20)).toBe(856);
    expect(organizationOutputTokenBudget(50)).toBe(1_756);
    expect(organizationOutputTokenBudget(500)).toBe(2_048);
  });

  it("falls back to safe request concurrency for non-finite input", async () => {
    const client = new MockAIClient();

    await expect(organizeTabs({
      tabs: tabsFixture,
      mode: "purpose",
      client,
      batchSize: 1,
      requestConcurrency: Number.NaN
    })).resolves.toMatchObject({ sourceTabIds: tabsFixture.map((tab) => tab.id) });
    expect(client.requests).toHaveLength(tabsFixture.length);
  });

  it("propagates the selected language into every AI batch", async () => {
    const client = new MockAIClient();

    await organizeTabs({ tabs: tabsFixture, mode: "purpose", client, batchSize: 2, language: "en" });

    expect(client.requests).toHaveLength(2);
    expect(client.requests.every((request) => request.messages[0].content.includes("in English"))).toBe(true);
    expect(client.requests.every((request) => request.messages[1].content.includes("English (en)"))).toBe(true);
    expect(client.requests.every((request) => request.messages[1].content.includes("you MUST set its existingWorkspaceId"))).toBe(true);
  });
});
