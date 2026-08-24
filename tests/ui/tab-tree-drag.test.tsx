// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TabTree } from "../../src/ui/TabTree";
import type { TabFridgeSnapshot } from "../../src/ui-state/model";
import { setAppLanguage } from "../../src/i18n";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class TestDataTransfer {
  effectAllowed = "none";
  dropEffect = "none";
  private readonly values = new Map<string, string>();

  getData(type: string): string {
    return this.values.get(type) ?? "";
  }

  setData(type: string, value: string): void {
    this.values.set(type, value);
  }
}

function dispatchDrag(target: Element, type: string, dataTransfer: TestDataTransfer): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  Object.defineProperty(event, "relatedTarget", { value: null });
  target.dispatchEvent(event);
}

const snapshot: TabFridgeSnapshot = {
  windows: [{ key: "window:1", nativeId: 1, name: "当前窗口", order: 0, isCurrent: true, expanded: true }],
  workspaces: [
    { id: "ws-a", windowKey: "window:1", name: "项目 A", description: "", tags: [], color: "blue", groupId: 1, order: 0, createdAt: 1, updatedAt: 1 },
    { id: "ws-b", windowKey: "window:1", name: "项目 B", description: "", tags: [], color: "green", groupId: 2, order: 1, createdAt: 1, updatedAt: 1 }
  ],
  tabs: [
    { id: "tab-a", windowKey: "window:1", workspaceId: "ws-a", kind: "normal", url: "https://example.com/a", title: "项目 A 标签", index: 0, pinned: false, groupId: 1 },
    { id: "tab-loose", windowKey: "window:1", workspaceId: null, kind: "normal", url: "https://example.com/loose", title: "未分类标签", index: 1, pinned: false },
    { id: "tab-special", windowKey: "window:1", workspaceId: null, kind: "special", url: "chrome://extensions/", title: "扩展程序", index: 2, pinned: false, specialReason: "浏览器页面" }
  ]
};

afterEach(async () => {
  document.body.innerHTML = "";
  vi.useRealTimers();
  await setAppLanguage("zh-CN");
});

