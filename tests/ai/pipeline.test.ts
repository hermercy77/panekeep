import { describe, expect, it } from "vitest";
import {
  AIConflictError,
  AIValidationError,
  MockAIClient,
  fingerprintTabs,
  organizeTabs
} from "../../src/ai";
import { tabsFixture } from "./fixtures/organization-response";

describe("organization pipeline", () => {
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
        { groups: [], unclassifiedTabIds: [] }
      ]
    });
    await expect(organizeTabs({ tabs: tabsFixture, mode: "purpose", client, batchSize: 2 }))
      .rejects.toBeInstanceOf(AIValidationError);
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

  it("propagates the selected language into every AI batch", async () => {
    const client = new MockAIClient();

    await organizeTabs({ tabs: tabsFixture, mode: "purpose", client, batchSize: 2, language: "en" });

    expect(client.requests).toHaveLength(2);
    expect(client.requests.every((request) => request.messages[0].content.includes("in English"))).toBe(true);
    expect(client.requests.every((request) => request.messages[1].content.includes("English (en)"))).toBe(true);
    expect(client.requests.every((request) => request.messages[1].content.includes("Always prefer a suitable existing workspace"))).toBe(true);
  });
});
