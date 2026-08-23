// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TabTree } from "../../src/ui/TabTree";
import type { TabFridgeSnapshot } from "../../src/ui-state/model";

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

afterEach(() => {
  document.body.innerHTML = "";
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
});
