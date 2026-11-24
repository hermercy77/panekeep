import { describe, expect, it } from "vitest";
import { reconcileBrowserSnapshot, snapshotsEqual } from "../../src/browser/reconciler";
import type { StateSnapshot } from "../../src/shared/backup";
import type { WindowState, Workspace } from "../../src/shared/contracts";

function windowState(nativeId: number, order: number): WindowState {
  return { key: `saved:${nativeId}`, nativeId, name: `Saved window ${nativeId}`, order, isCurrent: false, expanded: true };
}

function workspace(windowKey: string, id: string, name: string, order: number, groupId?: number): Workspace {
  return {
    id, windowKey, name, order, groupId, description: "Saved description", color: "blue",
    tags: ["saved"], icon: "shield", createdAt: 5, updatedAt: 10
  };
}

describe("reconcileBrowserSnapshot", () => {
  it("restores exact, label, and position matches with their local metadata", () => {
    const previous: StateSnapshot = {
      windows: [windowState(1, 0), windowState(2, 1)],
      workspaces: [
        workspace("saved:1", "exact", "Previous name", 0, 10),
        workspace("saved:2", "label", "Label", 0, 20),
        workspace("saved:2", "position", "Old name", 1, 21),
        workspace("saved:2", "local", "Empty workspace", 2)
      ],
      tabs: [{
        id: "101", windowKey: "saved:1", workspaceId: "exact", groupId: 10, url: "https://example.test/",
        index: 0, kind: "normal", pinned: false, active: true, lastActivatedAt: 15
      }]
    };
    const input = {
      previous,
      windows: [
        { id: 11, groups: [{ id: 10, title: "New name", color: "red" }], tabs: [
          { id: 101, groupId: 10, active: true, url: "https://example.test/" }
        ] },
        { id: 22, groups: [{ id: 200, title: "Label", color: "blue" }, { id: 210, title: "Renamed" }], tabs: [
          { id: 201, groupId: 200, active: true, url: "https://example.test/label" },
          { id: 202, groupId: 210, pinned: true, url: "https://example.test/pinned" },
          { id: 203, groupId: 210, url: "chrome://settings/" }
        ] }
      ],
      privateWindowIds: new Set<number>(),
      currentWindowId: 22,
      restoring: true,
      now: 100,
      language: "en" as const
    };
    const original = structuredClone(input);
    const next = reconcileBrowserSnapshot(input);

    expect(next.windows).toEqual([
      { ...previous.windows[0], nativeId: 11 },
      { ...previous.windows[1], nativeId: 22, isCurrent: true }
    ]);
    expect(next.workspaces).toEqual([
      { ...previous.workspaces[0], name: "New name", color: "red" },
      { ...previous.workspaces[1], groupId: 200 },
      { ...previous.workspaces[2], groupId: 210, name: "Renamed" },
      previous.workspaces[3]
    ]);
    expect(next.tabs).toMatchObject([
      { id: "101", workspaceId: "exact", lastActivatedAt: 15 },
      { id: "201", workspaceId: "label", lastActivatedAt: 100 },
      { id: "202", workspaceId: null, kind: "fixed", index: 1 },
      { id: "203", workspaceId: null, kind: "special", specialReason: "chrome" }
    ]);
    expect(input).toEqual(original);
    expect(next.workspaces[3].tags).not.toBe(previous.workspaces[3].tags);
  });

  it("retains local workspaces in open windows and drops closed and private entries", () => {
    const previous: StateSnapshot = {
      windows: [windowState(1, 0), windowState(2, 1), windowState(3, 2)],
      workspaces: [
        workspace("saved:1", "open", "Open", 0),
        workspace("saved:2", "closed", "Closed", 0),
        workspace("saved:3", "private", "Private", 0)
      ],
      tabs: [{
        id: "101", windowKey: "saved:3", workspaceId: null, kind: "normal", url: "https://private.test/",
        index: 0, pinned: false, active: true, lastActivatedAt: 10
      }]
    };
    const next = reconcileBrowserSnapshot({
      previous, windows: [{ id: 1, groups: [], tabs: [{ id: 101, url: "https://public.test/", active: true }] }],
      privateWindowIds: new Set([3]), restoring: false, now: 100, language: "en"
    });

    expect(next.windows).toEqual([previous.windows[0]]);
    expect(next.workspaces).toEqual([previous.workspaces[0]]);
    expect(next.tabs).toMatchObject([{ id: "101", url: "https://public.test/", lastActivatedAt: 100 }]);
  });
});

describe("snapshotsEqual", () => {
  const previous: StateSnapshot = {
    windows: [windowState(1, 0)],
    workspaces: [workspace("saved:1", "project", "Project", 0)],
    tabs: [{
      id: "101", windowKey: "saved:1", workspaceId: null, kind: "normal", url: "https://example.test/",
      index: 0, pinned: false, active: true, lastActivatedAt: 5
    }]
  };

  it("compares field values across independent objects and optional fields", () => {
    const next = structuredClone(previous);
    next.tabs[0].title = undefined;
    expect(snapshotsEqual(previous, next)).toBe(true);
  });

  it.each<[string, (state: StateSnapshot) => void]>([
    ["focused window", (state) => { state.windows[0].isCurrent = true; }],
    ["workspace tags", (state) => { state.workspaces[0].tags[0] = "updated"; }],
    ["tab title", (state) => { state.tabs[0].title = "Updated"; }],
    ["activation timestamp", (state) => { state.tabs[0].lastActivatedAt = 15; }],
    ["tab removal", (state) => { state.tabs.pop(); }]
  ])("detects a change to %s", (_field, change) => {
    const next = structuredClone(previous);
    change(next);
    expect(snapshotsEqual(previous, next)).toBe(false);
  });
});
