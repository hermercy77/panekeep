import { describe, expect, it } from "vitest";
import { BrowserStateEngine } from "../../src/browser/stateEngine";
import { MemoryStateRepository } from "../../src/storage/repository";
import type { TabRecord, WindowState, Workspace } from "../../src/shared/contracts";

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
});