describe("TabTree drag and drop", () => {
  it("keeps nested tab payloads intact and accepts workspace and unclassified drops", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onMoveTab = vi.fn();

    await act(async () => {
      root.render(
        <TabTree
          snapshot={snapshot}
          query=""
          filter="all"
          windowScope="all"
          workspaceTag=""
          expandedWindows={new Set(["window:1"])}
          expandedWorkspaces={new Set(["ws-a", "ws-b"])}
          selectedTabId={null}
          onToggleWindow={vi.fn()}
          onToggleWorkspace={vi.fn()}
          onActivateTab={vi.fn()}
          onMoveTab={onMoveTab}
          onMoveWorkspace={vi.fn()}
          onEditWorkspace={vi.fn()}
          onDeleteWorkspace={vi.fn()}
          onCreateWorkspace={vi.fn()}
        />
      );
    });

    const rows = [...host.querySelectorAll<HTMLButtonElement>("button.tab-row")];
    const source = rows.find((row) => row.textContent?.includes("项目 A 标签"));
    const special = rows.find((row) => row.textContent?.includes("扩展程序"));
    const workspaces = host.querySelectorAll<HTMLElement>(".workspace-section");
    expect(source).toBeDefined();
    expect(special?.draggable).toBe(false);
    expect(workspaces[0].getAttribute("draggable")).toBeNull();

    const toWorkspace = new TestDataTransfer();
    await act(async () => dispatchDrag(source!, "dragstart", toWorkspace));
    expect(JSON.parse(toWorkspace.getData("application/x-tab-fridge"))).toEqual({ type: "tab", id: "tab-a" });
    expect(workspaces[1].classList.contains("drop-zone-tab")).toBe(true);

    await act(async () => dispatchDrag(workspaces[1], "dragenter", toWorkspace));
    expect(workspaces[1].classList.contains("drag-active")).toBe(true);
    expect(workspaces[1].querySelector(".drop-guidance")?.textContent).toBe("松开移入");
    await act(async () => dispatchDrag(workspaces[1], "drop", toWorkspace));
    expect(onMoveTab).toHaveBeenNthCalledWith(1, "tab-a", "ws-b");

    const toUnclassified = new TestDataTransfer();
    await act(async () => dispatchDrag(source!, "dragstart", toUnclassified));
    const unclassified = host.querySelector<HTMLElement>(".unclassified-section");
    expect(unclassified).not.toBeNull();
    expect(unclassified?.classList.contains("drop-zone-tab")).toBe(true);
    await act(async () => dispatchDrag(unclassified!, "drop", toUnclassified));
    expect(onMoveTab).toHaveBeenNthCalledWith(2, "tab-a", null);

    await act(async () => root.unmount());
  });

  it("keeps a workspace visible when the query matches one of its tabs", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <TabTree
          snapshot={snapshot}
          query="example.com/a"
          filter="all"
          windowScope="all"
          workspaceTag=""
          expandedWindows={new Set(["window:1"])}
          expandedWorkspaces={new Set(["ws-a", "ws-b"])}
          selectedTabId={null}
          onToggleWindow={vi.fn()}
          onToggleWorkspace={vi.fn()}
          onActivateTab={vi.fn()}
          onMoveTab={vi.fn()}
          onMoveWorkspace={vi.fn()}
          onEditWorkspace={vi.fn()}
          onDeleteWorkspace={vi.fn()}
          onCreateWorkspace={vi.fn()}
        />
      );
    });

    expect(host.textContent).toContain("项目 A 标签");
    expect(host.textContent).not.toContain("项目 B");

    await act(async () => root.unmount());
  });

  it("reorders workspaces within one window and rejects cross-window workspace drops", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onMoveWorkspace = vi.fn();
    const twoWindowSnapshot: TabFridgeSnapshot = {
      windows: [
        ...snapshot.windows,
        { key: "window:2", nativeId: 2, name: "第二窗口", order: 1, isCurrent: false, expanded: true }
      ],
      workspaces: [
        ...snapshot.workspaces,
        { id: "ws-c", windowKey: "window:2", name: "项目 C", description: "", tags: [], color: "purple", groupId: 3, order: 0, createdAt: 1, updatedAt: 1 }
      ],
      tabs: snapshot.tabs
    };

    await act(async () => {
      root.render(
        <TabTree
          snapshot={twoWindowSnapshot}
          query=""
          filter="all"
          windowScope="all"
          workspaceTag=""
          expandedWindows={new Set(["window:1", "window:2"])}
          expandedWorkspaces={new Set(["ws-a", "ws-b", "ws-c"])}
          selectedTabId={null}
          onToggleWindow={vi.fn()}
          onToggleWorkspace={vi.fn()}
          onActivateTab={vi.fn()}
          onMoveTab={vi.fn()}
          onMoveWorkspace={onMoveWorkspace}
          onEditWorkspace={vi.fn()}
          onDeleteWorkspace={vi.fn()}
          onCreateWorkspace={vi.fn()}
        />
      );
    });

    const headings = host.querySelectorAll<HTMLButtonElement>(".workspace-heading");
    const sections = host.querySelectorAll<HTMLElement>(".workspace-section");
    const sameWindow = new TestDataTransfer();
    await act(async () => dispatchDrag(headings[0], "dragstart", sameWindow));
    expect(sections[1].classList.contains("drop-zone-workspace")).toBe(true);
    await act(async () => dispatchDrag(sections[1], "drop", sameWindow));
    expect(onMoveWorkspace).toHaveBeenCalledWith("ws-a", "ws-b");

    const crossWindow = new TestDataTransfer();
    await act(async () => dispatchDrag(headings[0], "dragstart", crossWindow));
    expect(sections[2].classList.contains("drop-zone-workspace")).toBe(false);
    await act(async () => dispatchDrag(sections[2], "drop", crossWindow));
    expect(onMoveWorkspace).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  it("keeps empty tab-type sections visible as stable structural drop targets", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const compactSnapshot: TabFridgeSnapshot = {
      ...snapshot,
      workspaces: [snapshot.workspaces[0]],
      tabs: [snapshot.tabs[0]]
    };

    await act(async () => {
      root.render(
        <TabTree
          snapshot={compactSnapshot}
          query=""
          filter="all"
          windowScope="all"
          workspaceTag=""
          expandedWindows={new Set(["window:1"])}
          expandedWorkspaces={new Set(["ws-a"])}
          selectedTabId={null}
          onToggleWindow={vi.fn()}
          onToggleWorkspace={vi.fn()}
          onActivateTab={vi.fn()}
          onMoveTab={vi.fn()}
          onMoveWorkspace={vi.fn()}
          onEditWorkspace={vi.fn()}
          onDeleteWorkspace={vi.fn()}
          onCreateWorkspace={vi.fn()}
        />
      );
    });

    expect(host.textContent).toContain("未分类");
    expect(host.textContent).toContain("特殊页面");
    expect(host.textContent).toContain("固定标签");
    expect(host.querySelector(".unclassified-section")).not.toBeNull();
    expect(host.querySelector(".section-heading-special")).not.toBeNull();
    expect(host.querySelector(".section-heading-fixed")).not.toBeNull();
    expect(host.querySelector(".workspace-level")).toBeNull();
    expect(host.querySelector(".workspace-menu")).not.toBeNull();

    const source = host.querySelector<HTMLButtonElement>("button.tab-row");
    const transfer = new TestDataTransfer();
    await act(async () => dispatchDrag(source!, "dragstart", transfer));
    expect(host.querySelector(".unclassified-section.drop-zone-tab")).not.toBeNull();
    await act(async () => root.unmount());
  });

  it("shows the most recent tab access time in the selected language", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T00:00:00.000Z"));
    await setAppLanguage("zh-CN");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const recentSnapshot: TabFridgeSnapshot = {
      ...snapshot,
      tabs: snapshot.tabs.map((item, index) => index === 0
        ? { ...item, lastActivatedAt: Date.now() - 5 * 60_000 }
        : item)
    };
    const props = {
      snapshot: recentSnapshot,
      query: "",
      filter: "all" as const,
      windowScope: "all" as const,
      workspaceTag: "",
      expandedWindows: new Set(["window:1"]),
      expandedWorkspaces: new Set(["ws-a", "ws-b"]),
      selectedTabId: null,
      onToggleWindow: vi.fn(),
      onToggleWorkspace: vi.fn(),
      onActivateTab: vi.fn(),
      onMoveTab: vi.fn(),
      onMoveWorkspace: vi.fn(),
      onEditWorkspace: vi.fn(),
      onDeleteWorkspace: vi.fn(),
      onCreateWorkspace: vi.fn()
    };

    await act(async () => root.render(<TabTree {...props} />));
    expect(host.textContent).toContain("5 分钟前");
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(host.textContent).toContain("6 分钟前");
    await act(async () => { await setAppLanguage("en"); });
    expect(host.textContent).toContain("6 minutes ago");
    expect(host.querySelector("button.tab-row")?.getAttribute("title")).toContain("Last visited: 6 minutes ago");
    await act(async () => root.unmount());
  });
});
