// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidePanelApp } from "../../src/ui/SidePanelApp";
import { setAppLanguage } from "../../src/i18n";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const multiSnapshot = {
  windows: [
    { key: "window:1", nativeId: 1, name: "Window 1", order: 0, isCurrent: true, expanded: true },
    { key: "window:2", nativeId: 2, name: "Window 2", order: 1, isCurrent: false, expanded: true }
  ],
  workspaces: [
    { id: "ws-1", windowKey: "window:1", name: "Docs", description: "", tags: ["work"], color: "blue", icon: "book", groupId: 1, order: 0, createdAt: 1, updatedAt: 1 }
  ],
  tabs: [
    { id: "tab-1", windowKey: "window:1", workspaceId: "ws-1", kind: "normal", url: "https://react.dev/", title: "React Docs", index: 0, pinned: false, active: true, groupId: 1 },
    { id: "tab-2", windowKey: "window:1", workspaceId: null, kind: "normal", url: "https://news.example/", title: "Daily News", index: 1, pinned: false, active: false },
    { id: "tab-3", windowKey: "window:2", workspaceId: null, kind: "normal", url: "https://other.example/", title: "Other Window", index: 0, pinned: false, active: false }
  ]
};

afterEach(async () => {
  document.body.innerHTML = "";
  window.localStorage.clear();
  delete (globalThis as typeof globalThis & { chrome?: unknown }).chrome;
  await setAppLanguage("zh-CN");
});

describe("SidePanelApp usability upgrades", () => {
  it("highlights the browser active tab, hides empty sections while searching, and opens manage in a tab", async () => {
    const tabsCreate = vi.fn(async () => ({ id: 99 }));
    const sendMessage = vi.fn(async (message: { action?: string; payload?: unknown }) => {
      if (message.action === "tabs.move") {
        return { ok: true, result: { ...multiSnapshot, movedTabIds: ["tab-2"], skippedTabIds: [] }, snapshot: multiSnapshot };
      }
      return { ok: true, result: multiSnapshot, snapshot: multiSnapshot };
    });

    (globalThis as typeof globalThis & { chrome?: unknown }).chrome = {
      runtime: {
        getURL: (path: string) => `chrome-extension://test/${path}`,
        sendMessage,
        onMessage: { addListener: () => undefined, removeListener: () => undefined }
      },
      tabs: {
        query: async () => [],
        create: tabsCreate
      },
      storage: {
        local: { get: async () => ({}), set: async () => undefined },
        onChanged: { addListener: () => undefined }
      }
    };

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SidePanelApp />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Expand all to reveal workspace tabs
    const expandAll = host.querySelector<HTMLButtonElement>('[aria-label="全部展开"]')!;
    await act(async () => expandAll.click());

    // Browser active tab is highlighted automatically
    expect(host.querySelector('[data-tab-id="tab-1"]')?.classList.contains("selected")).toBe(true);

    // Search hides zero-count empty special/fixed sections
    const searchInput = host.querySelector<HTMLInputElement>(".search-box input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(searchInput, "Daily");
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelector(".section-heading-special")).toBeNull();
    expect(host.querySelector(".section-heading-fixed")).toBeNull();

    // Clear search and verify batch move select works without drag-and-drop
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".search-clear")?.click();
    });
    const checkbox = host.querySelector<HTMLInputElement>('[aria-label="选择Daily News"]')!;
    await act(async () => checkbox.click());
    const batchSelect = host.querySelector<HTMLSelectElement>(".batch-move-select")!;
    await act(async () => {
      batchSelect.value = "ws-1";
      batchSelect.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      action: "tabs.move",
      payload: expect.objectContaining({ tabIds: ["tab-2"], workspaceId: "ws-1" })
    }));

    // Manage link opens in a dedicated browser tab
    const manageLink = host.querySelector<HTMLAnchorElement>('[aria-label="打开管理页"]')!;
    await act(async () => {
      manageLink.click();
      await Promise.resolve();
    });
    expect(tabsCreate).toHaveBeenCalledWith({ url: "chrome-extension://test/manage.html" });

    // Controlled workspace menu closes on outside click
    const menuTrigger = host.querySelector<HTMLButtonElement>(".workspace-menu-trigger")!;
    await act(async () => menuTrigger.click());
    expect(host.querySelector(".workspace-menu-list")).not.toBeNull();
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(host.querySelector(".workspace-menu-list")).toBeNull();

    // Quick row actions: pin and close send tab.pin / tab.close
    const pinButton = host.querySelector<HTMLButtonElement>('[data-tab-id="tab-2"] [aria-label="固定标签"]')!;
    await act(async () => {
      pinButton.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      action: "tab.pin",
      payload: { tabId: "tab-2", pinned: true }
    }));

    const closeButton = host.querySelector<HTMLButtonElement>('[data-tab-id="tab-2"] [aria-label="关闭标签"]')!;
    await act(async () => {
      closeButton.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      action: "tab.close",
      payload: { tabIds: ["tab-2"] }
    }));

    // Deduplicate button reports when no duplicate URLs exist
    const dedupButton = host.querySelector<HTMLButtonElement>('[aria-label="清理重复标签"]')!;
    await act(async () => {
      dedupButton.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.textContent).toContain("没有发现重复标签");

    await act(async () => root.unmount());
  });
});
