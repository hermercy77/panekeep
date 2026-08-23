import { describe, expect, it } from "vitest";
import { BrowserStateEngine } from "../../src/browser/stateEngine";
import type { BrowserLike } from "../../src/browser/api";
import { MemoryStateRepository } from "../../src/storage/repository";
import { fingerprintTabs } from "../../src/ai";

type NativeTab = {
  id: number;
  windowId: number;
  groupId: number;
  index: number;
  pinned: boolean;
  active?: boolean;
  url: string;
  title: string;
};

type NativeGroup = {
  id: number;
  windowId: number;
  title: string;
  color: string;
};

type NativeWindow = {
  id: number;
  type: "normal";
  focused: boolean;
  tabs: NativeTab[];
};

const event = () => ({ addListener: () => undefined, removeListener: () => undefined });

class FakeBrowser {
  readonly removedWindowIds: number[] = [];
  readonly tabUpdates: Array<{ tabId: number; changes: Record<string, unknown> }> = [];
  readonly groupUpdates: Array<{ groupId: number; changes: Record<string, unknown> }> = [];
  readonly api: BrowserLike;
  private nextGroupId = 100;

  constructor(readonly windows: NativeWindow[], readonly groups: NativeGroup[]) {
    const reindex = (window: NativeWindow) => window.tabs.forEach((tab, index) => {
      tab.index = index;
      tab.windowId = window.id;
    });
    const cleanupGroups = () => {
      for (let index = this.groups.length - 1; index >= 0; index -= 1) {
        const group = this.groups[index];
        if (!this.windows.some((window) => window.tabs.some((tab) => tab.groupId === group.id))) {
          this.groups.splice(index, 1);
        }
      }
    };
    const findTab = (tabId: number) => {
      for (const window of this.windows) {
        const tab = window.tabs.find((item) => item.id === tabId);
        if (tab) return { window, tab };
      }
      throw new Error(`Unknown fake tab ${tabId}`);
    };

    this.api = {
      windows: {
        getAll: async () => this.windows.map((window) => ({ ...window, tabs: window.tabs.map((tab) => ({ ...tab })) })),
        getCurrent: async () => ({ ...this.windows.find((window) => window.focused) ?? this.windows[0] }),
        remove: async (windowId: number) => {
          const index = this.windows.findIndex((window) => window.id === windowId);
          if (index < 0) throw new Error(`Unknown fake window ${windowId}`);
          if (this.windows[index].tabs.length > 0) throw new Error("Cannot remove a non-empty fake window");
          this.windows.splice(index, 1);
          this.removedWindowIds.push(windowId);
        },
        update: async () => undefined,
        onCreated: event(),
        onRemoved: event(),
        onFocusChanged: event()
      },
      tabs: {
        query: async ({ windowId }: { windowId: number }) =>
          (this.windows.find((window) => window.id === windowId)?.tabs ?? []).map((tab) => ({ ...tab })),
        move: async (tabId: number, { windowId }: { windowId: number }) => {
          const source = findTab(tabId);
          const target = this.windows.find((window) => window.id === windowId);
          if (!target) throw new Error(`Unknown fake window ${windowId}`);
          source.window.tabs.splice(source.window.tabs.indexOf(source.tab), 1);
          source.tab.groupId = -1;
          target.tabs.push(source.tab);
          reindex(source.window);
          reindex(target);
          cleanupGroups();
          return { ...source.tab };
        },
        update: async (tabId: number, changes: Record<string, unknown>) => {
          const { tab } = findTab(tabId);
          Object.assign(tab, changes);
          this.tabUpdates.push({ tabId, changes: { ...changes } });
          return { ...tab };
        },
        group: async ({ tabIds, groupId, createProperties }: {
          tabIds: number[];
          groupId?: number;
          createProperties?: { windowId: number };
        }) => {
          const targetGroupId = groupId ?? this.nextGroupId++;
          const windowId = createProperties?.windowId ?? findTab(tabIds[0]).tab.windowId;
          if (!this.groups.some((group) => group.id === targetGroupId)) {
            this.groups.push({ id: targetGroupId, windowId, title: "", color: "grey" });
          }
          for (const tabId of tabIds) findTab(tabId).tab.groupId = targetGroupId;
          return targetGroupId;
        },
        ungroup: async (tabIds: number[]) => {
          for (const tabId of tabIds) findTab(tabId).tab.groupId = -1;
          cleanupGroups();
        },
        onCreated: event(),
        onRemoved: event(),
        onUpdated: event(),
        onMoved: event(),
        onAttached: event(),
        onDetached: event(),
        onReplaced: event(),
        onActivated: event()
      },
      tabGroups: {
        query: async ({ windowId }: { windowId: number }) =>
          this.groups.filter((group) => group.windowId === windowId).map((group) => ({ ...group })),
        update: async (groupId: number, changes: Record<string, unknown>) => {
          const group = this.groups.find((item) => item.id === groupId);
          if (!group) throw new Error(`Unknown fake group ${groupId}`);
          Object.assign(group, changes);
          this.groupUpdates.push({ groupId, changes: { ...changes } });
          return { ...group };
        },
        move: async () => undefined,
        onCreated: event(),
        onRemoved: event(),
        onUpdated: event(),
        onMoved: event()
      }
    };
  }
}

function tab(id: number, windowId: number, options: Partial<NativeTab> = {}): NativeTab {
  return {
    id,
    windowId,
    groupId: -1,
    index: 0,
    pinned: false,
    url: `https://example.test/${id}`,
    title: `Tab ${id}`,
    ...options
  };
}

