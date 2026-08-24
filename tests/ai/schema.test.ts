import { describe, expect, it } from "vitest";
import {
  AIInvalidJsonError,
  AIValidationError,
  parseStrictJson,
  validateOrganizationPreview
} from "../../src/ai";
import { validOrganizationResponse } from "./fixtures/organization-response";

describe("strict organization response validation", () => {
  it("accepts a complete purpose response", () => {
    const preview = validateOrganizationPreview(validOrganizationResponse, "purpose", ["tab-1", "tab-2", "tab-3"], "fixture-fingerprint");
    expect(preview.mode).toBe("purpose");
    expect(preview.sourceTabIds).toEqual(["tab-1", "tab-2", "tab-3"]);
    expect(preview.groups[0]).toMatchObject({ icon: "folder", color: "grey" });
  });

  it("rejects Markdown fences instead of extracting JSON from them", () => {
    expect(() => parseStrictJson("```json\n{}\n```"))
      .toThrow(AIInvalidJsonError);
  });

  it("rejects unknown keys", () => {
    expect(() => validateOrganizationPreview({ ...validOrganizationResponse, extra: true }, "type", ["tab-1", "tab-2", "tab-3"], "fixture-fingerprint"))
      .toThrow(AIValidationError);
  });

  it("rejects missing, unknown, and duplicate tab assignments as one response", () => {
    expect(() => validateOrganizationPreview({
      groups: [{ ...validOrganizationResponse.groups[0], tabIds: ["tab-1", "tab-unknown"] }],
      unclassifiedTabIds: []
    }, "purpose", ["tab-1", "tab-2"], "fixture-fingerprint")).toThrow(AIValidationError);
  });
});
