import { describe, expect, it } from "vitest";
import { createBackup, parseBackup, stringifyBackup } from "../../src/shared/backup";
import { classifyBrowserTab } from "../../src/browser/classify";

describe("backup and browser classification", () => {
  it("round-trips workspace, tab and special-page metadata without secrets", () => {
    const backup = createBackup({
      windows: [{ key: "window:1", nativeId: 1, name: "主窗口", order: 0, isCurrent: true, expanded: true }],
      workspaces: [{
        id: "workspace:1",
        windowKey: "window:1",
        name: "项目 A",
        description: "交付资料",
        tags: ["工作"],
        color: "blue",
        groupId: 7,
        order: 0,
        createdAt: 1,
        updatedAt: 2
      }],
      tabs: [{
        id: "1",
        windowKey: "window:1",
        workspaceId: "workspace:1",
        kind: "normal",
        url: "https://example.com/project",
        title: "Project",
        faviconUrl: "https://example.com/favicon.ico",
        index: 0,
        pinned: false,
        groupId: 7,
        lastActivatedAt: 3
      }, {
        id: "2",
        windowKey: "window:1",
        workspaceId: null,
        kind: "special",
        url: "chrome://extensions",
        title: "Extensions",
        index: 1,
        pinned: false,
        specialReason: "chrome"
      }]
    }, "chrome");

    const parsed = parseBackup(stringifyBackup(backup));
    expect(parsed).toEqual(backup);
    expect(stringifyBackup(backup)).not.toContain("apiKey");
    expect(stringifyBackup(backup)).not.toContain("password");
  });

  it("classifies special and fixed pages before normal tabs", () => {
    expect(classifyBrowserTab({ id: 1, url: "chrome://settings", pinned: false })).toBe("special");
    expect(classifyBrowserTab({ id: 2, url: "https://example.com", pinned: true })).toBe("fixed");
    expect(classifyBrowserTab({ id: 3, url: "https://example.com", pinned: false })).toBe("normal");
  });
});