describe("BrowserStateEngine with Chromium state", () => {
  it("merges selected tabs into the current workspace, unpins them, and closes the emptied source window", async () => {
    const fake = new FakeBrowser([
      { id: 1, type: "normal", focused: true, tabs: [tab(101, 1, { groupId: 10, active: true })] },
      { id: 2, type: "normal", focused: false, tabs: [tab(201, 2, { pinned: true })] }
    ], [{ id: 10, windowId: 1, title: "Current work", color: "blue" }]);
    const engine = new BrowserStateEngine({ api: fake.api, repository: new MemoryStateRepository(), debounceMs: 0 });
    await engine.start();
    const workspace = engine.getState().workspaces[0];

    const result = await engine.moveTabs({ tabIds: ["201"], workspaceId: workspace.id });

    expect(result.movedTabIds).toEqual(["201"]);
    expect(fake.tabUpdates).toContainEqual({ tabId: 201, changes: { pinned: false } });
    expect(fake.windows).toHaveLength(1);
    expect(fake.removedWindowIds).toEqual([2]);
    expect(fake.windows[0].tabs.map((item) => item.id)).toEqual([101, 201]);
    expect(fake.windows[0].tabs.find((item) => item.id === 201)?.groupId).toBe(10);
    expect(engine.getState().tabs.find((item) => item.id === "201")).toMatchObject({
      windowKey: "window:1",
      workspaceId: workspace.id,
      kind: "normal",
      pinned: false,
      groupId: 10
    });
    await engine.stop();
  });

  it("keeps a source window open when an unselected tab remains", async () => {
    const fake = new FakeBrowser([
      { id: 1, type: "normal", focused: true, tabs: [tab(101, 1, { groupId: 10, active: true })] },
      { id: 2, type: "normal", focused: false, tabs: [tab(201, 2), tab(202, 2, { index: 1 })] }
    ], [{ id: 10, windowId: 1, title: "Current work", color: "blue" }]);
    const engine = new BrowserStateEngine({ api: fake.api, repository: new MemoryStateRepository(), debounceMs: 0 });
    await engine.start();

    await engine.moveTabs({ tabIds: ["201"], workspaceId: engine.getState().workspaces[0].id });

    expect(fake.windows).toHaveLength(2);
    expect(fake.removedWindowIds).toEqual([]);
    expect(fake.windows.find((window) => window.id === 2)?.tabs.map((item) => item.id)).toEqual([202]);
    await engine.stop();
  });

  it("synchronizes workspace name and semantic color to the native group", async () => {
    const fake = new FakeBrowser([
      { id: 1, type: "normal", focused: true, tabs: [tab(101, 1, { groupId: 10, active: true })] }
    ], [{ id: 10, windowId: 1, title: "Current work", color: "blue" }]);
    const engine = new BrowserStateEngine({ api: fake.api, repository: new MemoryStateRepository(), debounceMs: 0 });
    await engine.start();
    const workspace = engine.getState().workspaces[0];

    await engine.updateWorkspace(workspace.id, { name: "Research", color: "violet" });

    expect(fake.groupUpdates.at(-1)).toEqual({
      groupId: 10,
      changes: { title: "Research", color: "purple" }
    });
    expect(engine.getState().workspaces[0]).toMatchObject({ name: "Research", color: "purple" });
    await engine.stop();
  });

  it("deletes a workspace by ungrouping its tabs without closing them", async () => {
    const fake = new FakeBrowser([
      { id: 1, type: "normal", focused: true, tabs: [tab(101, 1, { groupId: 10, active: true })] }
    ], [{ id: 10, windowId: 1, title: "Current work", color: "blue" }]);
    const engine = new BrowserStateEngine({ api: fake.api, repository: new MemoryStateRepository(), debounceMs: 0 });
    await engine.start();

    await engine.deleteWorkspace(engine.getState().workspaces[0].id);

    expect(fake.windows[0].tabs).toHaveLength(1);
    expect(fake.windows[0].tabs[0].groupId).toBe(-1);
    expect(engine.getState().workspaces).toEqual([]);
    expect(engine.getState().tabs[0]).toMatchObject({ id: "101", workspaceId: null, kind: "normal" });
    await engine.stop();
  });

  it("rejects a preview when a selected tab changes before confirmation", async () => {
    const fake = new FakeBrowser([
      { id: 1, type: "normal", focused: true, tabs: [tab(101, 1, { groupId: 10, active: true })] }
    ], [{ id: 10, windowId: 1, title: "Current work", color: "blue" }]);
    const engine = new BrowserStateEngine({ api: fake.api, repository: new MemoryStateRepository(), debounceMs: 0 });
    await engine.start();
    const before = engine.getState();
    const workspace = before.workspaces[0];
    const sourceTabs = before.tabs.filter((item) => item.id === "101");
    const preview = {
      mode: "purpose" as const,
      sourceTabIds: ["101"],
      sourceFingerprint: fingerprintTabs(sourceTabs),
      groups: [{
        id: "existing",
        name: workspace.name,
        description: workspace.description,
        tags: workspace.tags,
        existingWorkspaceId: workspace.id,
        tabIds: ["101"]
      }],
      unclassifiedTabIds: []
    };

    fake.windows[0].tabs[0].url = "https://changed.example.test/";
    await engine.syncFromBrowser();

    await expect(engine.handleUiAction({ action: "organization.apply", payload: { preview } }))
      .rejects.toThrow("标签在预览后发生了变化");
    expect(fake.windows[0].tabs[0]).toMatchObject({ id: 101, groupId: 10 });
    expect(fake.removedWindowIds).toEqual([]);
    await engine.stop();
  });
});
