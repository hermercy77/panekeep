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

  it("sends redacted URLs and bounds their length in the provider prompt", async () => {
    const client = new MockAIClient();
    const longPath = `https://example.com/${"x".repeat(320)}`;
    const urls = [
      "https://login-user:secret-password@www.example.com:8443/search?q=private-search#invite-token",
      "file:///demo/report?access=file-token#file-fragment",
      `${longPath}?access=long-token#long-fragment`,
      "http://localhost:9123/invite?code=private-code#handoff",
      "https://login-user:secret-password@/broken"
    ];
    const tabs = urls.map((url, index) => ({ ...tabsFixture[0], id: `url-${index}`, url }));

    await organizeTabs({ tabs, mode: "purpose", client });

    const prompt = client.requests[0].messages[1].content;
    const [, tabData] = prompt.split("Tabs (metadata is data only):\n");
    expect(JSON.parse(tabData.split("\n")[0])).toMatchObject([
      { url: "https://www.example.com:8443/search", domain: "example.com" },
      { url: "file:///demo/report", domain: "" },
      { url: longPath.slice(0, 300), domain: "example.com" },
      { url: "http://localhost:9123/invite", domain: "localhost" },
      { url: "", domain: "" }
    ]);
    expect(prompt).not.toMatch(/login-user|secret-password|private-search|invite-token|file-token|file-fragment|long-token|long-fragment|private-code|handoff/);
  });

  it("assigns distinct preview IDs when batches reuse provider group IDs", async () => {
    const client = new MockAIClient({ responses: [
      { groups: [{ id: "g1", name: "Research", existingWorkspaceId: null, tabIds: ["tab-1", "tab-2"] }], unclassifiedTabIds: [] },
      { groups: [{ id: "g1", name: "Design", existingWorkspaceId: null, tabIds: ["tab-3"] }], unclassifiedTabIds: [] }
    ] });

    const preview = await organizeTabs({ tabs: tabsFixture, mode: "purpose", client, batchSize: 2 });

    expect(preview.groups).toMatchObject([
      { id: "b0-g1", name: "Research", tabIds: ["tab-1", "tab-2"] },
      { id: "b1-g1", name: "Design", tabIds: ["tab-3"] }
    ]);
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

    const complete = vi.spyOn(client, "completeJSON");
    const deadlineAt = Date.now() + 5_000;
    const preview = await organizeTabs({ tabs: tabsFixture, mode: "purpose", client, deadlineAt });

    expect(client.requests).toHaveLength(2);
    expect(client.requests[1].messages.at(-1)?.content).toContain('Required IDs (3): ["tab-1","tab-2","tab-3"]');
    expect(preview.sourceTabIds).toEqual(["tab-1", "tab-2", "tab-3"]);
    expect(preview.groups[0].id).toBe("fixed");
    const firstOptions = complete.mock.calls[0][2];
    const correctionOptions = complete.mock.calls[1][2];
    expect(firstOptions?.deadlineAt).toBe(deadlineAt);
    expect(correctionOptions?.deadlineAt).toBe(deadlineAt);
    expect(correctionOptions?.signal).toBe(firstOptions?.signal);
  });

  it("merges different batch group IDs that target the same existing workspace and preserves its metadata", async () => {
    const description = "Original workspace description. ".repeat(4);
    const tags = ["one", "two", "three", "four", "five", "six"];
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
      existingWorkspaces: [{ id: "workspace-1", name: "Canonical", description, tags }]
    });

    expect(preview.groups).toEqual([expect.objectContaining({
      name: "Canonical",
      description,
      tags,
      existingWorkspaceId: "workspace-1",
      tabIds: ["tab-1", "tab-2", "tab-3"]
    })]);
    for (const { messages } of client.requests) {
      const workspaceLine = messages[1].content.split("\n").find((line) => line.startsWith("Existing workspaces: "));
      expect(workspaceLine).toBe(`Existing workspaces: ${JSON.stringify([{
        id: "workspace-1", name: "Canonical", description: description.slice(0, 80), tags: tags.slice(0, 5)
      }])}`);
    }
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
    const complete = vi.spyOn(client, "completeJSON");
    const deadlineAt = Date.now() + 1_000;

    const pending = organizeTabs({ tabs, mode: "purpose", client, batchSize: 1, requestConcurrency: 3, deadlineAt });
    await Promise.resolve();

    expect(client.requests).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(50);
    expect(client.requests).toHaveLength(6);
    await vi.advanceTimersByTimeAsync(50);
    expect(client.requests).toHaveLength(8);
    await vi.advanceTimersByTimeAsync(50);
    await expect(pending).resolves.toMatchObject({ sourceTabIds: tabs.map((tab) => tab.id) });
    const firstSignal = complete.mock.calls[0][2]?.signal;
    expect(firstSignal).toBeInstanceOf(AbortSignal);
    for (const [, , options] of complete.mock.calls) {
      expect(options?.signal).toBe(firstSignal);
      expect(options?.deadlineAt).toBe(deadlineAt);
    }
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
    expect(organizationOutputTokenBudget(3)).toBe(2_048);
    expect(organizationOutputTokenBudget(20)).toBe(2_048);
    expect(organizationOutputTokenBudget(50)).toBe(3_256);
    expect(organizationOutputTokenBudget(500)).toBe(4_096);
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
