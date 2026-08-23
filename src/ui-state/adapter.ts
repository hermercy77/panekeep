import type {
  OrganizationMode,
  OrganizationPreview,
  TabRecord,
  Workspace
} from "../shared/contracts";
import { UI_MESSAGE_SOURCE, isStateUpdatedMessage } from "../shared/messages";
import {
  cloneSnapshot,
  emptySnapshot,
  makeId,
  normalizeSnapshot,
  type TabFridgeAdapter,
  type TabFridgeSnapshot,
  type WorkspaceDraft
} from "./model";

const DEFAULT_WORKSPACE_COLOR = "slate";

function now(): number {
  return Date.now();
}

function getRuntime(): {
  sendMessage?: (message: unknown) => Promise<unknown>;
  onMessage?: {
    addListener?: (listener: (message: unknown) => unknown) => void;
    removeListener?: (listener: (message: unknown) => unknown) => void;
  };
} | null {
  const scope = globalThis as { chrome?: { runtime?: unknown }; browser?: { runtime?: unknown } };
  const browser = scope.chrome ?? scope.browser;
  const runtime = browser?.runtime as {
    sendMessage?: (message: unknown) => Promise<unknown>;
    onMessage?: {
      addListener?: (listener: (message: unknown) => unknown) => void;
      removeListener?: (listener: (message: unknown) => unknown) => void;
    };
  } | undefined;
  return runtime ?? null;
}

interface BrowserEventLike {
  addListener?: (listener: (...args: unknown[]) => void) => void;
  removeListener?: (listener: (...args: unknown[]) => void) => void;
}

function getBrowserStateEvents(): BrowserEventLike[] {
  const scope = globalThis as typeof globalThis & {
    chrome?: { tabs?: Record<string, BrowserEventLike>; windows?: Record<string, BrowserEventLike>; tabGroups?: Record<string, BrowserEventLike> };
    browser?: { tabs?: Record<string, BrowserEventLike>; windows?: Record<string, BrowserEventLike>; tabGroups?: Record<string, BrowserEventLike> };
  };
  const browser = scope.chrome ?? scope.browser;
  if (!browser) return [];
  const events: Array<BrowserEventLike | undefined> = [
    browser.tabs?.onCreated as BrowserEventLike | undefined,
    browser.tabs?.onRemoved as BrowserEventLike | undefined,
    browser.tabs?.onUpdated as BrowserEventLike | undefined,
    browser.tabs?.onMoved as BrowserEventLike | undefined,
    browser.tabs?.onActivated as BrowserEventLike | undefined,
    browser.tabs?.onAttached as BrowserEventLike | undefined,
    browser.tabs?.onDetached as BrowserEventLike | undefined,
    browser.tabs?.onReplaced as BrowserEventLike | undefined,
    browser.windows?.onCreated as BrowserEventLike | undefined,
    browser.windows?.onRemoved as BrowserEventLike | undefined,
    browser.windows?.onFocusChanged as BrowserEventLike | undefined,
    browser.tabGroups?.onCreated as BrowserEventLike | undefined,
    browser.tabGroups?.onRemoved as BrowserEventLike | undefined,
    browser.tabGroups?.onUpdated as BrowserEventLike | undefined,
    browser.tabGroups?.onMoved as BrowserEventLike | undefined
  ];
  return events.filter((event): event is BrowserEventLike => Boolean(event?.addListener));
}

function isNoReceiverError(error: unknown): boolean {
  return /receiving end does not exist|could not establish connection|message port closed/i.test(String(error));
}

