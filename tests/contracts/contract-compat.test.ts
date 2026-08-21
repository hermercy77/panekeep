import { describe, expect, it } from "vitest";
import { organizationPreviewSchema, tabRecordSchema } from "../../src/shared/contracts";

describe("shared contract compatibility", () => {
  it("keeps purpose/type as the only organization modes", () => {
    expect(() => organizationPreviewSchema.parse({
      mode: "purpose",
      sourceTabIds: [],
      groups: [],
      unclassifiedTabIds: []
    })).not.toThrow();
    expect(() => organizationPreviewSchema.parse({
      mode: "semantic",
      sourceTabIds: [],
      groups: [],
      unclassifiedTabIds: []
    })).toThrow();
  });

  it("continues to validate the tab records consumed by the AI pipeline", () => {
    expect(tabRecordSchema.parse({
      id: "tab-1",
      windowKey: "window-1",
      workspaceId: null,
      kind: "normal",
      url: "https://example.com",
      index: 0,
      pinned: false
    }).id).toBe("tab-1");
  });
});
