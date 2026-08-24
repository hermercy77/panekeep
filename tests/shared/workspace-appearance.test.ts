import { describe, expect, it } from "vitest";
import {
  assignWorkspaceColors,
  inferWorkspaceIcon,
  normalizeWorkspaceIcon
} from "../../src/shared/workspaceAppearance";

describe("workspace appearance", () => {
  it("uses currently unused colors before repeating a color", () => {
    expect(assignWorkspaceColors(["blue", "cyan"], 4)).toEqual(["green", "yellow", "pink", "purple"]);
  });

  it("uses the least-used color deterministically after the palette is exhausted", () => {
    expect(assignWorkspaceColors(["blue", "cyan", "green", "yellow", "pink", "purple"], 3))
      .toEqual(["blue", "cyan", "green"]);
  });

  it("infers a built-in icon locally and falls back safely", () => {
    expect(inferWorkspaceIcon(["Tokyo trip planning"])).toBe("plane");
    expect(inferWorkspaceIcon(["\u8d22\u52a1\u9884\u7b97"])).toBe("wallet");
    expect(inferWorkspaceIcon(["Spreadsheets"])).toBe("chart");
    expect(normalizeWorkspaceIcon("not-an-icon")).toBe("folder");
  });
});
