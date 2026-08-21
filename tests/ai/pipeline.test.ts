import { describe, expect, it } from "vitest";
import {
  AIConflictError,
  AIValidationError,
  MockAIClient,
  organizeTabs
} from "../../src/ai";
import { tabsFixture } from "./fixtures/organization-response";

describe("organization pipeline", () => {
  it("supports purpose/type modes and batches all tabs", async () => {
    const client = new MockAIClient();
    const preview = await organizeTabs({ tabs: tabsFixture, mode: "type", client, batchSize: 2 });
    expect(preview.mode).toBe("type");
    expect(preview.sourceTabIds).toEqual(["tab-1", "tab-2", "tab-3"]);
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
});
