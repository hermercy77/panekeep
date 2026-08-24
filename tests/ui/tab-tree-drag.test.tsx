// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TabTree, dragAutoScrollVelocity } from "../../src/ui/TabTree";
import type { TabFridgeSnapshot } from "../../src/ui-state/model";
import { setAppLanguage } from "../../src/i18n";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class TestDataTransfer {
  effectAllowed = "none";
  dropEffect = "none";
  private readonly values = new Map<string, string>();
  dragImage?: Element;

  getData(type: string): string {
    return this.values.get(type) ?? "";
  }

  setData(type: string, value: string): void {
    this.values.set(type, value);
  }

  setDragImage(image: Element): void {
    this.dragImage = image;
  }
}

function dispatchDrag(target: Element, type: string, dataTransfer: TestDataTransfer, clientY = 0): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  Object.defineProperty(event, "relatedTarget", { value: null });
  Object.defineProperty(event, "clientY", { value: clientY });
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
  it("calculates continuous auto-scroll in both edge directions", () => {
    expect(dragAutoScrollVelocity(105, 100, 500)).toBeLessThan(0);
    expect(dragAutoScrollVelocity(495, 100, 500)).toBeGreaterThan(0);
    expect(dragAutoScrollVelocity(300, 100, 500)).toBe(0);
    expect(Math.abs(dragAutoScrollVelocity(0, 100, 500))).toBeLessThanOrEqual(18);
    expect(dragAutoScrollVelocity(105, 100, 160)).toBeLessThan(0);
    expect(dragAutoScrollVelocity(155, 100, 160)).toBeGreaterThan(0);
    expect(dragAutoScrollVelocity(130, 100, 160)).toBe(0);
  });

  it("changes selection only through checkboxes and supports Shift ranges", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onActivateTab = vi.fn();
    const onCheckedTabIdsChange = vi.fn();
    const props = {
      snapshot,
      query: "",
      filter: "all" as const,
      windowScope: "all" as const,
      workspaceTag: "",
      expandedWindows: new Set(["window:1"]),
      expandedWorkspaces: new Set(["ws-a", "ws-b"]),
      selectedTabId: null,
      onToggleWindow: vi.fn(),
      onToggleWorkspace: vi.fn(),
      onActivateTab,
      onCheckedTabIdsChange,
      onMoveTabs: vi.fn(),
      onMoveWorkspace: vi.fn(),
      onRequestWorkspaceMerge: vi.fn(),
      onEditWorkspace: vi.fn(),
      onDeleteWorkspace: vi.fn(),
      onCreateWorkspace: vi.fn()
    };

    await act(async () => root.render(<TabTree {...props} checkedTabIds={new Set()} />));
    const firstCheckbox = host.querySelector<HTMLInputElement>('[aria-label="选择项目 A 标签"]');
    expect(firstCheckbox).not.toBeNull();
    await act(async () => firstCheckbox?.click());
    expect(onActivateTab).not.toHaveBeenCalled();
    expect([...onCheckedTabIdsChange.mock.calls[0][0]]).toEqual(["tab-a"]);

    await act(async () => root.render(<TabTree {...props} checkedTabIds={new Set(["tab-a"])} />));
    const looseCheckbox = host.querySelector<HTMLInputElement>('[aria-label="选择未分类标签"]');
    const shiftClick = new MouseEvent("click", { bubbles: true, shiftKey: true });
    await act(async () => looseCheckbox?.dispatchEvent(shiftClick));
    expect([...onCheckedTabIdsChange.mock.calls.at(-1)[0]]).toEqual(["tab-a", "tab-loose"]);

    await act(async () => host.querySelector<HTMLButtonElement>(".tab-activate")?.click());
    expect(onActivateTab).toHaveBeenCalledWith("tab-a");
    expect(host.querySelector<HTMLInputElement>('[aria-label="特殊页面不可移动"]')?.disabled).toBe(true);
    await act(async () => root.unmount());
  });

  it("drags every checked tab with a compact count ghost", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onMoveTabs = vi.fn();
    const onMoveWorkspace = vi.fn();
    const onRequestWorkspaceMerge = vi.fn();
    await act(async () => root.render(
      <TabTree
        snapshot={snapshot}
        query=""
        filter="all"
        windowScope="all"
        workspaceTag=""
        expandedWindows={new Set(["window:1"])}
        expandedWorkspaces={new Set(["ws-a", "ws-b"])}
        selectedTabId={null}
        checkedTabIds={new Set(["tab-a", "tab-loose"])}
        onToggleWindow={vi.fn()}
        onToggleWorkspace={vi.fn()}
        onActivateTab={vi.fn()}
        onCheckedTabIdsChange={vi.fn()}
        onMoveTabs={onMoveTabs}
        onMoveWorkspace={onMoveWorkspace}
        onRequestWorkspaceMerge={onRequestWorkspaceMerge}
        onEditWorkspace={vi.fn()}
        onDeleteWorkspace={vi.fn()}
        onCreateWorkspace={vi.fn()}
      />
    ));

    const source = [...host.querySelectorAll<HTMLElement>(".tab-row")].find((row) => row.textContent?.includes("项目 A 标签"));
    const transfer = new TestDataTransfer();
    await act(async () => dispatchDrag(source!, "dragstart", transfer));
    expect(JSON.parse(transfer.getData("application/x-tab-fridge"))).toEqual({ type: "tabs", ids: ["tab-a", "tab-loose"], anchorId: "tab-a" });
    expect(transfer.dragImage?.querySelector(".tab-drag-ghost-count")?.textContent).toBe("2");
    expect(host.querySelectorAll(".tab-row.dragging-source")).toHaveLength(2);
    const cancel = host.querySelector<HTMLElement>(".drag-cancel-zone");
    expect(cancel?.textContent).toContain("拖到这里取消");
    await act(async () => dispatchDrag(cancel!, "dragenter", transfer));
    expect(cancel?.classList.contains("drag-active")).toBe(true);
    expect(cancel?.textContent).toContain("松开取消");
    await act(async () => dispatchDrag(cancel!, "drop", transfer));
    expect(host.querySelector(".drag-cancel-zone")).toBeNull();
    expect(onMoveTabs).not.toHaveBeenCalled();
    expect(onMoveWorkspace).not.toHaveBeenCalled();
    expect(onRequestWorkspaceMerge).not.toHaveBeenCalled();

    const workspaceTransfer = new TestDataTransfer();
    const workspaceHeading = host.querySelector<HTMLElement>(".workspace-heading");
    await act(async () => dispatchDrag(workspaceHeading!, "dragstart", workspaceTransfer));
    const workspaceCancel = host.querySelector<HTMLElement>(".drag-cancel-zone");
    await act(async () => dispatchDrag(workspaceCancel!, "drop", workspaceTransfer));
    expect(host.querySelector(".drag-cancel-zone")).toBeNull();
    expect(onMoveWorkspace).not.toHaveBeenCalled();
    expect(onRequestWorkspaceMerge).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("keeps nested tab payloads intact and accepts workspace and unclassified drops", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onMoveTabs = vi.fn();

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
          checkedTabIds={new Set()}
          onToggleWindow={vi.fn()}
          onToggleWorkspace={vi.fn()}
          onActivateTab={vi.fn()}
          onCheckedTabIdsChange={vi.fn()}
          onMoveTabs={onMoveTabs}
          onMoveWorkspace={vi.fn()}
          onRequestWorkspaceMerge={vi.fn()}
          onEditWorkspace={vi.fn()}
          onDeleteWorkspace={vi.fn()}
          onCreateWorkspace={vi.fn()}
        />
      );
    });

    const rows = [...host.querySelectorAll<HTMLElement>(".tab-row")];
    const source = rows.find((row) => row.textContent?.includes("项目 A 标签"));
    const special = rows.find((row) => row.textContent?.includes("扩展程序"));
    const workspaces = host.querySelectorAll<HTMLElement>(".workspace-section");
    expect(source).toBeDefined();
    expect(special?.draggable).toBe(false);
    expect(workspaces[0].getAttribute("draggable")).toBeNull();

    const toWorkspace = new TestDataTransfer();
    const sourceHandle = source?.querySelector<HTMLButtonElement>(".tab-activate");
    expect(sourceHandle?.draggable).toBe(true);
    await act(async () => dispatchDrag(sourceHandle!, "dragstart", toWorkspace));
    expect(JSON.parse(toWorkspace.getData("application/x-tab-fridge"))).toEqual({ type: "tabs", ids: ["tab-a"], anchorId: "tab-a" });
    expect(workspaces[1].classList.contains("drop-zone-tab")).toBe(true);

    await act(async () => dispatchDrag(workspaces[1], "dragenter", toWorkspace));
    expect(workspaces[1].classList.contains("drag-active")).toBe(true);
    expect(workspaces[1].querySelector(".drop-guidance")?.textContent).toBe("松开移入");
    await act(async () => dispatchDrag(workspaces[1], "drop", toWorkspace));
    expect(onMoveTabs).toHaveBeenNthCalledWith(1, ["tab-a"], "ws-b");

    const toUnclassified = new TestDataTransfer();
    await act(async () => dispatchDrag(source!, "dragstart", toUnclassified));
    const unclassified = host.querySelector<HTMLElement>(".unclassified-section");
    expect(unclassified).not.toBeNull();
    expect(unclassified?.classList.contains("drop-zone-tab")).toBe(true);
    await act(async () => dispatchDrag(unclassified!, "drop", toUnclassified));
    expect(onMoveTabs).toHaveBeenNthCalledWith(2, ["tab-a"], null, "window:1");

    await act(async () => root.unmount());
  });

  it("moves an unclassified tab into another window's unclassified section", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onMoveTabs = vi.fn();
    const crossWindowSnapshot: TabFridgeSnapshot = {
      ...snapshot,
      windows: [
        snapshot.windows[0],
        { key: "window:2", nativeId: 2, name: "第二窗口", order: 1, isCurrent: false, expanded: true }
      ]
    };

    await act(async () => root.render(
      <TabTree
        snapshot={crossWindowSnapshot}
        query=""
        filter="all"
        windowScope="all"
        workspaceTag=""
        expandedWindows={new Set(["window:1", "window:2"])}
        expandedWorkspaces={new Set(["ws-a", "ws-b"])}
        selectedTabId={null}
        checkedTabIds={new Set()}
        onToggleWindow={vi.fn()}
        onToggleWorkspace={vi.fn()}
        onActivateTab={vi.fn()}
        onCheckedTabIdsChange={vi.fn()}
        onMoveTabs={onMoveTabs}
        onMoveWorkspace={vi.fn()}
        onRequestWorkspaceMerge={vi.fn()}
        onEditWorkspace={vi.fn()}
        onDeleteWorkspace={vi.fn()}
        onCreateWorkspace={vi.fn()}
      />
    ));

    const source = [...host.querySelectorAll<HTMLElement>(".tab-row")]
      .find((row) => row.textContent?.includes("未分类标签"));
    const target = host.querySelectorAll<HTMLElement>(".unclassified-section")[1];
    const transfer = new TestDataTransfer();
    await act(async () => dispatchDrag(source!, "dragstart", transfer));
    expect(target.classList.contains("drop-zone-tab")).toBe(true);
    await act(async () => dispatchDrag(target, "drop", transfer));
    expect(onMoveTabs).toHaveBeenCalledWith(["tab-loose"], null, "window:2");

    await act(async () => root.unmount());
  });

  it("auto-scrolls the tree panel while a drag stays near its bottom edge", async () => {
    const host = document.createElement("div");
    host.className = "tree-panel";
    document.body.append(host);
    Object.defineProperty(host, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ top: 100, bottom: 500, left: 0, right: 320, width: 320, height: 400, x: 0, y: 100, toJSON: () => ({}) })
    });
    host.scrollTop = 100;
    const frames: FrameRequestCallback[] = [];
    const requestDescriptor = Object.getOwnPropertyDescriptor(window, "requestAnimationFrame");
    const cancelDescriptor = Object.getOwnPropertyDescriptor(window, "cancelAnimationFrame");
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      value: vi.fn((callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      })
    });
    Object.defineProperty(window, "cancelAnimationFrame", { configurable: true, value: vi.fn() });
    const root = createRoot(host);

    await act(async () => root.render(
      <TabTree
        snapshot={snapshot}
        query=""
        filter="all"
        windowScope="all"
        workspaceTag=""
        expandedWindows={new Set(["window:1"])}
        expandedWorkspaces={new Set(["ws-a", "ws-b"])}
        selectedTabId={null}
        checkedTabIds={new Set()}
        onToggleWindow={vi.fn()}
        onToggleWorkspace={vi.fn()}
        onActivateTab={vi.fn()}
        onCheckedTabIdsChange={vi.fn()}
        onMoveTabs={vi.fn()}
        onMoveWorkspace={vi.fn()}
        onRequestWorkspaceMerge={vi.fn()}
        onEditWorkspace={vi.fn()}
        onDeleteWorkspace={vi.fn()}
        onCreateWorkspace={vi.fn()}
      />
    ));
    const source = host.querySelector<HTMLElement>(".tab-activate");
    const transfer = new TestDataTransfer();
    await act(async () => dispatchDrag(source!, "dragstart", transfer));
    const edgeEvent = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperty(edgeEvent, "clientY", { value: 495 });
    await act(async () => window.dispatchEvent(edgeEvent));
    expect(frames).toHaveLength(1);
    frames.shift()?.(0);
    expect(host.scrollTop).toBeGreaterThan(100);
    await act(async () => dispatchDrag(source!, "dragend", transfer));
    await act(async () => root.unmount());
    if (requestDescriptor) Object.defineProperty(window, "requestAnimationFrame", requestDescriptor);
    else delete (window as Partial<Window>).requestAnimationFrame;
    if (cancelDescriptor) Object.defineProperty(window, "cancelAnimationFrame", cancelDescriptor);
    else delete (window as Partial<Window>).cancelAnimationFrame;
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
          checkedTabIds={new Set()}
          onToggleWindow={vi.fn()}
          onToggleWorkspace={vi.fn()}
          onActivateTab={vi.fn()}
          onCheckedTabIdsChange={vi.fn()}
          onMoveTabs={vi.fn()}
          onMoveWorkspace={vi.fn()}
          onRequestWorkspaceMerge={vi.fn()}
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
    const onRequestWorkspaceMerge = vi.fn();
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
          checkedTabIds={new Set()}
          onToggleWindow={vi.fn()}
          onToggleWorkspace={vi.fn()}
          onActivateTab={vi.fn()}
          onCheckedTabIdsChange={vi.fn()}
          onMoveTabs={vi.fn()}
          onMoveWorkspace={onMoveWorkspace}
          onRequestWorkspaceMerge={onRequestWorkspaceMerge}
          onEditWorkspace={vi.fn()}
          onDeleteWorkspace={vi.fn()}
          onCreateWorkspace={vi.fn()}
        />
      );
    });

    const headings = host.querySelectorAll<HTMLButtonElement>(".workspace-heading");
    const sections = host.querySelectorAll<HTMLElement>(".workspace-section");
    sections[1].getBoundingClientRect = () => ({ top: 0, height: 100, bottom: 100, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON: () => ({}) });
    sections[2].getBoundingClientRect = () => ({ top: 0, height: 100, bottom: 100, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON: () => ({}) });
    const sameWindow = new TestDataTransfer();
    await act(async () => dispatchDrag(headings[0], "dragstart", sameWindow));
    expect(sections[1].classList.contains("drop-zone-workspace")).toBe(true);
    await act(async () => dispatchDrag(sections[1], "dragover", sameWindow, 10));
    expect(sections[1].classList.contains("workspace-drop-before")).toBe(true);
    await act(async () => dispatchDrag(sections[1], "drop", sameWindow, 10));
    expect(onMoveWorkspace).toHaveBeenCalledWith("ws-a", "ws-b");

    const afterTarget = new TestDataTransfer();
    await act(async () => dispatchDrag(headings[0], "dragstart", afterTarget));
    await act(async () => dispatchDrag(sections[1], "dragover", afterTarget, 90));
    expect(sections[1].classList.contains("workspace-drop-after")).toBe(true);
    await act(async () => dispatchDrag(sections[1], "drop", afterTarget, 90));
    expect(onMoveWorkspace).toHaveBeenNthCalledWith(2, "ws-a", undefined);

    const crossWindow = new TestDataTransfer();
    await act(async () => dispatchDrag(headings[0], "dragstart", crossWindow));
    expect(sections[2].classList.contains("drop-zone-workspace")).toBe(true);
    await act(async () => dispatchDrag(sections[2], "dragover", crossWindow, 5));
    expect(sections[2].classList.contains("workspace-drop-merge")).toBe(true);
    await act(async () => dispatchDrag(sections[2], "drop", crossWindow, 5));
    expect(onMoveWorkspace).toHaveBeenCalledTimes(2);
    expect(onRequestWorkspaceMerge).toHaveBeenCalledWith("ws-a", "ws-c");
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
          checkedTabIds={new Set()}
          onToggleWindow={vi.fn()}
          onToggleWorkspace={vi.fn()}
          onActivateTab={vi.fn()}
          onCheckedTabIdsChange={vi.fn()}
          onMoveTabs={vi.fn()}
          onMoveWorkspace={vi.fn()}
          onRequestWorkspaceMerge={vi.fn()}
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

    const source = host.querySelector<HTMLElement>(".tab-row");
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
      checkedTabIds: new Set<string>(),
      onToggleWindow: vi.fn(),
      onToggleWorkspace: vi.fn(),
      onActivateTab: vi.fn(),
      onCheckedTabIdsChange: vi.fn(),
      onMoveTabs: vi.fn(),
      onMoveWorkspace: vi.fn(),
      onRequestWorkspaceMerge: vi.fn(),
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
    expect(host.querySelector(".tab-activate")?.getAttribute("title")).toContain("Last visited: 6 minutes ago");
    await act(async () => root.unmount());
  });
});
