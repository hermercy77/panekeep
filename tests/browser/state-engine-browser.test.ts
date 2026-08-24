import { describe, expect, it, vi } from "vitest";
import { BrowserStateEngine } from "../../src/browser/stateEngine";
import type { BrowserLike } from "../../src/browser/api";
import { MemoryStateRepository } from "../../src/storage/repository";
import { fingerprintTabs } from "../../src/ai";
import { AI_CONFIG_STORAGE_KEY } from "../../src/ai/config";
import { createBackup } from "../../src/shared/backup";
import { setAppLanguage } from "../../src/i18n";

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
  readonly discardedTabIds: number[] = [];
  readonly failCreateUrls = new Set<string>();
  readonly api: BrowserLike;
  private nextGroupId = 100;
  private nextTabId = 1000;
  private nextWindowId = 100;

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
        getLastFocused: async () => ({ ...this.windows.find((window) => window.focused) ?? this.windows[0] }),
        getCurrent: async () => ({ ...this.windows.find((window) => window.focused) ?? this.windows[0] }),
        create: async ({ url, focused = false }: { url?: string | string[]; focused?: boolean }) => {
          const windowId = this.nextWindowId++;
          const urls = Array.isArray(url) ? url : [url ?? "about:blank"];
          const createdWindow: NativeWindow = {
            id: windowId,
            type: "normal",
            focused,
            tabs: urls.map((tabUrl, index) => tab(this.nextTabId++, windowId, {
              url: tabUrl,
              title: tabUrl,
              index,
              active: index === 0
            }))
          };
          if (focused) this.windows.forEach((window) => { window.focused = false; });
          this.windows.push(createdWindow);
          return { ...createdWindow, tabs: createdWindow.tabs.map((item) => ({ ...item })) };
        },
        remove: async (windowId: number) => {
          const index = this.windows.findIndex((window) => window.id === windowId);
          if (index < 0) throw new Error(`Unknown fake window ${windowId}`);
          this.windows.splice(index, 1);
          cleanupGroups();
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
        create: async ({ windowId, url, active = false }: { windowId: number; url: string; active?: boolean }) => {
          if (this.failCreateUrls.has(url)) throw new Error(`Blocked fake URL ${url}`);
          const window = this.windows.find((item) => item.id === windowId);
          if (!window) throw new Error(`Unknown fake window ${windowId}`);
          if (active) window.tabs.forEach((item) => { item.active = false; });
          const created = tab(this.nextTabId++, windowId, {
            url,
            title: url,
            index: window.tabs.length,
            active
          });
          window.tabs.push(created);
          return { ...created };
        },
        remove: async (tabId: number) => {
          const found = findTab(tabId);
          found.window.tabs.splice(found.window.tabs.indexOf(found.tab), 1);
          reindex(found.window);
          cleanupGroups();
        },
        discard: async (tabId: number) => {
          findTab(tabId);
          this.discardedTabIds.push(tabId);
          return { ...findTab(tabId).tab };
        },
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
        query: async ({ windowId }: { windowId?: number } = {}) =>
          this.groups.filter((group) => windowId === undefined || group.windowId === windowId).map((group) => ({ ...group })),
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
  it("moves valid batch members, reports skipped tabs, and treats tabs already at the target as successful", async () => {
    const fake = new FakeBrowser([
      {
        id: 1,
        type: "normal",
        focused: true,
        tabs: [
          tab(101, 1, { groupId: 10, active: true }),
          tab(102, 1, { groupId: -1, index: 1 }),
          tab(103, 1, { groupId: -1, index: 2, url: "chrome://extensions/" }),
          tab(104, 1, { groupId: -1, index: 3, pinned: true })
        ]
      }
    ], [{ id: 10, windowId: 1, title: "Target", color: "blue" }]);
    const engine = new BrowserStateEngine({ api: fake.api, repository: new MemoryStateRepository(), debounceMs: 0 });
    await engine.start();
    const workspace = engine.getState().workspaces[0];

    const result = await engine.moveTabs({ tabIds: ["101", "102", "103", "missing"], workspaceId: workspace.id });

    expect(result.movedTabIds).toEqual(["101", "102"]);
    expect(result.skippedTabIds).toEqual(["103", "missing"]);
    expect(engine.getState().tabs.find((item) => item.id === "102")?.workspaceId).toBe(workspace.id);
    const unclassified = await engine.moveTabs({ tabIds: ["102", "104"], workspaceId: null });
    expect(unclassified.movedTabIds).toEqual(["102"]);
    expect(unclassified.skippedTabIds).toEqual(["104"]);
    await engine.stop();
  });

  it("merges workspaces across windows, preserves target metadata, deletes the source, and closes its empty window", async () => {
    const fake = new FakeBrowser([
      { id: 1, type: "normal", focused: false, tabs: [tab(101, 1, { groupId: 10 }), tab(102, 1, { groupId: 10, index: 1 })] },
      { id: 2, type: "normal", focused: true, tabs: [tab(201, 2, { groupId: 20, active: true })] }
    ], [
      { id: 10, windowId: 1, title: "Source", color: "red" },
      { id: 20, windowId: 2, title: "Target", color: "blue" }
    ]);
    const engine = new BrowserStateEngine({ api: fake.api, repository: new MemoryStateRepository(), debounceMs: 0 });
    await engine.start();
    const source = engine.getState().workspaces.find((workspace) => workspace.groupId === 10)!;
    const target = engine.getState().workspaces.find((workspace) => workspace.groupId === 20)!;
    await engine.updateWorkspace(target.id, { description: "Keep me", tags: ["target"], icon: "briefcase" });
    const targetBefore = engine.getState().workspaces.find((workspace) => workspace.id === target.id)!;
    const preview = engine.createWorkspaceMergePreview(source.id, target.id);

    await engine.mergeWorkspaces(preview);

    expect(engine.getState().workspaces).toHaveLength(1);
    expect(engine.getState().workspaces[0]).toMatchObject({
      id: target.id,
      name: targetBefore.name,
      description: "Keep me",
      tags: ["target"],
      color: targetBefore.color,
      icon: "briefcase"
    });
    expect(engine.getState().tabs.map((item) => item.workspaceId)).toEqual([target.id, target.id, target.id]);
    expect(engine.getState().tabs.map((item) => item.windowKey)).toEqual([target.windowKey, target.windowKey, target.windowKey]);
    expect(fake.removedWindowIds).toContain(1);
    await engine.stop();
  });

  it("rejects a stale workspace merge preview before moving any tab", async () => {
    const fake = new FakeBrowser([
      { id: 1, type: "normal", focused: true, tabs: [tab(101, 1, { groupId: 10 })] },
      { id: 2, type: "normal", focused: false, tabs: [tab(201, 2, { groupId: 20 })] }
    ], [
      { id: 10, windowId: 1, title: "Source", color: "red" },
      { id: 20, windowId: 2, title: "Target", color: "blue" }
    ]);
    const engine = new BrowserStateEngine({ api: fake.api, repository: new MemoryStateRepository(), debounceMs: 0 });
    await engine.start();
    const source = engine.getState().workspaces.find((workspace) => workspace.groupId === 10)!;
    const target = engine.getState().workspaces.find((workspace) => workspace.groupId === 20)!;
    const preview = engine.createWorkspaceMergePreview(source.id, target.id);
    fake.windows[0].tabs[0].url = "https://changed.example.test/";
    await engine.syncFromBrowser();

    await expect(engine.mergeWorkspaces(preview)).rejects.toThrow("工作区或标签已发生变化");
    expect(fake.windows[0].tabs[0]).toMatchObject({ id: 101, windowId: 1, groupId: 10 });
    expect(fake.windows[1].tabs[0]).toMatchObject({ id: 201, windowId: 2, groupId: 20 });
    await engine.stop();
  });

  it("rolls back every native change when a workspace merge fails midway", async () => {
    const fake = new FakeBrowser([
      { id: 1, type: "normal", focused: true, tabs: [tab(101, 1, { groupId: 10 }), tab(102, 1, { groupId: 10, index: 1 })] },
      { id: 2, type: "normal", focused: false, tabs: [tab(201, 2, { groupId: 20 })] }
    ], [
      { id: 10, windowId: 1, title: "Source", color: "red" },
      { id: 20, windowId: 2, title: "Target", color: "blue" }
    ]);
    const engine = new BrowserStateEngine({ api: fake.api, repository: new MemoryStateRepository(), debounceMs: 0 });
    await engine.start();
    const source = engine.getState().workspaces.find((workspace) => workspace.groupId === 10)!;
    const target = engine.getState().workspaces.find((workspace) => workspace.groupId === 20)!;
    const before = engine.getState();
    const preview = engine.createWorkspaceMergePreview(source.id, target.id);
    const originalMove = fake.api.tabs.move;
    let failedAttempts = 0;
    fake.api.tabs.move = async (tabId: number, options: { windowId: number; index: number }) => {
      if (tabId === 102 && failedAttempts < 2) {
        failedAttempts += 1;
        throw new Error("merge move failed");
      }
      return originalMove(tabId, options);
    };

    await expect(engine.mergeWorkspaces(preview)).rejects.toThrow("无法移动标签 102");
    expect(engine.getState()).toEqual(before);
    expect(fake.windows.find((window) => window.id === 1)?.tabs.map((item) => item.id).sort()).toEqual([101, 102]);
    expect(fake.windows.find((window) => window.id === 2)?.tabs.map((item) => item.id)).toEqual([201]);
    await engine.stop();
  });

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

  it("uses the last-focused native window instead of a stale service-worker current window", async () => {
    const fake = new FakeBrowser([
      { id: 1, type: "normal", focused: true, tabs: [tab(101, 1, { active: true })] },
      { id: 2, type: "normal", focused: false, tabs: [tab(201, 2, { active: true })] }
    ], []);
    fake.api.windows.getCurrent = async () => ({ id: 1, type: "normal", focused: false });
    const engine = new BrowserStateEngine({ api: fake.api, repository: new MemoryStateRepository(), debounceMs: 0 });
    await engine.start();
    expect(engine.getState().windows.find((window) => window.isCurrent)?.nativeId).toBe(1);

    fake.windows[0].focused = false;
    fake.windows[1].focused = true;
    await engine.syncFromBrowser();

    expect(engine.getState().windows.find((window) => window.isCurrent)?.nativeId).toBe(2);
    await engine.stop();
  });

  it("does not reuse a closed window identity when only one native window was replaced", async () => {
    const repository = new MemoryStateRepository({
      windows: [
        { key: "stable-window", nativeId: 1, name: "Stable", order: 0, isCurrent: true, expanded: true },
        { key: "closed-window", nativeId: 2, name: "Closed project", order: 1, isCurrent: false, expanded: true }
      ],
      workspaces: [],
      tabs: []
    });
    const fake = new FakeBrowser([
      { id: 1, type: "normal", focused: true, tabs: [tab(101, 1, { active: true })] },
      { id: 3, type: "normal", focused: false, tabs: [tab(301, 3, { active: true })] }
    ], []);
    const engine = new BrowserStateEngine({ api: fake.api, repository, debounceMs: 0 });
    await engine.start();

    expect(engine.getState().windows.find((window) => window.nativeId === 1)).toMatchObject({ key: "stable-window", name: "Stable" });
    expect(engine.getState().windows.find((window) => window.nativeId === 3)).toMatchObject({ key: "window:3", name: "Window 2" });
    expect(engine.getState().windows.some((window) => window.key === "closed-window")).toBe(false);
    await engine.stop();
  });

  it("preserves window identities by order after a full browser restart", async () => {
    const repository = new MemoryStateRepository({
      windows: [
        { key: "first-window", nativeId: 1, name: "First", order: 0, isCurrent: true, expanded: true },
        { key: "second-window", nativeId: 2, name: "Second", order: 1, isCurrent: false, expanded: true }
      ],
      workspaces: [],
      tabs: []
    });
    const fake = new FakeBrowser([
      { id: 3, type: "normal", focused: true, tabs: [tab(301, 3, { active: true })] },
      { id: 4, type: "normal", focused: false, tabs: [tab(401, 4, { active: true })] }
    ], []);
    const engine = new BrowserStateEngine({ api: fake.api, repository, debounceMs: 0 });
    await engine.start();

    expect(engine.getState().windows.map((window) => ({ key: window.key, nativeId: window.nativeId, name: window.name }))).toEqual([
      { key: "first-window", nativeId: 3, name: "First" },
      { key: "second-window", nativeId: 4, name: "Second" }
    ]);
    await engine.stop();
  });

  it("recovers the latest tab activation time after a service-worker restart", async () => {
    const fake = new FakeBrowser([
      {
        id: 1,
        type: "normal",
        focused: true,
        tabs: [
          tab(101, 1, { active: true }),
          tab(102, 1, { index: 1, active: false })
        ]
      }
    ], []);
    const repository = new MemoryStateRepository();
    let now = 100;
    const first = new BrowserStateEngine({ api: fake.api, repository, debounceMs: 0, now: () => now });
    await first.start();
    expect(first.getState().tabs.find((item) => item.id === "101")).toMatchObject({ active: true, lastActivatedAt: 100 });
    await first.stop();

    fake.windows[0].tabs[0].active = false;
    fake.windows[0].tabs[1].active = true;
    now = 200;
    const restarted = new BrowserStateEngine({ api: fake.api, repository, debounceMs: 0, now: () => now });
    await restarted.start();

    expect(restarted.getState().tabs.find((item) => item.id === "101")).toMatchObject({ active: false, lastActivatedAt: 100 });
    expect(restarted.getState().tabs.find((item) => item.id === "102")).toMatchObject({ active: true, lastActivatedAt: 200 });
    await restarted.stop();
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

  it("synchronizes workspace order from the native tab-group position", async () => {
    const fake = new FakeBrowser([
      {
        id: 1,
        type: "normal",
        focused: true,
        tabs: [
          tab(101, 1, { groupId: 10, active: true, index: 0 }),
          tab(102, 1, { groupId: 11, index: 1 })
        ]
      }
    ], [
      { id: 10, windowId: 1, title: "First", color: "blue" },
      { id: 11, windowId: 1, title: "Second", color: "green" }
    ]);
    const engine = new BrowserStateEngine({ api: fake.api, repository: new MemoryStateRepository(), debounceMs: 0 });
    await engine.start();
    expect(engine.getState().workspaces.map((workspace) => workspace.groupId)).toEqual([10, 11]);

    fake.windows[0].tabs = [
      { ...fake.windows[0].tabs[1], index: 0 },
      { ...fake.windows[0].tabs[0], index: 1 }
    ];
    await engine.syncFromBrowser();

    expect(engine.getState().workspaces.map((workspace) => workspace.groupId)).toEqual([11, 10]);
    expect(engine.getState().workspaces.map((workspace) => workspace.order)).toEqual([0, 1]);
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

  it("imports the rest of a backup when a special page is blocked and reports the skipped page", async () => {
    await setAppLanguage("en");
    const fake = new FakeBrowser([
      {
        id: 1,
        type: "normal",
        focused: true,
        tabs: [
          tab(101, 1, { groupId: 10, active: true }),
          tab(102, 1, { groupId: 11, index: 1 })
        ]
      }
    ], [
      { id: 10, windowId: 1, title: "Project", color: "blue" },
      { id: 11, windowId: 1, title: "Project (copy)", color: "green" }
    ]);
    fake.failCreateUrls.add("chrome://blocked/");
    const backup = createBackup({
      windows: [{ key: "backup-window", nativeId: 90, name: "Imported window", order: 0, isCurrent: false, expanded: true }],
      workspaces: [{
        id: "backup-workspace",
        windowKey: "backup-window",
        name: "Project",
        description: "Restored project",
        tags: ["restored"],
        color: "purple",
        groupId: 90,
        order: 0,
        createdAt: 1,
        updatedAt: 1
      }],
      tabs: [
        { id: "backup-tab-1", windowKey: "backup-window", workspaceId: "backup-workspace", kind: "normal", url: "https://example.test/one", title: "One", index: 0, pinned: false, groupId: 90 },
        { id: "backup-tab-2", windowKey: "backup-window", workspaceId: "backup-workspace", kind: "normal", url: "https://example.test/two", title: "Two", index: 1, pinned: false, groupId: 90 },
        { id: "backup-special", windowKey: "backup-window", workspaceId: null, kind: "special", url: "chrome://blocked/", title: "Blocked page", index: 2, pinned: false, specialReason: "Browser page" }
      ]
    }, "chrome", "2026-08-24T00:00:00.000Z");
    const engine = new BrowserStateEngine({ api: fake.api, repository: new MemoryStateRepository(), debounceMs: 0 });

    try {
      await engine.start();
      const result = await engine.importBackup(backup);

      expect(result.skippedTabs).toEqual([{
        id: "backup-special",
        title: "Blocked page",
        url: "chrome://blocked/",
        reason: "browser_blocked"
      }]);
      expect(fake.windows).toHaveLength(2);
      const importedWindow = fake.windows.find((window) => window.id !== 1);
      expect(importedWindow?.tabs.map((item) => item.url)).toEqual([
        "https://example.test/one",
        "https://example.test/two"
      ]);
      expect(fake.discardedTabIds).toContain(importedWindow?.tabs[1].id);
      expect(engine.getState().workspaces.find((workspace) => workspace.windowKey !== "window:1")).toMatchObject({
        name: "Project (1)",
        description: "Restored project",
        tags: ["restored"],
        color: "purple"
      });
    } finally {
      await engine.stop();
      await setAppLanguage("zh-CN");
    }
  });

  it("attempts to restore a supported special page and removes the blank placeholder", async () => {
    const fake = new FakeBrowser([
      { id: 1, type: "normal", focused: true, tabs: [tab(101, 1, { active: true })] }
    ], []);
    const backup = createBackup({
      windows: [{ key: "special-window", nativeId: 91, name: "Special pages", order: 0, isCurrent: false, expanded: true }],
      workspaces: [],
      tabs: [{
        id: "special-tab",
        windowKey: "special-window",
        workspaceId: null,
        kind: "special",
        url: "chrome://settings/",
        title: "Settings",
        index: 0,
        pinned: false,
        specialReason: "Browser page"
      }]
    }, "chrome", "2026-08-24T00:00:00.000Z");
    const engine = new BrowserStateEngine({ api: fake.api, repository: new MemoryStateRepository(), debounceMs: 0 });
    await engine.start();

    const result = await engine.importBackup(backup);

    const importedWindow = fake.windows.find((window) => window.id !== 1);
    expect(result.skippedTabs).toEqual([]);
    expect(importedWindow?.tabs.map((item) => item.url)).toEqual(["chrome://settings/"]);
    expect(fake.discardedTabIds).toContain(importedWindow?.tabs[0].id);
    expect(engine.getState().tabs.find((item) => item.windowKey !== "window:1")).toMatchObject({
      kind: "special",
      url: "chrome://settings/"
    });
    await engine.stop();
  });

  it("removes every created window and restores local state when backup grouping fails", async () => {
    const fake = new FakeBrowser([
      { id: 1, type: "normal", focused: true, tabs: [tab(101, 1, { active: true })] }
    ], []);
    const backup = createBackup({
      windows: [{ key: "backup-window", nativeId: 90, name: "Imported", order: 0, isCurrent: false, expanded: true }],
      workspaces: [{ id: "backup-workspace", windowKey: "backup-window", name: "Imported", description: "", tags: [], color: "blue", groupId: 90, order: 0, createdAt: 1, updatedAt: 1 }],
      tabs: [{ id: "backup-tab", windowKey: "backup-window", workspaceId: "backup-workspace", kind: "normal", url: "https://example.test/imported", title: "Imported", index: 0, pinned: false, groupId: 90 }]
    }, "chrome", "2026-08-24T00:00:00.000Z");
    const engine = new BrowserStateEngine({ api: fake.api, repository: new MemoryStateRepository(), debounceMs: 0 });
    await engine.start();
    const before = engine.getState();
    fake.api.tabs.group = async () => { throw new Error("group failed"); };

    await expect(engine.importBackup(backup)).rejects.toThrow("group failed");

    expect(fake.windows.map((window) => window.id)).toEqual([1]);
    expect(fake.removedWindowIds).toEqual([100]);
    expect(engine.getState()).toEqual(before);
    await engine.stop();
  });

  it("rolls back the whole AI apply when a later native tab move fails", async () => {
    const fake = new FakeBrowser([
      { id: 1, type: "normal", focused: true, tabs: [tab(101, 1, { active: true })] },
      { id: 2, type: "normal", focused: false, tabs: [tab(201, 2, { active: true })] }
    ], []);
    const engine = new BrowserStateEngine({ api: fake.api, repository: new MemoryStateRepository(), debounceMs: 0 });
    await engine.start();
    const before = engine.getState();
    const originalMove = fake.api.tabs.move;
    fake.api.tabs.move = async (tabId: number, options: { windowId: number; index: number }) => {
      if (tabId === 201) throw new Error("second move failed");
      return originalMove(tabId, options);
    };
    const sourceTabs = before.tabs.filter((item) => item.id === "101" || item.id === "201");
    const preview = {
      mode: "purpose" as const,
      sourceTabIds: ["101", "201"],
      sourceFingerprint: fingerprintTabs(sourceTabs),
      groups: [{
        id: "combined",
        name: "Combined project",
        description: "",
        tags: [],
        existingWorkspaceId: null,
        tabIds: ["101", "201"]
      }],
      unclassifiedTabIds: []
    };

    await expect(engine.handleUiAction({ action: "organization.apply", payload: { preview, targetWindowKey: "window:1" } }))
      .rejects.toThrow("second move failed");

    expect(engine.getState()).toEqual(before);
    expect(fake.windows.find((window) => window.id === 1)?.tabs.map((item) => item.id)).toEqual([101]);
    expect(fake.windows.find((window) => window.id === 2)?.tabs.map((item) => item.id)).toEqual([201]);
    expect(fake.groups).toEqual([]);
    await engine.stop();
  });

  it("applies the suggested icon and non-grey color to an AI-created workspace", async () => {
    const fake = new FakeBrowser([
      { id: 1, type: "normal", focused: true, tabs: [tab(101, 1, { active: true }), tab(102, 1, { index: 1 })] }
    ], []);
    const engine = new BrowserStateEngine({ api: fake.api, repository: new MemoryStateRepository(), debounceMs: 0 });
    await engine.start();
    const sourceTabs = engine.getState().tabs;
    const preview = {
      mode: "purpose" as const,
      sourceTabIds: ["101", "102"],
      sourceFingerprint: fingerprintTabs(sourceTabs),
      groups: [{
        id: "development",
        name: "Development",
        description: "Active implementation work",
        tags: ["development"],
        icon: "code" as const,
        color: "green",
        existingWorkspaceId: null,
        tabIds: ["101", "102"]
      }],
      unclassifiedTabIds: []
    };

    await engine.handleUiAction({ action: "organization.apply", payload: { preview, targetWindowKey: "window:1" } });

    expect(engine.getState().workspaces[0]).toMatchObject({ name: "Development", icon: "code", color: "green" });
    expect(fake.groupUpdates.at(-1)?.changes).toMatchObject({ title: "Development", color: "green" });
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

  it("aborts the matching provider request when the UI cancels an organization job", async () => {
    const fake = new FakeBrowser([
      { id: 1, type: "normal", focused: true, tabs: [tab(101, 1, { active: true })] }
    ], []);
    const previousChrome = (globalThis as typeof globalThis & { chrome?: unknown }).chrome;
    const previousFetch = globalThis.fetch;
    let observedSignal: AbortSignal | undefined;
    (globalThis as typeof globalThis & { chrome?: unknown }).chrome = {
      storage: {
        local: {
          get: async () => ({
            [AI_CONFIG_STORAGE_KEY]: {
              baseUrl: "https://provider.test/v1",
              apiKey: "sk-test",
              model: "test-model"
            }
          })
        }
      }
    };
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      observedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        observedSignal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    }) as typeof fetch;
    const engine = new BrowserStateEngine({ api: fake.api, repository: new MemoryStateRepository(), debounceMs: 0 });

    try {
      await engine.start();
      const pending = engine.handleUiAction({
        action: "organization.preview",
        payload: { mode: "purpose", tabIds: ["101"], requestId: "request-1" }
      });
      await vi.waitFor(() => expect(observedSignal).toBeDefined());

      await expect(engine.handleUiAction({
        action: "organization.cancel",
        payload: { requestId: "request-1" }
      })).resolves.toEqual({ cancelled: true });
      expect(observedSignal?.aborted).toBe(true);
      await expect(pending).rejects.toMatchObject({ code: "aborted" });
    } finally {
      await engine.stop();
      globalThis.fetch = previousFetch;
      if (previousChrome === undefined) delete (globalThis as typeof globalThis & { chrome?: unknown }).chrome;
      else (globalThis as typeof globalThis & { chrome?: unknown }).chrome = previousChrome;
    }
  });
});
