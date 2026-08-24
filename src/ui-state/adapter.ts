import type {
  OrganizationMode,
  OrganizationPreview,
  TabRecord,
  Workspace,
  WorkspaceMergePreview
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
import { getAppLanguage, translate, type MessageKey } from "../i18n";
import type { BackupImportResult } from "../shared/backup";
import { normalizeWorkspaceIcon } from "../shared/workspaceAppearance";
import type { MoveTabsResponse } from "../shared/messages";
import { createWorkspaceMergePreview } from "../shared/workspaceMerge";

const DEFAULT_WORKSPACE_COLOR = "slate";
export const ORGANIZATION_PREVIEW_BATCH_SIZE = 50;
export const ORGANIZATION_PREVIEW_TIMEOUT_MS = 59_000;

function tr(key: MessageKey, variables?: Record<string, string | number | undefined>): string {
  return translate(getAppLanguage(), key, variables);
}

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

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string,
  onTimeout?: () => void
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          onTimeout?.();
          reject(new Error(message));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
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
        icon: normalizeWorkspaceIcon(draft.icon),
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
      if (!current) throw new Error(tr("error.workspaceNotFound"));
      const workspace: Workspace = {
        ...current,
        ...draft,
        name: draft.name?.trim() || current.name,
        description: draft.description === undefined ? current.description : draft.description.trim(),
        tags: draft.tags === undefined ? current.tags : draft.tags,
        color: draft.color || current.color,
        icon: normalizeWorkspaceIcon(draft.icon ?? current.icon),
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
    async moveTabs(tabIds, workspaceId, targetWindowKey) {
      if (workspaceId && !snapshot.workspaces.some((workspace) => workspace.id === workspaceId)) {
        throw new Error(tr("error.targetWorkspaceMissing"));
      }
      const requested = [...new Set(tabIds)];
      const targetWorkspace = workspaceId ? snapshot.workspaces.find((workspace) => workspace.id === workspaceId) : undefined;
      const targetWindow = workspaceId === null && targetWindowKey
        ? snapshot.windows.find((window) => window.key === targetWindowKey)
        : undefined;
      if (workspaceId === null && targetWindowKey && !targetWindow) throw new Error(tr("error.targetWindowMissing"));
      const movedTabIds: string[] = [];
      const skippedTabIds: string[] = [];
      const nextTabs = snapshot.tabs.map((tab) => {
        if (!requested.includes(tab.id)) return tab;
        const allowed = workspaceId === null
          ? tab.kind === "normal" && !tab.pinned
          : tab.kind === "normal" || tab.kind === "fixed";
        if (!allowed) {
          skippedTabIds.push(tab.id);
          return tab;
        }
        movedTabIds.push(tab.id);
        return {
          ...tab,
          workspaceId,
          ...(targetWorkspace ? { windowKey: targetWorkspace.windowKey } : targetWindow ? { windowKey: targetWindow.key } : {}),
          ...(workspaceId && (tab.pinned || tab.kind === "fixed") ? { pinned: false, kind: "normal" as const } : {})
        };
      });
      for (const id of requested) {
        if (!movedTabIds.includes(id) && !skippedTabIds.includes(id)) skippedTabIds.push(id);
      }
      snapshot = {
        ...snapshot,
        tabs: nextTabs
      };
      publish();
      return { ...cloneSnapshot(snapshot), movedTabIds, skippedTabIds };
    },
    async moveTab(tabId, workspaceId) {
      await this.moveTabs([tabId], workspaceId);
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
    async previewWorkspaceMerge(sourceWorkspaceId, targetWorkspaceId) {
      const source = snapshot.workspaces.find((workspace) => workspace.id === sourceWorkspaceId);
      const target = snapshot.workspaces.find((workspace) => workspace.id === targetWorkspaceId);
      if (!source || !target || source.id === target.id) throw new Error(tr("error.mergeTargetInvalid"));
      const sourceTabs = snapshot.tabs.filter((tab) => tab.workspaceId === source.id && tab.kind !== "special");
      return createWorkspaceMergePreview(source, target, sourceTabs);
    },
    async mergeWorkspaces(preview) {
      const current = await this.previewWorkspaceMerge(preview.sourceWorkspaceId, preview.targetWorkspaceId);
      if (JSON.stringify(current) !== JSON.stringify(preview)) throw new Error(tr("error.mergeStateChanged"));
      const target = snapshot.workspaces.find((workspace) => workspace.id === preview.targetWorkspaceId);
      if (!target) throw new Error(tr("error.workspaceNotFound"));
      snapshot = {
        ...snapshot,
        workspaces: snapshot.workspaces.filter((workspace) => workspace.id !== preview.sourceWorkspaceId),
        tabs: snapshot.tabs.map((tab) => preview.sourceTabIds.includes(tab.id)
          ? { ...tab, workspaceId: target.id, windowKey: target.windowKey, pinned: false, kind: "normal" as const }
          : tab)
      };
      publish();
    },
    async activateTab(tabId) {
      const tab = snapshot.tabs.find((item) => item.id === tabId);
      if (!tab) throw new Error(tr("error.tabMissing"));
      // The browser adapter turns this into a tabs.update call. The in-memory
      // adapter keeps activation local so the UI remains usable in a preview.
    },
    async requestOrganization() {
      throw new Error(tr("error.configureAI"));
    },
    async applyOrganization(preview) {
      const nonEmptyGroups = preview.groups.filter((group) => group.tabIds.length > 0);
      const sourceWorkspaceIds = new Set(snapshot.tabs
        .filter((tab) => preview.sourceTabIds.includes(tab.id) && tab.workspaceId !== null)
        .map((tab) => tab.workspaceId as string));
      const workspaceByGroup = new Map<string, string>();
      for (const group of nonEmptyGroups) {
        let workspaceId = group.existingWorkspaceId;
        if (!workspaceId || !snapshot.workspaces.some((workspace) => workspace.id === workspaceId)) {
          const firstTab = snapshot.tabs.find((tab) => group.tabIds.includes(tab.id));
          const created = await this.createWorkspace({
            windowKey: firstTab?.windowKey ?? snapshot.windows[0]?.key ?? "window:unknown",
            name: group.name,
            description: group.description,
            tags: group.tags,
            color: group.color,
            icon: group.icon
          });
          workspaceId = created.id;
        }
        workspaceByGroup.set(group.id, workspaceId);
      }
      const groupByTabId = new Map<string, string>();
      for (const group of nonEmptyGroups) {
        for (const tabId of group.tabIds) groupByTabId.set(tabId, group.id);
      }
      const nextTabs = snapshot.tabs.map((tab) => {
        const groupId = groupByTabId.get(tab.id);
        if (!groupId) return preview.unclassifiedTabIds.includes(tab.id) ? { ...tab, workspaceId: null } : tab;
        return { ...tab, workspaceId: workspaceByGroup.get(groupId) ?? tab.workspaceId };
      });
      const emptiedSourceWorkspaceIds = new Set([...sourceWorkspaceIds].filter((workspaceId) =>
        !nextTabs.some((tab) => tab.workspaceId === workspaceId)
      ));
      snapshot = {
        ...snapshot,
        workspaces: snapshot.workspaces.filter((workspace) => !emptiedSourceWorkspaceIds.has(workspace.id)),
        tabs: nextTabs
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
      if (response.ok === false) throw new Error(typeof response.error === "string" ? response.error : tr("error.operationFailed"));
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
    async moveTabs(tabIds, workspaceId, targetWindowKey) {
      const result = await bridge("tabs.move", { tabIds, workspaceId, windowKey: targetWindowKey });
      if (result && typeof result === "object" && "movedTabIds" in result && "skippedTabIds" in result) {
        return result as MoveTabsResponse;
      }
      return callFallback((adapter) => adapter.moveTabs(tabIds, workspaceId, targetWindowKey));
    },
    async moveWorkspace(workspaceId, beforeWorkspaceId) {
      const result = await bridge("workspace.move", { workspaceId, beforeWorkspaceId });
      if (result === undefined) await callFallback((adapter) => adapter.moveWorkspace(workspaceId, beforeWorkspaceId));
    },
    async previewWorkspaceMerge(sourceWorkspaceId, targetWorkspaceId) {
      const result = await bridge("workspace.merge.preview", { sourceWorkspaceId, targetWorkspaceId });
      if (result && typeof result === "object" && "sourceFingerprint" in result) return result as WorkspaceMergePreview;
      return callFallback((adapter) => adapter.previewWorkspaceMerge(sourceWorkspaceId, targetWorkspaceId));
    },
    async mergeWorkspaces(preview) {
      const result = await bridge("workspace.merge", { preview });
      if (result === undefined) await callFallback((adapter) => adapter.mergeWorkspaces(preview));
    },
    async activateTab(tabId) {
      const result = await bridge("tab.activate", { tabId });
      if (result === undefined) await callFallback((adapter) => adapter.activateTab(tabId));
    },
    async requestOrganization(mode, tabIds) {
      const requestId = makeId("organization");
      let requestedCount = tabIds?.length ?? 0;
      if (requestedCount === 0) {
        const refreshed = normalizeSnapshot(await bridge("refresh"));
        const latest = refreshed ?? await callFallback((adapter) => adapter.getSnapshot());
        requestedCount = latest.tabs.filter((tab) => tab.kind === "normal" && !tab.pinned && tab.workspaceId === null).length;
      }
      const batches = Math.max(1, Math.ceil(Math.max(1, requestedCount) / ORGANIZATION_PREVIEW_BATCH_SIZE));
      const timeoutMs = batches * ORGANIZATION_PREVIEW_TIMEOUT_MS;
      const result = await withTimeout(
        bridge("organization.preview", { mode, tabIds, requestId }),
        timeoutMs,
        batches === 1
          ? tr("error.previewTimeout")
          : tr("error.previewBatchTimeout", { seconds: batches * 59 }),
        () => { void bridge("organization.cancel", { requestId }).catch(() => undefined); }
      );
      if (result && typeof result === "object" && "groups" in result) return result as OrganizationPreview;
      throw new Error(tr("error.configureAI"));
    },
    async applyOrganization(preview) {
      const result = await bridge("organization.apply", { preview });
      if (result === undefined) throw new Error(tr("error.aiUnavailable"));
    },
    async exportBackup() {
      const result = await bridge("backup.export");
      if (typeof result === "string") return result;
      if (result && typeof result === "object" && "json" in result && typeof (result as { json?: unknown }).json === "string") {
        return (result as { json: string }).json;
      }
      throw new Error(tr("error.exportFailed"));
    },
    async importBackup(json) {
      const result = await bridge("backup.import", { json });
      if (result === undefined) throw new Error(tr("error.importFailed"));
      if (!result || typeof result !== "object" || !("backup" in result) || !Array.isArray((result as { skippedTabs?: unknown }).skippedTabs)) {
        throw new Error(tr("error.importFailed"));
      }
      return result as BackupImportResult;
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
