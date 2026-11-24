import { describe, expect, it, vi } from "vitest";
import { BrowserStateEngine } from "../../src/browser/stateEngine";
import type { BrowserLike } from "../../src/browser/api";
import { MemoryStateRepository } from "../../src/storage/repository";
import { fingerprintTabs } from "../../src/ai";
import { AI_CONFIG_STORAGE_KEY } from "../../src/ai/config";
import * as aiPipeline from "../../src/ai/pipeline";
import { createBackup, type StateSnapshot } from "../../src/shared/backup";
import { getAppLanguage, setAppLanguage, translate } from "../../src/i18n";

type NativeTab = {
  id: number;
  windowId: number;
  groupId: number;
  index: number;
  pinned: boolean;
  incognito?: boolean;
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
  incognito?: boolean;
  tabs: NativeTab[];
};

const event = () => ({ addListener: () => undefined, removeListener: () => undefined });

class FakeBrowser {
  readonly removedWindowIds: number[] = [];
  readonly tabUpdates: Array<{ tabId: number; changes: Record<string, unknown> }> = [];
  readonly groupUpdates: Array<{ groupId: number; changes: Record<string, unknown> }> = [];
  readonly groupMoves: Array<{ groupId: number; index: number }> = [];
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
        remove: async (tabIds: number | number[]) => {
          for (const tabId of Array.isArray(tabIds) ? tabIds : [tabIds]) {
            const found = findTab(tabId);
            found.window.tabs.splice(found.window.tabs.indexOf(found.tab), 1);
            reindex(found.window);
          }
          cleanupGroups();
        },
        discard: async (tabId: number) => {
          findTab(tabId);
          this.discardedTabIds.push(tabId);
          return { ...findTab(tabId).tab };
        },
        move: async (tabId: number, { windowId, index }: { windowId: number; index: number }) => {
          const source = findTab(tabId);
          const target = this.windows.find((window) => window.id === windowId);
          if (!target) throw new Error(`Unknown fake window ${windowId}`);
          source.window.tabs.splice(source.window.tabs.indexOf(source.tab), 1);
          source.tab.groupId = -1;
          target.tabs.splice(index < 0 ? target.tabs.length : index, 0, source.tab);
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
        move: async (groupId: number, { index }: { index: number }) => {
          this.groupMoves.push({ groupId, index });
          return this.groups.find((group) => group.id === groupId);
        },
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
  it("closes eligible tabs in one native call and preserves special pages", async () => {
    const fake = new FakeBrowser([
      { id: 1, type: "normal", focused: true, tabs: [tab(101, 1, { url: "chrome://settings/" })] },
      { id: 2, type: "normal", focused: false, tabs: [tab(201, 2), tab(202, 2, { pinned: true })] }
    ], []);
    const repository = new MemoryStateRepository();
    const engine = new BrowserStateEngine({ api: fake.api, repository, debounceMs: 60_000 });
    const remove = vi.spyOn(fake.api.tabs, "remove");
    await engine.start();

    try {
      const result = await engine.handleUiAction({ action: "tab.close", payload: { tabIds: ["201", "101", "202", "999", "201"] } });

      expect(result).toMatchObject({
        ok: true,
        result: { closedTabIds: ["201", "202"], skippedTabIds: ["101", "999"] },
        snapshot: { tabs: [{ id: "101", kind: "special" }] }
      });
      expect(remove).toHaveBeenCalledOnce();
      expect(remove.mock.calls[0][0]).toEqual([201, 202]);
      expect(fake.removedWindowIds).toEqual([2]);
      await expect(repository.load()).resolves.toEqual(engine.getState());
    } finally {
      await engine.stop();
    }
  });

  it("ungroups a tab before pinning, unpins it, and preserves special pages", async () => {
    const fake = new FakeBrowser([
      { id: 1, type: "normal", focused: true, tabs: [
        tab(101, 1, { groupId: 10 }),
        tab(102, 1, { url: "chrome://settings/" })
      ] }
    ], [{ id: 10, windowId: 1, title: "Research", color: "blue" }]);
    const repository = new MemoryStateRepository();
    const engine = new BrowserStateEngine({ api: fake.api, repository, debounceMs: 60_000 });
    const ungroup = vi.spyOn(fake.api.tabs, "ungroup");
    const update = vi.spyOn(fake.api.tabs, "update");
    const setPinned = (tabId: string, pinned: boolean) => engine.handleUiAction({ action: "tab.pin", payload: { tabId, pinned } });
    await engine.start();

    try {
      await expect(setPinned("101", true)).resolves.toMatchObject({
        ok: true,
        snapshot: { tabs: expect.arrayContaining([{ ...engine.getState().tabs[0], kind: "fixed", pinned: true, workspaceId: null, groupId: undefined }]) }
      });
      expect(ungroup.mock.calls[0][0]).toEqual([101]);
      expect(ungroup.mock.invocationCallOrder[0]).toBeLessThan(update.mock.invocationCallOrder[0]);
      await expect(repository.load()).resolves.toEqual(engine.getState());

      await expect(setPinned("101", false)).resolves.toMatchObject({ ok: true });
      expect(engine.getState().tabs.find((item) => item.id === "101")).toMatchObject({ kind: "normal", pinned: false });
      await expect(repository.load()).resolves.toEqual(engine.getState());

      await expect(setPinned("102", true)).resolves.toMatchObject({ ok: true });
      await expect(setPinned("999", true)).rejects.toThrow(translate(getAppLanguage(), "error.tabMissing"));
      expect(engine.getState().tabs.find((item) => item.id === "102")).toMatchObject({ kind: "special", pinned: false });
      expect(ungroup).toHaveBeenCalledOnce();
      expect(fake.tabUpdates).toEqual([
        { tabId: 101, changes: { pinned: true } },
        { tabId: 101, changes: { pinned: false } }
      ]);
    } finally {
      await engine.stop();
    }
  });

  it("adjusts a native group target index after removing an earlier source group", async () => {
    const fake = new FakeBrowser([{
      id: 1,
      type: "normal",
      focused: true,
      tabs: [
        tab(101, 1, { groupId: 10, active: true, index: 0 }),
        tab(102, 1, { groupId: 10, index: 1 }),
        tab(103, 1, { groupId: -1, index: 2 }),
        tab(104, 1, { groupId: 20, index: 3 }),
        tab(105, 1, { groupId: 20, index: 4 }),
        tab(106, 1, { groupId: 20, index: 5 })
      ]
    }], [
      { id: 10, windowId: 1, title: "Source", color: "blue" },
      { id: 20, windowId: 1, title: "Target", color: "green" }
    ]);
    const engine = new BrowserStateEngine({ api: fake.api, repository: new MemoryStateRepository(), debounceMs: 0 });
    await engine.start();
    const source = engine.getState().workspaces.find((workspace) => workspace.groupId === 10)!;
    const target = engine.getState().workspaces.find((workspace) => workspace.groupId === 20)!;

    await engine.moveWorkspace(source.id, target.id);

    expect(fake.groupMoves).toEqual([{ groupId: 10, index: 1 }]);
    await engine.stop();
  });

  it("coalesces concurrent browser syncs and waits for the final reconciliation", async () => {
    const fake = new FakeBrowser([{
      id: 1,
      type: "normal",
      focused: true,
      tabs: [tab(101, 1, { active: true })]
    }], []);
    const engine = new BrowserStateEngine({ api: fake.api, repository: new MemoryStateRepository(), debounceMs: 0 });
    await engine.start();

    const originalGetAll = fake.api.windows.getAll as () => Promise<NativeWindow[]>;
    let releaseFirst: (() => void) | undefined;
    let calls = 0;
    fake.api.windows.getAll = async () => {
      calls += 1;
      const captured = await originalGetAll();
      if (calls === 1) await new Promise<void>((resolve) => { releaseFirst = resolve; });
      return captured;
    };

    const first = engine.syncFromBrowser();
    await vi.waitFor(() => expect(releaseFirst).toBeTypeOf("function"));
    fake.windows[0].tabs.push(tab(102, 1, { index: 1 }));
    let secondResolved = false;
    const second = engine.syncFromBrowser().then((value) => {
      secondResolved = true;
      return value;
    });
    await Promise.resolve();
    expect(secondResolved).toBe(false);

    releaseFirst?.();
    await Promise.all([first, second]);

    expect(calls).toBe(2);
    expect(engine.getState().tabs.map((item) => item.id)).toContain("102");
    await engine.stop();
  });

  it("skips persistence and subscriber updates when a refresh changes zero fields", async () => {
    const fake = new FakeBrowser([
      { id: 1, type: "normal", focused: true, tabs: [tab(101, 1, { active: true, groupId: 10 })] }
    ], [{ id: 10, windowId: 1, title: "Project", color: "blue" }]);
    const repository = new MemoryStateRepository();
    const replace = vi.spyOn(repository, "replace");
    const engine = new BrowserStateEngine({ api: fake.api, repository, debounceMs: 60_000 });
    const snapshots = vi.fn();
    const unsubscribe = engine.subscribe(snapshots);

    try {
      await engine.start();
      await engine.flush();
      const initial = engine.getState();
      expect(replace).toHaveBeenCalledExactlyOnceWith(initial);
      expect(snapshots).toHaveBeenCalledTimes(2);

      await expect(engine.handleRequest({ type: "panekeep/refresh" })).resolves.toEqual(initial);
      await engine.flush();
      expect(replace).toHaveBeenCalledTimes(1);
      expect(snapshots).toHaveBeenCalledTimes(2);

      fake.windows[0].tabs[0].title = "Updated title";
      await engine.syncFromBrowser();
      await engine.flush();
      expect(replace).toHaveBeenCalledTimes(2);
      expect(snapshots).toHaveBeenCalledTimes(3);
      expect(snapshots).toHaveBeenLastCalledWith(engine.getState());
      expect(engine.getState().tabs[0].title).toBe("Updated title");
    } finally {
      unsubscribe();
      await engine.stop();
    }

    const restarted = new BrowserStateEngine({ api: fake.api, repository, debounceMs: 60_000 });
    const restored = vi.fn();
    const unsubscribeRestarted = restarted.subscribe(restored);
    try {
      await restarted.start();
      await restarted.flush();
      expect(replace).toHaveBeenCalledTimes(2);
      expect(restored).toHaveBeenCalledTimes(2);
      expect(restored).toHaveBeenLastCalledWith(engine.getState());
    } finally {
      unsubscribeRestarted();
      await restarted.stop();
    }
  });

  it("syncs tab metadata changes and skips tab update noise", async () => {
    vi.useFakeTimers();
    const fake = new FakeBrowser([
      { id: 1, type: "normal", focused: true, tabs: [tab(101, 1)] }
    ], []);
    const listen = vi.spyOn(fake.api.tabs.onUpdated, "addListener");
    const getAll = vi.spyOn(fake.api.windows, "getAll");
    const engine = new BrowserStateEngine({ api: fake.api, repository: new MemoryStateRepository(), debounceMs: 60_000 });

    try {
      await engine.start();
      getAll.mockClear();
      const [onUpdated] = listen.mock.calls[0];
      onUpdated(101, { audible: true });
      onUpdated(101, { mutedInfo: { muted: true }, attention: true, isArticle: true });
      onUpdated(101, { status: "loading" });
      await vi.advanceTimersByTimeAsync(0);
      expect(getAll).toHaveBeenCalledTimes(0);

      fake.windows[0].tabs[0].title = "Updated title";
      onUpdated(101, { title: "Updated title", audible: false });
      await vi.advanceTimersByTimeAsync(0);
      expect(getAll).toHaveBeenCalledTimes(1);
      expect(engine.getState().tabs[0].title).toBe("Updated title");

      fake.windows[0].tabs[0].url = "https://updated.test/";
      onUpdated(101, { url: "https://updated.test/" });
      await vi.advanceTimersByTimeAsync(0);
      expect(getAll).toHaveBeenCalledTimes(2);
      expect(engine.getState().tabs[0].url).toBe("https://updated.test/");

      for (const [index, changeInfo] of [
        { favIconUrl: "" }, { pinned: false }, { groupId: -1 }, { status: "complete" }, undefined
      ].entries()) {
        onUpdated(101, changeInfo);
        await vi.advanceTimersByTimeAsync(0);
        expect(getAll).toHaveBeenCalledTimes(index + 3);
      }
    } finally {
      await engine.stop();
      vi.useRealTimers();
    }
  });

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

  it("moves a tab into another window's unclassified area", async () => {
    const fake = new FakeBrowser([
      { id: 1, type: "normal", focused: true, tabs: [tab(101, 1, { active: true }), tab(102, 1, { index: 1 })] },
      { id: 2, type: "normal", focused: false, tabs: [tab(201, 2, { active: true })] }
    ], []);
    const engine = new BrowserStateEngine({ api: fake.api, repository: new MemoryStateRepository(), debounceMs: 0 });
    await engine.start();

    const response = await engine.handleUiAction({
      action: "tabs.move",
      payload: { tabIds: ["101"], workspaceId: null, windowKey: "window:2" }
    }) as { result: Awaited<ReturnType<BrowserStateEngine["moveTabs"]>> };
    const result = response.result;

    expect(result.movedTabIds).toEqual(["101"]);
    expect(result.skippedTabIds).toEqual([]);
    expect(engine.getState().tabs.find((item) => item.id === "101")).toMatchObject({
      windowKey: "window:2",
      workspaceId: null
    });
    expect(fake.windows.find((window) => window.id === 2)?.tabs.map((item) => item.id)).toEqual([201, 101]);
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
      { id: 2, type: "normal", focused: false, tabs: [tab(201, 2, { groupId: 20 })] },
      { id: 3, type: "normal", focused: false, tabs: [tab(301, 3, { groupId: 30 }), tab(302, 3, { index: 1 })] }
    ], [
      { id: 10, windowId: 1, title: "Source", color: "red" },
      { id: 20, windowId: 2, title: "Target", color: "blue" },
      { id: 30, windowId: 3, title: "Independent", color: "yellow" }
    ]);
    const repository = new MemoryStateRepository();
    const engine = new BrowserStateEngine({ api: fake.api, repository });
    await engine.start();
    const source = engine.getState().workspaces.find((workspace) => workspace.groupId === 10)!;
    const target = engine.getState().workspaces.find((workspace) => workspace.groupId === 20)!;
    const before = engine.getState();
    const preview = engine.createWorkspaceMergePreview(source.id, target.id);
    const originalMove = fake.api.tabs.move;
    const move = vi.spyOn(fake.api.tabs, "move").mockImplementation(async (tabId: number, options: { windowId: number; index: number }) => {
      if (tabId === 102 && options.windowId === 2) {
        fake.groups.find((group) => group.id === 30)!.title = "Independent rename";
        throw new Error("merge move failed");
      }
      return originalMove(tabId, options);
    });

    await expect(engine.mergeWorkspaces(preview)).rejects.toThrow("无法移动标签 102");
    const state = engine.getState();
    expect(state.tabs).toEqual(before.tabs);
    expect(state.workspaces).toEqual(before.workspaces.map((workspace) => workspace.groupId === 30
      ? { ...workspace, name: "Independent rename" }
      : workspace));
    await expect(repository.load()).resolves.toEqual(state);
    expect(move.mock.calls.map(([tabId]) => tabId)).toEqual([101, 102, 101]);
    expect(fake.windows.find((window) => window.id === 1)?.tabs.map((item) => item.id)).toEqual([101, 102]);
    expect(fake.windows.find((window) => window.id === 2)?.tabs.map((item) => item.id)).toEqual([201]);
    expect(fake.windows.find((window) => window.id === 3)?.tabs.map((item) => item.id)).toEqual([301, 302]);
    await engine.stop();
  });

  it("recreates the original native group and restores a pre-existing empty merge target", async () => {
    const fake = new FakeBrowser([
      { id: 1, type: "normal", focused: true, tabs: [tab(101, 1, { groupId: 10 })] },
      { id: 2, type: "normal", focused: false, tabs: [tab(201, 2)] }
    ], [{ id: 10, windowId: 1, title: "Source", color: "red" }]);
    const repository = new MemoryStateRepository();
    const engine = new BrowserStateEngine({ api: fake.api, repository });
    await engine.start();
    const source = await engine.updateWorkspace(engine.getState().workspaces[0].id, {
      description: "Original details", icon: "shield", tags: ["original"]
    });
    await engine.createWorkspace({ windowId: 2, name: "Empty target", icon: "plane" });
    const target = engine.getState().workspaces.find((workspace) => workspace.name === "Empty target")!;
    const failure = new Error("Could not set the new group title");
    vi.spyOn(fake.api.tabGroups!, "update").mockRejectedValueOnce(failure);

    await expect(engine.mergeWorkspaces(engine.createWorkspaceMergePreview(source.id, target.id))).rejects.toBe(failure);

    const state = engine.getState();
    const restored = state.workspaces.find((workspace) => workspace.id === source.id)!;
    expect(restored.groupId).toBe(101);
    expect(restored).toEqual({ ...source, groupId: restored.groupId });
    expect(state.workspaces.find((workspace) => workspace.id === target.id)).toEqual(target);
    expect(fake.groups).toEqual([{ id: restored.groupId, windowId: 1, title: "Source", color: "red" }]);
    expect(state.tabs.find((item) => item.id === "101")).toMatchObject({
      windowKey: source.windowKey, groupId: restored.groupId, workspaceId: source.id
    });
    await expect(repository.load()).resolves.toEqual(state);
    await engine.stop();
  });

  it("publishes the restored workspaces when an AI move fails before changing browser tabs", async () => {
    const fake = new FakeBrowser([
      { id: 1, type: "normal", focused: true, tabs: [tab(101, 1)] }
    ], []);
    const repository = new MemoryStateRepository();
    const engine = new BrowserStateEngine({ api: fake.api, repository, debounceMs: 60_000 });
    const listener = vi.fn();
    const unsubscribe = engine.subscribe(listener);
    try {
      await engine.start();
      const original = engine.getState();
      vi.spyOn(fake.api.tabs, "move").mockRejectedValueOnce(new Error("Could not move the tab"));

      await expect(engine.handleUiAction({ action: "organization.apply", payload: { preview: {
        mode: "purpose", sourceTabIds: ["101"], sourceFingerprint: fingerprintTabs(original.tabs),
        groups: [{ id: "project", name: "Project", tabIds: ["101"], existingWorkspaceId: null }],
        unclassifiedTabIds: []
      } } })).rejects.toThrow();

      expect(listener).toHaveBeenLastCalledWith(original);
      expect(engine.getState()).toEqual(original);
      await expect(repository.load()).resolves.toEqual(original);
    } finally {
      unsubscribe();
      await engine.stop();
    }
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

  it("applies an edit to the latest workspace after native update overlaps a refresh", async () => {
    const fake = new FakeBrowser([
      { id: 1, type: "normal", focused: true, tabs: [tab(101, 1, { groupId: 10 })] }
    ], [{ id: 10, windowId: 1, title: "Before", color: "blue" }]);
    const repository = new MemoryStateRepository();
    const engine = new BrowserStateEngine({ api: fake.api, repository });
    await engine.start();
    const workspaceId = engine.getState().workspaces[0].id;
    const update = fake.api.tabGroups!.update;
    let finishUpdate: (() => void) | undefined;
    fake.api.tabGroups!.update = async (groupId: number, changes: Record<string, unknown>) => {
      const result = await update(groupId, changes);
      await new Promise<void>((resolve) => { finishUpdate = resolve; });
      return result;
    };

    const pending = engine.updateWorkspace(workspaceId, { name: "After", description: "Edited details", icon: "shield" });
    await vi.waitFor(() => expect(finishUpdate).toBeTypeOf("function"));
    fake.groups[0].color = "purple";
    await engine.syncFromBrowser();
    await engine.updateWorkspace(workspaceId, { tags: ["updated during refresh"] });
    finishUpdate?.();

    await expect(pending).resolves.toMatchObject({
      name: "After", description: "Edited details", icon: "shield", color: "purple", tags: ["updated during refresh"]
    });
    expect(fake.groupUpdates).toEqual([{ groupId: 10, changes: { title: "After" } }]);
    await expect(repository.load()).resolves.toEqual(engine.getState());
    await engine.stop();
  });

  it("adopts the native title and keeps local edits made while the native groups are being read", async () => {
    const fake = new FakeBrowser([
      { id: 1, type: "normal", focused: true, tabs: [tab(101, 1, { groupId: 10 })] }
    ], [{ id: 10, windowId: 1, title: "Before", color: "blue" }]);
    const engine = new BrowserStateEngine({ api: fake.api, repository: new MemoryStateRepository() });
    await engine.start();
    const workspaceId = engine.getState().workspaces[0].id;
    fake.groups[0].title = "  Browser rename  ";
    const query = fake.api.tabGroups!.query;
    let finishQuery: (() => void) | undefined;
    const groupQuery = vi.spyOn(fake.api.tabGroups!, "query").mockImplementationOnce(async (options: { windowId: number }) => {
      const groups = await query(options);
      await new Promise<void>((resolve) => { finishQuery = resolve; });
      return groups;
    });
    const sync = engine.syncFromBrowser();
    await vi.waitFor(() => expect(finishQuery).toBeTypeOf("function"));
    await engine.updateWorkspace(workspaceId, {
      name: " Before ", color: "blue", description: "Local description", tags: ["local"], icon: "plane", order: 4
    });
    expect(engine.getState().workspaces[0].order).toBe(4);
    expect(fake.groupUpdates).toEqual([]);
    finishQuery?.();
    await sync;
    groupQuery.mockRestore();

    const expected = { id: workspaceId, name: "Browser rename", description: "Local description", tags: ["local"], icon: "plane" };
    expect(engine.getState().workspaces[0]).toMatchObject(expected);
    fake.groups[0].title = "  ";
    await engine.syncFromBrowser();
    expect(engine.getState().workspaces[0]).toMatchObject(expected);
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

  it.each([10, 20])("keeps an inserted native group separate when deleting group %i", async (groupToDelete) => {
    const originalGroup = { id: 10, windowId: 1, title: "Research", color: "blue" };
    const fake = new FakeBrowser([
      { id: 1, type: "normal", focused: true, tabs: [tab(101, 1, { groupId: 10 })] }
    ], [originalGroup]);
    const repository = new MemoryStateRepository({
      windows: [{ key: "window:1", nativeId: 1, name: "Window 1", order: 0, isCurrent: true, expanded: false }],
      // A restored workspace can carry the default ID of a different group.
      workspaces: [{
        id: "workspace:1:20", windowKey: "window:1", groupId: 10, name: "Research",
        description: "Original metadata", tags: [], color: "blue", icon: "folder", order: 0, createdAt: 0, updatedAt: 0
      }],
      tabs: []
    });
    const engine = new BrowserStateEngine({ api: fake.api, repository, debounceMs: 0 });
    await engine.start();
    const original = engine.getState().workspaces[0];

    fake.groups.unshift({ ...originalGroup, id: 20 });
    fake.windows[0].tabs[0].index = 1;
    fake.windows[0].tabs.unshift(tab(201, 1, { groupId: 20 }));
    const state = await engine.syncFromBrowser();

    const inserted = state.workspaces[0];
    expect(new Set(state.workspaces.map((workspace) => workspace.id)).size).toBe(2);
    expect(inserted).toMatchObject({ groupId: 20, description: "" });
    expect(state.workspaces[1]).toMatchObject({ id: original.id, groupId: 10, description: "Original metadata" });
    expect(state.tabs.map((item) => item.workspaceId)).toEqual([inserted.id, original.id]);

    const target = state.workspaces.find((workspace) => workspace.groupId === groupToDelete)!;
    const sibling = groupToDelete === 10 ? inserted : original;
    await engine.deleteWorkspace(target.id, true);

    expect(fake.windows[0].tabs.map((item) => item.id)).toEqual([groupToDelete === 10 ? 201 : 101]);
    expect(engine.getState().workspaces).toMatchObject([{ id: sibling.id, groupId: sibling.groupId }]);
    expect(engine.getState().tabs.map((item) => item.workspaceId)).toEqual([sibling.id]);
    await engine.stop();
  });

  it("uses live native group membership and preserves special tabs when closing a workspace", async () => {
    const fake = new FakeBrowser([
      { id: 1, type: "normal", focused: true, tabs: [
        tab(101, 1, { groupId: 10 }),
        tab(102, 1, { groupId: 20, index: 1 }),
        tab(103, 1, { groupId: 20, index: 2 }),
        tab(104, 1, { index: 3, url: "chrome://settings" })
      ] }
    ], [
      { id: 10, windowId: 1, title: "Target", color: "blue" },
      { id: 20, windowId: 1, title: "Sibling", color: "green" }
    ]);
    const engine = new BrowserStateEngine({ api: fake.api, repository: new MemoryStateRepository(), debounceMs: 0 });
    await engine.start();
    const target = engine.getState().workspaces.find((workspace) => workspace.groupId === 10)!;

    fake.windows[0].tabs[0].groupId = 20;
    fake.windows[0].tabs[1].groupId = 10;
    fake.windows[0].tabs[3].groupId = 10;
    await engine.deleteWorkspace(target.id, true);

    expect(fake.windows[0].tabs.map(({ id, groupId }) => [id, groupId])).toEqual([[101, 20], [103, 20], [104, 10]]);
    expect(engine.getState().tabs.map((item) => item.id)).toEqual(["101", "103", "104"]);
    await engine.stop();
  });

  it("assigns a fresh ID to a replacement group in the same browser session", async () => {
    const group = { id: 10, windowId: 1, title: "Research", color: "blue" };
    const fake = new FakeBrowser([
      { id: 1, type: "normal", focused: true, tabs: [tab(101, 1, { groupId: 10 })] }
    ], [group]);
    const repository = new MemoryStateRepository();
    const engine = new BrowserStateEngine({ api: fake.api, repository, debounceMs: 0 });
    await engine.start();
    const original = await engine.updateWorkspace(engine.getState().workspaces[0].id, { description: "Original metadata" });
    await engine.stop();

    fake.groups[0] = { ...group, id: 20 };
    fake.windows[0].tabs = [tab(201, 1, { groupId: 20 })];
    const restarted = new BrowserStateEngine({ api: fake.api, repository, debounceMs: 0 });
    await restarted.start();

    expect(restarted.getState().workspaces).toMatchObject([{ groupId: 20, description: "" }]);
    expect(restarted.getState().workspaces[0].id).not.toBe(original.id);
    await restarted.stop();
  });

  it("restores unique workspace metadata after native window IDs change", async () => {
    const fake = new FakeBrowser([
      { id: 1, type: "normal", focused: true, tabs: [
        tab(101, 1, { groupId: 10 }), tab(102, 1, { groupId: 11, index: 1 }), tab(103, 1, { groupId: 12, index: 2 })
      ] }
    ], [
      { id: 10, windowId: 1, title: "Named", color: "blue" },
      { id: 11, windowId: 1, title: "Exact", color: "green" },
      { id: 12, windowId: 1, title: "Position", color: "red" }
    ]);
    const repository = new MemoryStateRepository();
    const engine = new BrowserStateEngine({ api: fake.api, repository, debounceMs: 0 });
    await engine.start();
    const [named, exact, position] = engine.getState().workspaces;
    await engine.stop();

    const restoredBrowser = new FakeBrowser([
      { id: 2, type: "normal", focused: true, tabs: [
        tab(201, 2, { groupId: 11 }), tab(202, 2, { groupId: 21, index: 1 }), tab(203, 2, { groupId: 22, index: 2 })
      ] }
    ], [
      { id: 11, windowId: 2, title: "Named", color: "blue" },
      { id: 21, windowId: 2, title: "Named", color: "blue" },
      { id: 22, windowId: 2, title: "Renamed", color: "yellow" }
    ]);
    const restored = new BrowserStateEngine({ api: restoredBrowser.api, repository, debounceMs: 0 });
    await restored.start();

    expect(restored.getState().workspaces.map(({ id, groupId }) => [id, groupId])).toEqual([
      [exact.id, 11], [named.id, 21], [position.id, 22]
    ]);
    await restored.stop();
  });

  it.each([true, false])("excludes incognito data when getAll includes the private window: %s", async (listsPrivateWindow) => {
    const fake = new FakeBrowser([
      { id: 1, type: "normal", focused: false, tabs: [
        tab(101, 1, { groupId: 10 }), tab(102, 1, { index: 1 })
      ] },
      { id: 2, type: "normal", focused: true, incognito: true, tabs: [
        tab(201, 2, { groupId: 20, url: "https://private.test/grouped" }),
        tab(202, 2, { index: 1, url: "https://private.test/ungrouped" })
      ] }
    ], [
      { id: 10, windowId: 1, title: "Public workspace", color: "blue" },
      { id: 20, windowId: 2, title: "Private workspace", color: "green" }
    ]);
    if (!listsPrivateWindow) {
      const getAll = fake.api.windows.getAll as () => Promise<NativeWindow[]>;
      fake.api.windows.getAll = async () => (await getAll()).filter((window) => window.incognito !== true);
    }
    const repository = new MemoryStateRepository({
      windows: [{ key: "window:2", nativeId: 2, name: "Private window", order: 0, isCurrent: true, expanded: false }],
      workspaces: [{
        id: "private-workspace", windowKey: "window:2", groupId: 20, name: "Private workspace",
        description: "Private metadata", tags: [], color: "green", icon: "folder", order: 0, createdAt: 0, updatedAt: 0
      }],
      tabs: [{
        id: "201", windowKey: "window:2", workspaceId: "private-workspace", groupId: 20,
        kind: "normal", url: "https://private.test/grouped", index: 0, pinned: false
      }]
    });
    const snapshots = vi.fn<(snapshot: StateSnapshot) => void>();
    const groupQuery = vi.spyOn(fake.api.tabGroups!, "query");
    const preview = vi.spyOn(aiPipeline, "organizeTabs").mockResolvedValue({
      mode: "purpose", sourceTabIds: ["102"], sourceFingerprint: "preview", groups: [], unclassifiedTabIds: ["102"]
    });
    vi.stubGlobal("chrome", {
      storage: { local: { get: async () => ({
        [AI_CONFIG_STORAGE_KEY]: { baseUrl: "https://provider.test/v1", apiKey: "sk-test", model: "test-model" }
      }) } }
    });

    const engine = new BrowserStateEngine({ api: fake.api, repository, debounceMs: 0 });
    const unsubscribe = engine.subscribe(snapshots);
    try {
      await engine.start();
      const state = await engine.syncFromBrowser();
      expect(state).toEqual(engine.getState());
      expect(state.windows).toMatchObject([{ key: "window:1", nativeId: 1, name: "Window 1", isCurrent: false }]);
      expect(state.workspaces).toMatchObject([{ groupId: 10, name: "Public workspace", description: "" }]);
      expect(state.tabs.map((item) => item.id)).toEqual(["101", "102"]);
      expect(snapshots.mock.calls.map(([snapshot]) => snapshot.windows.map((window) => window.nativeId)))
        .toEqual([[], [1]]);
      expect(groupQuery.mock.calls.map(([query]) => query)).toEqual([{ windowId: 1 }, { windowId: 1 }]);

      await engine.flush();
      await expect(repository.load()).resolves.toEqual(state);
      const backup = await engine.exportBackup(true);
      expect(JSON.parse(backup as string)).toMatchObject(state);
      expect(backup).not.toContain("private.test");

      await engine.handleUiAction({ action: "organization.preview", payload: { tabIds: ["102", "201", "202"] } });
      expect(preview).toHaveBeenCalledOnce();
      expect(preview).toHaveBeenCalledWith(expect.objectContaining({
        tabs: [state.tabs[1]], existingWorkspaces: state.workspaces
      }));
    } finally {
      unsubscribe();
      await engine.stop();
      preview.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("writes a clean empty state when startup only finds persisted private records", async () => {
    const fake = new FakeBrowser([
      { id: 2, type: "normal", focused: true, incognito: true, tabs: [tab(201, 2)] }
    ], []);
    const repository = new MemoryStateRepository({
      windows: [{ key: "window:2", nativeId: 2, name: "Private window", order: 0, isCurrent: true, expanded: false }],
      workspaces: [],
      tabs: [{ id: "201", windowKey: "window:2", workspaceId: null, kind: "normal", url: "https://private.test/", index: 0, pinned: false }]
    });
    const replace = vi.spyOn(repository, "replace");
    const engine = new BrowserStateEngine({ api: fake.api, repository, debounceMs: 60_000 });
    const snapshots = vi.fn();
    const unsubscribe = engine.subscribe(snapshots);
    try {
      await engine.start();
      await engine.flush();
      const empty = { windows: [], workspaces: [], tabs: [] };
      expect(replace).toHaveBeenCalledExactlyOnceWith(empty);
      expect(snapshots.mock.calls).toEqual([[empty], [empty]]);
    } finally {
      unsubscribe();
      await engine.stop();
    }
  });

  it("scopes direct tab queries to managed windows and preserves empty incognito windows", async () => {
    const fake = new FakeBrowser([
      { id: 1, type: "normal", focused: true, tabs: [tab(101, 1)] },
      { id: 2, type: "normal", focused: false, incognito: true, tabs: [tab(201, 2)] },
      { id: 3, type: "normal", focused: false, incognito: true, tabs: [] },
      { id: 4, type: "normal", focused: false, tabs: [] }
    ], []);
    fake.api.windows.getAll = async () => fake.windows.map(({ tabs: _tabs, ...window }) => window);
    fake.api.windows.getLastFocused = async () => { throw new Error("Last focused window unavailable"); };
    fake.api.windows.getCurrent = async () => fake.windows[1];
    const query = vi.spyOn(fake.api.tabs, "query").mockImplementation(async ({ windowId }: { windowId: number }) =>
      windowId === 1 ? [tab(101, 1), tab(201, 2), tab(202, 1, { incognito: true })] : []
    );
    const engine = new BrowserStateEngine({ api: fake.api, repository: new MemoryStateRepository(), debounceMs: 0 });
    await engine.start();

    expect(engine.getState().tabs.map((item) => item.id)).toEqual(["101"]);
    expect(engine.getState().windows.find((window) => window.isCurrent)?.nativeId).toBe(1);
    await expect(engine.closeEmptyWindows()).resolves.toEqual({ closedWindowIds: [4] });
    expect(fake.windows.map((window) => window.id)).toEqual([1, 2, 3]);
    expect(new Set(query.mock.calls.map(([options]) => options.windowId))).toEqual(new Set([1, 4]));
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

  it("deletes a workspace and closes its tabs when explicitly requested", async () => {
    const fake = new FakeBrowser([
      { id: 1, type: "normal", focused: true, tabs: [
        tab(101, 1, { groupId: 10, active: true }),
        tab(102, 1, { groupId: 10, index: 1 }),
        tab(103, 1, { groupId: -1, index: 2 })
      ] }
    ], [{ id: 10, windowId: 1, title: "Current work", color: "blue" }]);
    const engine = new BrowserStateEngine({ api: fake.api, repository: new MemoryStateRepository(), debounceMs: 0 });
    await engine.start();

    await engine.handleUiAction({
      action: "workspace.delete",
      payload: { id: engine.getState().workspaces[0].id, closeTabs: true }
    });

    expect(fake.windows[0].tabs.map((item) => item.id)).toEqual([103]);
    expect(engine.getState().workspaces).toEqual([]);
    expect(engine.getState().tabs.map((item) => item.id)).toEqual(["103"]);
    await engine.stop();
  });

  it("restores grouped and empty workspaces with their icons while reporting a blocked special page", async () => {
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
        icon: "shield",
        groupId: 90,
        order: 0,
        createdAt: 1,
        updatedAt: 1
      }, {
        id: "backup-empty-workspace",
        windowKey: "backup-window",
        name: "Project",
        description: "Empty project",
        tags: ["empty"],
        color: "cyan",
        icon: "plane",
        order: 3,
        createdAt: 1,
        updatedAt: 1
      }],
      tabs: [
        { id: "backup-tab-1", windowKey: "backup-window", workspaceId: "backup-workspace", kind: "normal", url: "https://example.test/one", title: "One", index: 0, pinned: false, groupId: 90 },
        { id: "backup-tab-2", windowKey: "backup-window", workspaceId: "backup-workspace", kind: "normal", url: "https://example.test/two", title: "Two", index: 1, pinned: false, groupId: 90 },
        { id: "backup-special", windowKey: "backup-window", workspaceId: null, kind: "special", url: "chrome://blocked/", title: "Blocked page", index: 2, pinned: false, specialReason: "Browser page" }
      ]
    }, "chrome", "2026-08-24T00:00:00.000Z");
    const repository = new MemoryStateRepository();
    const engine = new BrowserStateEngine({ api: fake.api, repository, debounceMs: 0 });

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
      const [grouped, empty] = engine.getState().workspaces.filter((workspace) => workspace.windowKey !== "window:1");
      expect(grouped).toMatchObject({
        name: "Project (1)",
        description: "Restored project",
        tags: ["restored"],
        color: "purple",
        icon: "shield"
      });
      expect(empty).toMatchObject({
        windowKey: grouped.windowKey, name: "Project (2)", description: "Empty project",
        tags: ["empty"], color: "cyan", icon: "plane", order: 3
      });
      expect(empty.groupId).toBeUndefined();
      await expect(repository.load()).resolves.toEqual(engine.getState());
      await engine.syncFromBrowser();
      expect(engine.getState().workspaces.filter((workspace) => workspace.windowKey === grouped.windowKey)).toEqual([grouped, empty]);
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

  it("rolls back the selected AI tabs and its new native group after a later move fails", async () => {
    const fake = new FakeBrowser([
      { id: 1, type: "normal", focused: true, tabs: [tab(101, 1, { active: true })] },
      { id: 2, type: "normal", focused: false, tabs: [tab(201, 2, { active: true })] },
      { id: 3, type: "normal", focused: false, tabs: [tab(301, 3, { active: true })] }
    ], []);
    const repository = new MemoryStateRepository();
    const engine = new BrowserStateEngine({ api: fake.api, repository });
    await engine.start();
    const before = engine.getState();
    const originalMove = fake.api.tabs.move;
    const move = vi.spyOn(fake.api.tabs, "move").mockImplementation(async (tabId: number, options: { windowId: number; index: number }) => {
      if (tabId === 201) {
        fake.groups.push({ id: 30, windowId: 3, title: "Independent group", color: "blue" });
        fake.windows[2].tabs[0].groupId = 30;
        throw new Error("second move failed");
      }
      return originalMove(tabId, options);
    });
    const removeGroup = vi.fn(async (_groupId: number) => undefined);
    fake.api.tabGroups!.remove = removeGroup;
    const sourceTabs = before.tabs.filter((item) => item.id === "101" || item.id === "201");
    const preview = {
      mode: "purpose" as const,
      sourceTabIds: ["101", "201"],
      sourceFingerprint: fingerprintTabs(sourceTabs),
      groups: [101, 201].map((id) => ({
        id: `group-${id}`,
        name: `Project ${id}`,
        description: "",
        tags: [],
        existingWorkspaceId: null,
        tabIds: [String(id)]
      })),
      unclassifiedTabIds: []
    };

    await expect(engine.handleUiAction({ action: "organization.apply", payload: { preview, targetWindowKey: "window:1" } }))
      .rejects.toThrow("无法移动标签 201");

    const state = engine.getState();
    expect(state.tabs.filter((item) => item.windowKey !== "window:3")).toEqual(sourceTabs);
    expect(state.workspaces).toMatchObject([{ groupId: 30, name: "Independent group", windowKey: "window:3" }]);
    await expect(repository.load()).resolves.toEqual(state);
    expect(move.mock.calls.map(([tabId]) => tabId)).toEqual([101, 201]);
    expect(removeGroup).toHaveBeenCalledExactlyOnceWith(100, expect.any(Function));
    expect(fake.windows.find((window) => window.id === 1)?.tabs.map((item) => item.id)).toEqual([101]);
    expect(fake.windows.find((window) => window.id === 2)?.tabs.map((item) => item.id)).toEqual([201]);
    expect(fake.groups.map((group) => group.id)).toEqual([30]);
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
      groups: [
        {
          id: "development",
          name: "Development",
          description: "Active implementation work",
          tags: ["development"],
          icon: "code" as const,
          color: "green",
          existingWorkspaceId: null,
          tabIds: ["101", "102"]
        },
        {
          id: "emptied-in-preview",
          name: "Unused suggestion",
          description: "",
          tags: [],
          icon: "folder" as const,
          color: "grey",
          existingWorkspaceId: null,
          tabIds: []
        }
      ],
      unclassifiedTabIds: []
    };

    await engine.handleUiAction({ action: "organization.apply", payload: { preview, targetWindowKey: "window:1" } });

    expect(engine.getState().workspaces[0]).toMatchObject({ name: "Development", icon: "code", color: "green" });
    expect(engine.getState().workspaces.some((workspace) => workspace.name === "Unused suggestion")).toBe(false);
    expect(fake.groupUpdates.at(-1)?.changes).toMatchObject({ title: "Development", color: "green" });
    await engine.stop();
  });

  it("deletes a source workspace emptied by an applied AI preview", async () => {
    const fake = new FakeBrowser([
      { id: 1, type: "normal", focused: true, tabs: [
        tab(101, 1, { groupId: 10, active: true }),
        tab(102, 1, { groupId: 20, index: 1 })
      ] }
    ], [
      { id: 10, windowId: 1, title: "Source", color: "red" },
      { id: 20, windowId: 1, title: "Target", color: "blue" }
    ]);
    const engine = new BrowserStateEngine({ api: fake.api, repository: new MemoryStateRepository(), debounceMs: 0 });
    await engine.start();
    const before = engine.getState();
    const source = before.workspaces.find((workspace) => workspace.groupId === 10)!;
    const target = before.workspaces.find((workspace) => workspace.groupId === 20)!;
    const selectedTabs = before.tabs.filter((item) => item.id === "101");
    const preview = {
      mode: "purpose" as const,
      sourceTabIds: ["101"],
      sourceFingerprint: fingerprintTabs(selectedTabs),
      groups: [{
        id: "target",
        name: target.name,
        description: target.description,
        tags: target.tags,
        existingWorkspaceId: target.id,
        tabIds: ["101"]
      }],
      unclassifiedTabIds: []
    };

    await engine.handleUiAction({ action: "organization.apply", payload: { preview, targetWindowKey: "window:1" } });

    expect(engine.getState().workspaces.map((workspace) => workspace.id)).toEqual([target.id]);
    expect(engine.getState().workspaces.some((workspace) => workspace.id === source.id)).toBe(false);
    expect(engine.getState().tabs.filter((item) => item.workspaceId === target.id).map((item) => item.id).sort()).toEqual(["101", "102"]);
    await engine.stop();
  });

  it("keeps an AI source workspace when an unselected tab remains", async () => {
    const fake = new FakeBrowser([
      { id: 1, type: "normal", focused: true, tabs: [
        tab(101, 1, { groupId: 10, active: true }),
        tab(103, 1, { groupId: 10, index: 1 }),
        tab(102, 1, { groupId: 20, index: 2 })
      ] }
    ], [
      { id: 10, windowId: 1, title: "Source", color: "red" },
      { id: 20, windowId: 1, title: "Target", color: "blue" }
    ]);
    const engine = new BrowserStateEngine({ api: fake.api, repository: new MemoryStateRepository(), debounceMs: 0 });
    await engine.start();
    const before = engine.getState();
    const source = before.workspaces.find((workspace) => workspace.groupId === 10)!;
    const target = before.workspaces.find((workspace) => workspace.groupId === 20)!;
    const selectedTabs = before.tabs.filter((item) => item.id === "101");

    await engine.handleUiAction({ action: "organization.apply", payload: { preview: {
      mode: "purpose" as const,
      sourceTabIds: ["101"],
      sourceFingerprint: fingerprintTabs(selectedTabs),
      groups: [{
        id: "target",
        name: target.name,
        description: target.description,
        tags: target.tags,
        existingWorkspaceId: target.id,
        tabIds: ["101"]
      }],
      unclassifiedTabIds: []
    }, targetWindowKey: "window:1" } });

    expect(engine.getState().workspaces.map((workspace) => workspace.id).sort()).toEqual([source.id, target.id].sort());
    expect(engine.getState().tabs.find((item) => item.id === "103")?.workspaceId).toBe(source.id);
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

  it("checks the requested origin against the loaded provider before sending tab data", async () => {
    const fake = new FakeBrowser([
      { id: 1, type: "normal", focused: true, tabs: [tab(101, 1)] }
    ], []);
    const providerOrigin = "https://provider.test:8443";
    vi.stubGlobal("chrome", {
      storage: { local: { get: async () => ({
        [AI_CONFIG_STORAGE_KEY]: { baseUrl: `${providerOrigin}/v1`, apiKey: "sk-test", model: "test-model" }
      }) } }
    });
    const fetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: {
      content: JSON.stringify({ groups: [], unclassifiedTabIds: ["101"] })
    } }] })));
    vi.stubGlobal("fetch", fetch);
    const engine = new BrowserStateEngine({ api: fake.api, repository: new MemoryStateRepository(), debounceMs: 0 });
    const request = (expectedOrigin: string) => engine.handleUiAction({
      action: "organization.preview", payload: { tabIds: ["101"], expectedOrigin }
    });

    try {
      await engine.start();
      await expect(request("https://provider.test")).rejects.toMatchObject({
        code: "configuration", message: translate(getAppLanguage(), "ai.invalidConfig")
      });
      expect(fetch).not.toHaveBeenCalled();

      await expect(request(providerOrigin)).resolves.toMatchObject({ sourceTabIds: ["101"] });
      expect(fetch).toHaveBeenCalledOnce();
      expect(fetch).toHaveBeenCalledWith(`${providerOrigin}/v1/chat/completions`, expect.any(Object));
    } finally {
      await engine.stop();
      vi.unstubAllGlobals();
    }
  });

  it("limits the backend preview to the shared budget after a provider retry delay", async () => {
    const fake = new FakeBrowser([
      { id: 1, type: "normal", focused: true, tabs: [tab(101, 1)] }
    ], []);
    vi.useFakeTimers();
    vi.stubGlobal("chrome", {
      storage: { local: { get: async () => ({
        [AI_CONFIG_STORAGE_KEY]: { baseUrl: "https://provider.test/v1", apiKey: "sk-test", model: "test-model" }
      }) } }
    });
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": "40" } }))
      .mockImplementationOnce(() => new Promise(() => undefined));
    vi.stubGlobal("fetch", fetch);
    const engine = new BrowserStateEngine({ api: fake.api, repository: new MemoryStateRepository(), debounceMs: 0 });

    try {
      await engine.start();
      const pending = engine.handleUiAction({ action: "organization.preview", payload: { tabIds: ["101"] } });
      const timedOut = expect(pending).rejects.toMatchObject({ code: "timeout" });
      await vi.advanceTimersByTimeAsync(39_999);
      expect(fetch).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(16_000);
      expect(fetch).toHaveBeenCalledTimes(2);
      const signal = fetch.mock.calls[1][1].signal;
      expect(signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      await timedOut;
      expect(signal.aborted).toBe(true);
    } finally {
      await engine.stop();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
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
