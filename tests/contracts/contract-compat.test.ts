import { describe, expect, it } from "vitest";
import { organizationPreviewSchema, tabRecordSchema } from "../../src/shared/contracts";
import { normalizeGroupColor } from "../../src/shared/constants";

describe("shared contract compatibility", () => {
  it("keeps purpose/type as the only organization modes", () => {
    expect(() => organizationPreviewSchema.parse({
      mode: "purpose",
      sourceTabIds: [],
      sourceFingerprint: "fixture-fingerprint",
      groups: [],
      unclassifiedTabIds: []
    })).not.toThrow();
    expect(() => organizationPreviewSchema.parse({
      mode: "semantic",
      sourceTabIds: [],
      sourceFingerprint: "fixture-fingerprint",
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

  it("maps UI color aliases to browser-native tab-group colors", () => {
    expect(normalizeGroupColor("slate")).toBe("grey");
    expect(normalizeGroupColor("amber")).toBe("yellow");
    expect(normalizeGroupColor("rose")).toBe("pink");
    expect(normalizeGroupColor("violet")).toBe("purple");
    expect(normalizeGroupColor("blue")).toBe("blue");
    expect(normalizeGroupColor("unknown")).toBe("grey");
  });
});
