import { describe, expect, it, vi } from "vitest";
import { BrowserStateEngine } from "../../src/browser/stateEngine";
import { MemoryStateRepository } from "../../src/storage/repository";
import type { TabRecord, WindowState, Workspace } from "../../src/shared/contracts";
import { DebouncedSaver } from "../../src/storage/debouncedSaver";
import { fingerprintTabs } from "../../src/ai/snapshot";
import { getAppLanguage, translate } from "../../src/i18n";

const windows: WindowState[] = [
  { key: "window:1", nativeId: 1, name: "窗口 1", order: 0, isCurrent: true, expanded: true }
];
const workspaces: Workspace[] = [
  { id: "workspace:one", windowKey: "window:1", name: "项目一", description: "", tags: [], color: "blue", groupId: 10, order: 0, createdAt: 1, updatedAt: 1 },
  { id: "workspace:two", windowKey: "window:1", name: "项目二", description: "", tags: [], color: "green", groupId: 11, order: 1, createdAt: 1, updatedAt: 1 }
];
const tabs: TabRecord[] = [
  { id: "1", windowKey: "window:1", workspaceId: "workspace:one", kind: "normal", url: "https://one.test", title: "One", index: 0, pinned: false, groupId: 10 },
  { id: "2", windowKey: "window:1", workspaceId: null, kind: "normal", url: "https://two.test", title: "Two", index: 1, pinned: false }
];

describe("BrowserStateEngine without a browser connection", () => {
  it("updates live workspace membership for manual moves", async () => {
    const engine = new BrowserStateEngine({ repository: new MemoryStateRepository({ windows, workspaces, tabs }) });
    await engine.start();
    await engine.moveTabs({ tabIds: ["1"], workspaceId: "workspace:two" });
    expect(engine.getState().tabs.find((tab) => tab.id === "1")?.workspaceId).toBe("workspace:two");
  });

  it("moves a tab to the unclassified area without a browser API", async () => {
    const engine = new BrowserStateEngine({ repository: new MemoryStateRepository({ windows, workspaces, tabs }) });
    await engine.start();
    await engine.moveTabs({ tabIds: ["1"], workspaceId: null });
    expect(engine.getState().tabs.find((tab) => tab.id === "1")?.workspaceId).toBeNull();
  });

  it.each(["tab.move", "tabs.move"])("distinguishes a missing target from explicit unclassification for %s", async (action) => {
    const engine = new BrowserStateEngine({ repository: new MemoryStateRepository({ windows, workspaces, tabs }) });
    await engine.start();
    const selected = { tabId: "1", tabIds: ["1"] };
    await expect(engine.handleUiAction({ action, payload: selected }))
      .rejects.toThrow(translate(getAppLanguage(), "error.workspaceTargetRequired"));
    expect(engine.getState().tabs[0].workspaceId).toBe("workspace:one");
    await expect(engine.handleUiAction({ action, payload: { ...selected, windowKey: "window:1" } }))
      .resolves.toMatchObject({ result: { movedTabIds: ["1"] } });
    await engine.moveTabs({ tabIds: ["1"], workspaceId: "workspace:one" });
    await expect(engine.handleUiAction({ action, payload: { ...selected, workspaceId: null } }))
      .resolves.toMatchObject({ result: { movedTabIds: ["1"] } });
    expect(engine.getState().tabs[0].workspaceId).toBeNull();
    await engine.stop();
  });

  it("persists each explicit workspace mutation before returning", async () => {
    const repository = new MemoryStateRepository({ windows, workspaces, tabs });
    const engine = new BrowserStateEngine({ repository, debounceMs: 60_000 });
    await engine.start();
    const expectStored = () => expect(repository.load()).resolves.toEqual(engine.getState());

    const created = await engine.createWorkspace({ name: "New workspace" });
    await expectStored();
    await engine.updateWorkspace(created.id, { description: "Saved description" });
    await expectStored();
    await engine.moveWorkspace(created.id, "workspace:one");
    await expectStored();
    await engine.moveTabs({ tabIds: ["2"], workspaceId: created.id });
    await expectStored();
    await engine.mergeWorkspaces(engine.createWorkspaceMergePreview("workspace:one", created.id));
    await expectStored();
    await engine.deleteWorkspace(created.id);
    await expectStored();

    const sourceTabs = engine.getState().tabs;
    await engine.handleUiAction({ action: "organization.apply", payload: { preview: {
      mode: "purpose", sourceTabIds: ["1", "2"], sourceFingerprint: fingerprintTabs(sourceTabs),
      groups: [{
        id: "organized", name: "Organized", description: "", tags: [], tabIds: ["1", "2"], existingWorkspaceId: null
      }],
      unclassifiedTabIds: []
    } } });
    await expectStored();
    await engine.stop();
  });

  it("reports a failed write to the UI action and keeps the edit available for the next flush", async () => {
    const repository = new MemoryStateRepository({ windows, workspaces, tabs });
    const engine = new BrowserStateEngine({ repository });
    await engine.start();
    const failure = new Error("Database write failed");
    const replace = vi.spyOn(repository, "replace").mockRejectedValueOnce(failure);

    await expect(engine.handleUiAction({ action: "workspace.update", payload: {
      id: "workspace:one", draft: { description: "Saved on retry" }
    } })).rejects.toBe(failure);
    expect((await repository.load()).workspaces[0].description).toBe("");
    await engine.flush();
    expect(replace).toHaveBeenCalledTimes(2);
    expect((await repository.load()).workspaces[0].description).toBe("Saved on retry");
    await engine.stop();
  });
});

describe("DebouncedSaver", () => {
  it("serializes pending writes and makes concurrent flushes wait for the latest save", async () => {
    const saved: number[] = [];
    let value = 1;
    let finishFirst: (() => void) | undefined;
    let finishSecond: (() => void) | undefined;
    const save = vi.fn(async () => {
      const current = value;
      await new Promise<void>((resolve) => {
        if (current === 1) finishFirst = resolve;
        else finishSecond = resolve;
      });
      saved.push(current);
    });
    const saver = new DebouncedSaver(save);
    saver.schedule();
    const first = saver.flush();
    await Promise.resolve();
    value = 2;
    saver.schedule();
    const done = vi.fn();
    const second = saver.flush().then(done);
    expect(save).toHaveBeenCalledOnce();
    finishFirst?.();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(saved).toEqual([1]);
    expect(done).not.toHaveBeenCalled();
    finishSecond?.();
    await Promise.all([first, second]);
    expect(saved).toEqual([1, 2]);
  });

  it("retains failed timer writes for the next explicit flush", async () => {
    vi.useFakeTimers();
    try {
      const failure = new Error("Write failed");
      const save = vi.fn<() => Promise<void>>().mockRejectedValueOnce(failure).mockRejectedValueOnce(failure)
        .mockResolvedValue(undefined);
      const saver = new DebouncedSaver(save, 10);
      saver.schedule();
      await vi.advanceTimersByTimeAsync(10);
      expect(save).toHaveBeenCalledOnce();
      await expect(saver.flush()).rejects.toBe(failure);
      await expect(saver.flush()).resolves.toBeUndefined();
      expect(save).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