function createInMemoryAdapter(initial: TabFridgeSnapshot = emptySnapshot): TabFridgeAdapter {
  let snapshot = cloneSnapshot(initial);
  const listeners = new Set<(next: TabFridgeSnapshot) => void>();

  const publish = () => {
    const next = cloneSnapshot(snapshot);
    for (const listener of listeners) listener(next);
  };

  const adapter: TabFridgeAdapter & { replaceSnapshot: (next: TabFridgeSnapshot) => void } = {
    async getSnapshot() {
      return cloneSnapshot(snapshot);
    },
    async createWorkspace(draft) {
      const timestamp = now();
      const workspace: Workspace = {
        id: makeId("workspace"),
        windowKey: draft.windowKey,
        name: draft.name.trim(),
        description: draft.description.trim(),
        tags: draft.tags,
        color: draft.color || DEFAULT_WORKSPACE_COLOR,
        groupId: draft.groupId,
        order: snapshot.workspaces.filter((item) => item.windowKey === draft.windowKey).length,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      snapshot = { ...snapshot, workspaces: [...snapshot.workspaces, workspace] };
      publish();
      return { ...workspace, tags: [...workspace.tags] };
    },
    async updateWorkspace(id, draft) {
      const current = snapshot.workspaces.find((workspace) => workspace.id === id);
      if (!current) throw new Error("找不到要编辑的工作区");
      const workspace: Workspace = {
        ...current,
        ...draft,
        name: draft.name?.trim() || current.name,
        description: draft.description === undefined ? current.description : draft.description.trim(),
        tags: draft.tags === undefined ? current.tags : draft.tags,
        color: draft.color || current.color,
        updatedAt: now()
      };
      snapshot = {
        ...snapshot,
        workspaces: snapshot.workspaces.map((item) => (item.id === id ? workspace : item))
      };
      publish();
      return { ...workspace, tags: [...workspace.tags] };
    },
    async deleteWorkspace(id) {
      snapshot = {
        ...snapshot,
        workspaces: snapshot.workspaces.filter((workspace) => workspace.id !== id),
        tabs: snapshot.tabs.map((tab) => (tab.workspaceId === id ? { ...tab, workspaceId: null } : tab))
      };
      publish();
    },
    async moveTab(tabId, workspaceId) {
      if (workspaceId && !snapshot.workspaces.some((workspace) => workspace.id === workspaceId)) {
        throw new Error("目标工作区不存在");
      }
      snapshot = {
        ...snapshot,
        tabs: snapshot.tabs.map((tab) => (tab.id === tabId ? { ...tab, workspaceId } : tab))
      };
      publish();
    },
    async moveWorkspace(workspaceId, beforeWorkspaceId) {
      const source = snapshot.workspaces.find((workspace) => workspace.id === workspaceId);
      if (!source) return;
      const siblings = snapshot.workspaces.filter((workspace) => workspace.windowKey === source.windowKey && workspace.id !== workspaceId);
      const beforeIndex = beforeWorkspaceId ? siblings.findIndex((workspace) => workspace.id === beforeWorkspaceId) : siblings.length;
      const insertAt = beforeIndex < 0 ? siblings.length : beforeIndex;
      siblings.splice(insertAt, 0, source);
      const orderById = new Map(siblings.map((workspace, index) => [workspace.id, index]));
      snapshot = {
        ...snapshot,
        workspaces: snapshot.workspaces.map((workspace) =>
          workspace.windowKey === source.windowKey && orderById.has(workspace.id)
            ? { ...workspace, order: orderById.get(workspace.id) ?? workspace.order, updatedAt: now() }
            : workspace
        )
      };
      publish();
    },
    async activateTab(tabId) {
      const tab = snapshot.tabs.find((item) => item.id === tabId);
      if (!tab) throw new Error("找不到标签");
      // The browser adapter turns this into a tabs.update call. The in-memory
      // adapter keeps activation local so the UI remains usable in a preview.
    },
    async requestOrganization() {
      throw new Error("请先配置 AI API，再开始整理");
    },
    async applyOrganization(preview) {
      const workspaceByGroup = new Map<string, string>();
      for (const group of preview.groups) {
        let workspaceId = group.existingWorkspaceId;
        if (!workspaceId || !snapshot.workspaces.some((workspace) => workspace.id === workspaceId)) {
          const firstTab = snapshot.tabs.find((tab) => group.tabIds.includes(tab.id));
          const created = await this.createWorkspace({
            windowKey: firstTab?.windowKey ?? snapshot.windows[0]?.key ?? "window:unknown",
            name: group.name,
            description: group.description,
            tags: group.tags,
            color: DEFAULT_WORKSPACE_COLOR
          });
          workspaceId = created.id;
        }
        workspaceByGroup.set(group.id, workspaceId);
      }
      const groupByTabId = new Map<string, string>();
      for (const group of preview.groups) {
        for (const tabId of group.tabIds) groupByTabId.set(tabId, group.id);
      }
      snapshot = {
        ...snapshot,
        tabs: snapshot.tabs.map((tab) => {
          const groupId = groupByTabId.get(tab.id);
          if (!groupId) return preview.unclassifiedTabIds.includes(tab.id) ? { ...tab, workspaceId: null } : tab;
          return { ...tab, workspaceId: workspaceByGroup.get(groupId) ?? tab.workspaceId };
        })
      };
      publish();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    replaceSnapshot(next) {
      snapshot = cloneSnapshot(next);
      publish();
    }
  };
  return adapter;
}

/**
 * UI/background adapter.
 *
 * ADAPTER: action names and payloads are deliberately isolated here. Once the
 * background/database layer exposes its final message envelope, only this
 * file needs to change; the sidepanel and manage page remain contract-only.
 */
export function createBrowserAdapter(initial?: TabFridgeSnapshot): TabFridgeAdapter {
  const fallback = createInMemoryAdapter(initial);
  const bridge = async (action: string, payload?: unknown): Promise<unknown> => {
    const runtime = getRuntime();
    if (!runtime?.sendMessage) return undefined;
    try {
      const response = (await runtime.sendMessage({ source: UI_MESSAGE_SOURCE, action, payload })) as Record<string, unknown> | undefined;
      if (!response) return undefined;
      if (response.ok === false) throw new Error(typeof response.error === "string" ? response.error : "操作失败");
      const remoteSnapshot = normalizeSnapshot(response.snapshot ?? response);
      if (remoteSnapshot) {
        // Keep the fallback in sync for operations unsupported by an older
        // background build and for browser reloads while this page is open.
        const replace = (fallback as TabFridgeAdapter & { replaceSnapshot?: (next: TabFridgeSnapshot) => void }).replaceSnapshot;
        replace?.(remoteSnapshot);
      }
      return response.result ?? response.data ?? response;
    } catch (error) {
      if (isNoReceiverError(error)) return undefined;
      throw error;
    }
  };

  const callFallback = async <T>(operation: (adapter: TabFridgeAdapter) => Promise<T>): Promise<T> => operation(fallback);

  return {
    async getSnapshot() {
      const result = await bridge("refresh");
      const remote = normalizeSnapshot(result);
      return remote ?? callFallback((adapter) => adapter.getSnapshot());
    },
    async createWorkspace(draft) {
      const result = await bridge("workspace.create", draft);
      if (result && typeof result === "object" && "id" in result) return result as Workspace;
      return callFallback((adapter) => adapter.createWorkspace(draft));
    },
    async updateWorkspace(id, draft) {
      const result = await bridge("workspace.update", { id, draft });
      if (result && typeof result === "object" && "id" in result) return result as Workspace;
      return callFallback((adapter) => adapter.updateWorkspace(id, draft));
    },
    async deleteWorkspace(id) {
      const result = await bridge("workspace.delete", { id });
      if (result === undefined || (result && typeof result === "object" && !("id" in result))) {
        await callFallback((adapter) => adapter.deleteWorkspace(id));
      }
    },
    async moveTab(tabId, workspaceId) {
      const result = await bridge("tab.move", { tabId, workspaceId });
      if (result === undefined) await callFallback((adapter) => adapter.moveTab(tabId, workspaceId));
    },
    async moveWorkspace(workspaceId, beforeWorkspaceId) {
      const result = await bridge("workspace.move", { workspaceId, beforeWorkspaceId });
      if (result === undefined) await callFallback((adapter) => adapter.moveWorkspace(workspaceId, beforeWorkspaceId));
    },
    async activateTab(tabId) {
      const result = await bridge("tab.activate", { tabId });
      if (result === undefined) await callFallback((adapter) => adapter.activateTab(tabId));
    },
    async requestOrganization(mode, tabIds) {
      const result = await bridge("organization.preview", { mode, tabIds });
      if (result && typeof result === "object" && "groups" in result) return result as OrganizationPreview;
      throw new Error("请先配置 AI API，再开始整理");
    },
    async applyOrganization(preview) {
      const result = await bridge("organization.apply", { preview });
      if (result === undefined) throw new Error("AI 整理服务不可用");
    },
    async exportBackup() {
      const result = await bridge("backup.export");
      if (typeof result === "string") return result;
      if (result && typeof result === "object" && "json" in result && typeof (result as { json?: unknown }).json === "string") {
        return (result as { json: string }).json;
      }
      throw new Error("无法导出 JSON 备份");
    },
    async importBackup(json) {
      const result = await bridge("backup.import", { json });
      if (result === undefined) throw new Error("无法导入 JSON 备份");
    },
    subscribe(listener) {
      const unsubscribeFallback = fallback.subscribe?.(listener) ?? (() => undefined);
      const runtime = getRuntime();
      const browserEvents = getBrowserStateEvents();
      let refreshWatchdog: ReturnType<typeof setTimeout> | undefined;
      const clearRefreshWatchdog = () => {
        if (refreshWatchdog !== undefined) clearTimeout(refreshWatchdog);
        refreshWatchdog = undefined;
      };
      const scheduleRefreshWatchdog = () => {
        clearRefreshWatchdog();
        refreshWatchdog = setTimeout(() => {
          refreshWatchdog = undefined;
          void bridge("refresh").catch(() => undefined);
        }, 400);
      };
      const onMessage = (message: unknown): false => {
        if (!isStateUpdatedMessage(message)) return false;
        clearRefreshWatchdog();
        const snapshot = normalizeSnapshot(message.snapshot);
        if (!snapshot) return false;
        const replace = (fallback as TabFridgeAdapter & { replaceSnapshot?: (next: TabFridgeSnapshot) => void }).replaceSnapshot;
        replace?.(snapshot);
        return false;
      };
      runtime?.onMessage?.addListener?.(onMessage);
      for (const event of browserEvents) event.addListener?.(scheduleRefreshWatchdog);
      return () => {
        clearRefreshWatchdog();
        for (const event of browserEvents) event.removeListener?.(scheduleRefreshWatchdog);
        runtime?.onMessage?.removeListener?.(onMessage);
        unsubscribeFallback();
      };
    }
  };
}

export { createInMemoryAdapter };
