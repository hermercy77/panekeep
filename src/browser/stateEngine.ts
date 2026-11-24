import type {
  TabRecord,
  TabKind,
  WindowState,
  Workspace,
  WorkspaceMergePreview
} from "../shared/contracts";
import type { BackgroundRequest, BrowserStateResponse, MoveTabsResponse } from "../shared/messages";
import {
  nativeGroupId,
  normalizeGroupColor,
  STORAGE_DEBOUNCE_MS
} from "../shared/constants";
import {
  createBackup,
  parseBackup,
  stringifyBackup,
  type BackupImportResult,
  type BackupImportSkippedTab,
  type StateSnapshot
} from "../shared/backup";
import { addBrowserListener, getBrowserApi, invokeBrowser, type BrowserEvent, type BrowserLike } from "./api";
import { browserTabGroupId, classifyBrowserTab, type BrowserTabLike } from "./classify";
import { compareTab, compareWindow, compareWorkspace, reconcileBrowserSnapshot, snapshotsEqual } from "./reconciler";
import { DebouncedSaver } from "../storage/debouncedSaver";
import { DexieStateRepository, type StateRepository } from "../storage/repository";
import { AIAbortError, AIConfigError } from "../ai/errors";
import { fingerprintTabs } from "../ai/snapshot";
import { isWorkspaceClosableTab, organizationPreviewSchema, workspaceMergePreviewSchema } from "../shared/contracts";
import { getAppLanguage, translate } from "../i18n";
import { assignWorkspaceColors, inferWorkspaceIcon, normalizeWorkspaceIcon } from "../shared/workspaceAppearance";
import { createWorkspaceMergePreview as buildWorkspaceMergePreview, fingerprintWorkspace } from "../shared/workspaceMerge";

export interface BrowserStateEngineOptions {
  api?: BrowserLike;
  repository?: StateRepository;
  debounceMs?: number;
  now?: () => number;
  autoCloseEmptyWindows?: boolean;
}

export interface WorkspaceInput {
  windowId?: number;
  windowKey?: string;
  name: string;
  description?: string;
  tags?: string[];
  color?: string;
  icon?: string;
  tabIds?: string[];
}

export interface WorkspacePatch {
  name?: string;
  description?: string;
  tags?: string[];
  color?: string;
  icon?: string;
  order?: number;
}

export interface MoveTabsOptions {
  tabIds: string[];
  workspaceId?: string | null;
  windowId?: number;
  windowKey?: string;
}

export interface UiActionRequest {
  source?: string;
  action: string;
  payload?: any;
}

interface NativeWindowLike {
  id?: number;
  type?: string;
  incognito?: boolean;
  focused?: boolean;
  tabs?: NativeTabLike[];
}

type ManagedNativeWindow = NativeWindowLike & { id: number };

interface NativeTabLike extends BrowserTabLike {
  incognito?: boolean;
}

type NativeTabChangeInfo = Pick<BrowserTabLike, "title" | "url" | "favIconUrl" | "pinned" | "groupId"> & {
  status?: string;
};

interface NativeGroupLike {
  id?: number;
  windowId?: number;
  title?: string | null;
  color?: string;
  collapsed?: boolean;
}

type NativeGroup = NativeGroupLike & { id: number };

interface NativeRollbackScope {
  tabIds: readonly string[];
  createdWorkspaces: Set<string>;
  createdGroups: Map<number, string>;
}

type StateListener = (state: StateSnapshot) => void;

const EMPTY_STATE: StateSnapshot = { windows: [], workspaces: [], tabs: [] };
const ORGANIZATION_ATTEMPT_TIMEOUT_MS = 28_000;
const ORGANIZATION_BUDGET_MS = 56_000;

function tr(key: Parameters<typeof translate>[1], variables?: Record<string, string | number | undefined>): string {
  return translate(getAppLanguage(), key, variables);
}

/**
 * Synchronizes Chromium windows, tabs and native tab groups into the local
 * PaneKeep model. Browser state is authoritative for membership; IndexedDB
 * holds user-facing metadata such as workspace descriptions and ordering.
 */
export class BrowserStateEngine {
  private readonly api: BrowserLike | undefined;
  private readonly repository: StateRepository;
  private readonly now: () => number;
  private readonly autoCloseEmptyWindows: boolean;
  private readonly saver: DebouncedSaver;
  private state: StateSnapshot = cloneSnapshot(EMPTY_STATE);
  private readonly listeners = new Set<StateListener>();
  private readonly organizationControllers = new Map<string, AbortController>();
  private readonly removeListeners: Array<() => void> = [];
  private syncTimer: ReturnType<typeof setTimeout> | undefined;
  private cleanupTimer: ReturnType<typeof setTimeout> | undefined;
  private syncPromise: Promise<void> | undefined;
  private syncAgain = false;
  private started = false;

  constructor(options: BrowserStateEngineOptions = {}) {
    this.api = options.api ?? tryGetBrowserApi();
    this.repository = options.repository ?? new DexieStateRepository();
    this.now = options.now ?? (() => Date.now());
    this.autoCloseEmptyWindows = options.autoCloseEmptyWindows ?? true;
    this.saver = new DebouncedSaver(
      () => this.repository.replace(cloneSnapshot(this.state)),
      options.debounceMs ?? STORAGE_DEBOUNCE_MS
    );
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    if (this.api) {
      await this.reconcileFromBrowser(true);
      this.registerBrowserEvents();
    } else {
      this.state = normalizeSnapshot(await this.repository.load());
      this.notify();
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    if (this.syncTimer !== undefined) clearTimeout(this.syncTimer);
    if (this.cleanupTimer !== undefined) clearTimeout(this.cleanupTimer);
    this.syncTimer = undefined;
    this.cleanupTimer = undefined;
    for (const controller of this.organizationControllers.values()) controller.abort();
    this.organizationControllers.clear();
    for (const remove of this.removeListeners.splice(0)) remove();
    await this.saver.flush();
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  getState(): StateSnapshot {
    return cloneSnapshot(this.state);
  }

  async flush(): Promise<void> {
    await this.saver.flush();
  }

  /** Full reconciliation used at startup and after browser event bursts. */
  async syncFromBrowser(): Promise<BrowserStateResponse> {
    return this.reconcileFromBrowser();
  }

  private async reconcileFromBrowser(restore = false): Promise<BrowserStateResponse> {
    if (!this.api) return this.getState();
    if (this.syncPromise) {
      this.syncAgain = true;
      await this.syncPromise;
      return this.getState();
    }

    const sync = (async () => {
      let persisted = restore ? normalizeSnapshot(await this.repository.load()) : undefined;
      do {
        this.syncAgain = false;
        await this.performSync(persisted);
        persisted = undefined;
      } while (this.syncAgain);
    })();
    this.syncPromise = sync;
    try {
      await sync;
    } finally {
      if (this.syncPromise === sync) this.syncPromise = undefined;
    }
    return this.getState();
  }

  async createWorkspace(input: WorkspaceInput): Promise<Workspace> {
    const workspace = await this.addWorkspace(input);
    if (this.api) await this.syncFromBrowser();
    await this.saver.flush();
    return this.state.workspaces.find((item) => item.id === workspace.id) ?? workspace;
  }

  private async addWorkspace(input: WorkspaceInput): Promise<Workspace> {
    const targetWindow = this.resolveTargetWindow(input.windowId, input.windowKey);
    if (!targetWindow) throw new Error(tr("error.targetWindowRequired"));
    const name = input.name.trim();
    if (!name) throw new Error(tr("error.workspaceNameEmpty"));

    const workspace: Workspace = {
      id: this.newLocalWorkspaceId(targetWindow.key),
      windowKey: targetWindow.key,
      name,
      description: input.description ?? "",
      tags: [...(input.tags ?? [])],
      color: normalizeGroupColor(input.color),
      icon: input.icon
        ? normalizeWorkspaceIcon(input.icon)
        : inferWorkspaceIcon([name, input.description ?? "", ...(input.tags ?? [])]),
      order: this.nextWorkspaceOrder(targetWindow.key),
      createdAt: this.now(),
      updatedAt: this.now()
    };

    const tabIds = this.eligibleNativeTabIds(input.tabIds ?? []);
    const originalTabLocations = tabIds.map((tabId) => ({
      tabId,
      window: this.state.windows.find((window) => window.key === this.state.tabs.find((tab) => tab.id === tabId)?.windowKey),
      pinned: this.state.tabs.find((tab) => tab.id === tabId)?.pinned ?? false
    }));
    try {
      if (tabIds.length > 0 && this.api) {
        await this.moveNativeTabsToWindow(tabIds, targetWindow.nativeId);
        const groupId = await this.createOrUseNativeGroup(tabIds, targetWindow.nativeId, workspace);
        workspace.groupId = groupId;
      }
    } catch (error) {
      if (this.api) {
        for (const original of originalTabLocations) {
          if (!original.window) continue;
          const nativeId = this.toNativeId(original.tabId);
          if (nativeId === undefined) continue;
          try {
            await this.moveNativeTabToWindow(nativeId, original.window.nativeId);
            if (original.pinned) await invokeBrowser(this.api.tabs, "update", nativeId, { pinned: true });
          } catch { /* best-effort rollback */ }
        }
      }
      throw error;
    }

    this.state.workspaces.push(workspace);
    this.state.workspaces.sort(compareWorkspace);
    this.markChanged();
    return workspace;
  }

  async updateWorkspace(workspaceId: string, patch: WorkspacePatch): Promise<Workspace> {
    const workspace = this.state.workspaces.find((item) => item.id === workspaceId);
    if (!workspace) throw new Error(tr("error.workspaceNotFound"));
    const { name, color, icon, tags, ...metadata } = patch;
    const nextName = name === undefined ? workspace.name : name.trim();
    if (!nextName) throw new Error(tr("error.workspaceNameEmpty"));
    const nextColor = color === undefined ? workspace.color : normalizeGroupColor(color);
    const nameChanged = nextName !== workspace.name;
    const colorChanged = nextColor !== workspace.color;

    if ((nameChanged || colorChanged) && this.api && workspace.groupId !== undefined && this.api.tabGroups?.update) {
      await invokeBrowser(this.api.tabGroups, "update", workspace.groupId, {
        ...(nameChanged ? { title: nextName } : {}),
        ...(colorChanged ? { color: nextColor } : {})
      });
      await this.syncPromise?.catch(() => undefined);
    }

    const latest = this.state.workspaces.find((item) => item.id === workspaceId);
    if (!latest) throw new Error(tr("error.workspaceNotFound"));
    Object.assign(latest, {
      ...metadata,
      ...(nameChanged ? { name: nextName } : {}),
      ...(colorChanged ? { color: nextColor } : {}),
      ...(icon === undefined ? {} : { icon: normalizeWorkspaceIcon(icon) }),
      ...(tags === undefined ? {} : { tags: [...tags] }),
      updatedAt: this.now()
    });
    this.state.workspaces.sort(compareWorkspace);
    this.markChanged();
    await this.saver.flush();
    return { ...latest, tags: [...latest.tags] };
  }

  async deleteWorkspace(workspaceId: string, closeTabs = false): Promise<void> {
    const workspace = this.state.workspaces.find((item) => item.id === workspaceId);
    if (!workspace) return;
    const tabIds = this.state.tabs
      .filter((tab) => isWorkspaceClosableTab(tab, workspaceId))
      .map((tab) => tab.id);
    let closedNativeIds: number[] | undefined;
    if (this.api) {
      if (closeTabs) {
        try {
          closedNativeIds = workspace.groupId === undefined
            ? tabIds.map((id) => this.toNativeId(id)).filter((id): id is number => id !== undefined)
            : await this.getClosableNativeGroupTabIds(workspace.windowKey, workspace.groupId);
          if (closedNativeIds.length) await invokeBrowser(this.api.tabs, "remove", closedNativeIds);
        } catch (error) {
          await this.syncFromBrowser();
          throw error;
        }
      } else await this.ungroupNativeTabs(tabIds);
    }
    this.state.workspaces = this.state.workspaces.filter((item) => item.id !== workspaceId);
    if (closeTabs) this.state.tabs = this.state.tabs.flatMap((tab) => {
      if (closedNativeIds?.includes(Number(tab.id))) return [];
      if (tab.workspaceId !== workspaceId) return [tab];
      return closedNativeIds === undefined && isWorkspaceClosableTab(tab, workspaceId)
        ? []
        : [{ ...tab, workspaceId: null }];
    });
    else for (const tab of this.state.tabs) if (tab.workspaceId === workspaceId) tab.workspaceId = null;
    this.markChanged();
    if (this.api) {
      if (closeTabs) await this.closeEmptyWindowsAfterMutation();
      await this.syncFromBrowser();
    }
    await this.saver.flush();
  }

  async ungroupTabs(tabIds: string[]): Promise<BrowserStateResponse> {
    const eligible = this.eligibleNativeTabIds(tabIds);
    if (this.api && eligible.length > 0) await this.ungroupNativeTabs(eligible);
    for (const tab of this.state.tabs) {
      if (eligible.includes(tab.id)) tab.workspaceId = null;
    }
    this.markChanged();
    if (this.api) await this.syncFromBrowser();
    return this.getState();
  }

  async moveTabs(options: MoveTabsOptions): Promise<MoveTabsResponse> {
    const requested = [...new Set(options.tabIds)];
    const unclassifiedTargetWindow = options.workspaceId === null && (options.windowId !== undefined || options.windowKey !== undefined)
      ? this.resolveTargetWindow(options.windowId, options.windowKey)
      : undefined;
    if (options.workspaceId === null
      && (options.windowId !== undefined || options.windowKey !== undefined)
      && !unclassifiedTargetWindow) {
      throw new Error(tr("error.targetWindowMissing"));
    }
    const alreadyMoved = requested.filter((id) => {
      const tab = this.state.tabs.find((item) => item.id === id);
      if (!tab || tab.kind !== "normal" || tab.pinned) return false;
      return options.workspaceId === null
        ? tab.workspaceId === null && (!unclassifiedTargetWindow || tab.windowKey === unclassifiedTargetWindow.key)
        : typeof options.workspaceId === "string" && tab.workspaceId === options.workspaceId;
    });
    const eligible = requested.filter((id) => {
      if (alreadyMoved.includes(id)) return false;
      const tab = this.state.tabs.find((item) => item.id === id);
      const allowed = options.workspaceId === null ? tab?.kind === "normal" : (tab?.kind === "normal" || tab?.kind === "fixed");
      return allowed && this.toNativeId(id) !== undefined;
    });
    let movedTabIds: string[] = [...alreadyMoved];

    if (options.workspaceId !== undefined) {
      if (options.workspaceId === null) {
        movedTabIds.push(...await this.moveTabsToUnclassified(eligible, options.windowId, options.windowKey));
      } else {
        movedTabIds.push(...await this.moveTabsToWorkspace(eligible, options.workspaceId));
      }
    } else if (options.windowId !== undefined || options.windowKey !== undefined) {
      const targetWindow = this.resolveTargetWindow(options.windowId, options.windowKey);
      if (!targetWindow) throw new Error(tr("error.targetWindowMissing"));
      movedTabIds.push(...await this.moveTabsToWindow(eligible, targetWindow.nativeId));
    } else {
      throw new Error(tr("error.workspaceTargetRequired"));
    }

    if (this.api) {
      await this.closeEmptyWindowsAfterMutation();
      await this.syncFromBrowser();
    }
    await this.saver.flush();
    const skippedTabIds = requested.filter((id) => !movedTabIds.includes(id));
    return { ...this.getState(), movedTabIds, skippedTabIds };
  }

  async closeEmptyWindows(): Promise<{ closedWindowIds: number[] }> {
    const closedWindowIds = await this.closeEmptyNativeWindows();
    if (closedWindowIds.length > 0) await this.syncFromBrowser();
    return { closedWindowIds };
  }

  async closeTabs(tabIds: string[]): Promise<{ closedTabIds: string[]; skippedTabIds: string[] }> {
    const requested = [...new Set(tabIds)];
    const closedTabIds: string[] = [];
    const skippedTabIds: string[] = [];
    if (!this.api) return { closedTabIds, skippedTabIds: requested };

    const nativeTabIds: number[] = [];
    for (const tabId of requested) {
      const tab = this.state.tabs.find((item) => item.id === tabId);
      const nativeId = this.toNativeId(tabId);
      if (tab && tab.kind !== "special" && nativeId !== undefined) {
        nativeTabIds.push(nativeId);
        closedTabIds.push(tabId);
      } else {
        skippedTabIds.push(tabId);
      }
    }
    if (nativeTabIds.length > 0) {
      await invokeBrowser(this.api.tabs, "remove", nativeTabIds);
      await this.closeEmptyWindowsAfterMutation();
      await this.syncFromBrowser();
      await this.saver.flush();
    }
    return { closedTabIds, skippedTabIds };
  }

  async setTabPinned(tabId: string, pinned: boolean): Promise<void> {
    const tab = this.state.tabs.find((item) => item.id === tabId);
    const nativeId = this.toNativeId(tabId);
    if (!tab || nativeId === undefined) throw new Error(tr("error.tabMissing"));
    if (tab.kind === "special") return;
    if (!this.api) throw new Error(tr("browser.unavailable"));

    if (pinned && tab.groupId !== undefined) await this.ungroupNativeTabs([tabId]);
    await invokeBrowser(this.api.tabs, "update", nativeId, { pinned });
    await this.syncFromBrowser();
    await this.saver.flush();
  }

  async activateTab(tabId: string): Promise<void> {
    const tab = this.state.tabs.find((item) => item.id === tabId);
    const nativeId = this.toNativeId(tabId);
    if (!tab || nativeId === undefined) throw new Error(tr("error.tabMissing"));
    if (this.api) {
      await invokeBrowser(this.api.tabs, "update", nativeId, { active: true });
      const window = this.state.windows.find((item) => item.key === tab.windowKey);
      if (window && this.api.windows?.update) {
        try {
          await invokeBrowser(this.api.windows, "update", window.nativeId, { focused: true });
        } catch {
          // Focusing can be rejected by a browser policy; activating the tab
          // is still useful and should not turn into a failed move.
        }
      }
      await this.syncFromBrowser();
      return;
    }
    const current = this.state.tabs.find((item) => item.id === tabId);
    if (current) current.lastActivatedAt = this.now();
    this.markChanged();
  }

  async moveWorkspace(workspaceId: string, beforeWorkspaceId?: string): Promise<void> {
    const source = this.state.workspaces.find((workspace) => workspace.id === workspaceId);
    if (!source) return;
    if (beforeWorkspaceId === source.id) return;
    const requestedBefore = beforeWorkspaceId
      ? this.state.workspaces.find((workspace) => workspace.id === beforeWorkspaceId && workspace.windowKey === source.windowKey)
      : undefined;
    const siblings = this.state.workspaces
      .filter((workspace) => workspace.windowKey === source.windowKey && workspace.id !== workspaceId)
      .sort(compareWorkspace);
    const beforeIndex = requestedBefore
      ? siblings.findIndex((workspace) => workspace.id === requestedBefore.id)
      : siblings.length;
    const insertAt = beforeIndex < 0 ? siblings.length : beforeIndex;
    if (this.api && source.groupId !== undefined && this.api.tabGroups?.move && (!requestedBefore || requestedBefore.groupId !== undefined)) {
      const sourceIndices = this.state.tabs
        .filter((tab) => tab.groupId === source.groupId && tab.kind === "normal")
        .map((tab) => tab.index)
        .sort((left, right) => left - right);
      const targetIndex = requestedBefore
        ? this.state.tabs
          .filter((tab) => tab.groupId === requestedBefore.groupId && tab.kind === "normal")
          .reduce<number | undefined>((lowest, tab) => lowest === undefined ? tab.index : Math.min(lowest, tab.index), undefined)
        : undefined;
      const adjustedIndex = targetIndex !== undefined && sourceIndices.length && sourceIndices[0] < targetIndex
        ? Math.max(0, targetIndex - sourceIndices.length)
        : targetIndex;
      try {
        await invokeBrowser(this.api.tabGroups, "move", source.groupId, {
          index: adjustedIndex ?? -1
        });
      } catch {
        // Native order is authoritative. Reconcile instead of leaving an
        // optimistic local order that the browser rejected.
      }
      await this.syncFromBrowser();
      await this.saver.flush();
      return;
    }

    siblings.splice(insertAt, 0, source);
    siblings.forEach((workspace, index) => {
      workspace.order = index;
      workspace.updatedAt = this.now();
    });
    this.markChanged();
    await this.saver.flush();
  }

  createWorkspaceMergePreview(sourceWorkspaceId: string, targetWorkspaceId: string): WorkspaceMergePreview {
    if (!sourceWorkspaceId || !targetWorkspaceId || sourceWorkspaceId === targetWorkspaceId) {
      throw new Error(tr("error.mergeTargetInvalid"));
    }
    const source = this.state.workspaces.find((workspace) => workspace.id === sourceWorkspaceId);
    const target = this.state.workspaces.find((workspace) => workspace.id === targetWorkspaceId);
    if (!source || !target) throw new Error(tr("error.workspaceNotFound"));
    const sourceTabs = this.state.tabs.filter((tab) => tab.workspaceId === source.id && tab.kind !== "special");
    return workspaceMergePreviewSchema.parse(buildWorkspaceMergePreview(source, target, sourceTabs));
  }

  async mergeWorkspaces(value: WorkspaceMergePreview): Promise<void> {
    const preview = workspaceMergePreviewSchema.parse(value);
    if (preview.sourceWorkspaceId === preview.targetWorkspaceId) throw new Error(tr("error.mergeTargetInvalid"));
    const source = this.state.workspaces.find((workspace) => workspace.id === preview.sourceWorkspaceId);
    const target = this.state.workspaces.find((workspace) => workspace.id === preview.targetWorkspaceId);
    if (!source || !target) throw new Error(tr("error.workspaceNotFound"));
    const workspaceChanged = source.windowKey !== preview.sourceWindowKey
      || target.windowKey !== preview.targetWindowKey
      || fingerprintWorkspace(source) !== preview.sourceWorkspaceFingerprint
      || fingerprintWorkspace(target) !== preview.targetWorkspaceFingerprint;
    const sourceTabs = this.state.tabs.filter((tab) => tab.workspaceId === source.id && tab.kind !== "special");
    const sourceTabIds = sourceTabs.map((tab) => tab.id);
    const expectedIds = [...preview.sourceTabIds].sort();
    const currentIds = [...sourceTabIds].sort();
    if (workspaceChanged
      || expectedIds.length !== currentIds.length
      || expectedIds.some((id, index) => id !== currentIds[index])
      || fingerprintTabs(sourceTabs) !== preview.sourceFingerprint) {
      throw new Error(tr("error.mergeStateChanged"));
    }

    const beforeState = this.getState();
    const rollback: NativeRollbackScope = {
      tabIds: sourceTabIds, createdWorkspaces: new Set(), createdGroups: new Map()
    };
    try {
      const moved = sourceTabs.length
        ? await this.moveTabsToWorkspace(sourceTabIds, target.id, rollback)
        : [];
      if (moved.length !== sourceTabs.length) throw new Error(tr("error.mergeMoveIncomplete"));
      this.state.workspaces = this.state.workspaces.filter((workspace) => workspace.id !== source.id);
      this.markChanged();
      if (this.api) {
        await this.closeEmptyWindowsAfterMutation();
        await this.syncFromBrowser();
      }
    } catch (error) {
      await this.rollbackNativeState(beforeState, rollback);
      throw error;
    }
    await this.saver.flush();
  }

  async exportBackup(asJson = false): Promise<ReturnType<typeof createBackup> | string> {
    const backup = createBackup(this.state);
    return asJson ? stringifyBackup(backup) : backup;
  }

  async importBackup(value: unknown): Promise<BackupImportResult> {
    const backup = parseBackup(value);
    const skippedTabs: BackupImportSkippedTab[] = [];
    if (this.api) {
      const beforeState = this.getState();
      const createdNativeWindowIds: number[] = [];
      try {
      const usedNames = new Set(this.state.workspaces.map((workspace) => workspace.name));
      const uniqueName = (base: string): string => {
        const clean = base.trim() || tr("backup.importWorkspace");
        if (!usedNames.has(clean)) {
          usedNames.add(clean);
          return clean;
        }
        let suffix = 1;
        let candidate = `${clean}${tr("backup.copySuffix")}`;
        while (usedNames.has(candidate)) candidate = `${clean}${tr("backup.numberedSuffix", { count: suffix++ })}`;
        usedNames.add(candidate);
        return candidate;
      };
      const importedWorkspaces: Array<{
        nativeWindowId: number;
        source: Workspace;
        name: string;
        groupId?: number;
      }> = [];
      const importedWindows: Array<{ source: WindowState; nativeId: number }> = [];

      for (const sourceWindow of [...backup.windows].sort((left, right) => left.order - right.order)) {
        const sourceTabs = backup.tabs
          .filter((tab) => tab.windowKey === sourceWindow.key && tab.kind !== "special")
          .sort((left, right) => left.index - right.index);
        const sourceSpecialTabs = backup.tabs
          .filter((tab) => tab.windowKey === sourceWindow.key && tab.kind === "special")
          .sort((left, right) => left.index - right.index);
        const urls = sourceTabs.map((tab) => tab.url || "about:blank");
        const created = await invokeBrowser<NativeWindowLike>(this.api.windows, "create", {
          url: urls.length ? urls : ["about:blank"],
          focused: false,
          incognito: false
        });
        if (!isManagedNativeWindow(created)) continue;
        createdNativeWindowIds.push(created.id);
        importedWindows.push({ source: sourceWindow, nativeId: created.id });
        const nativeTabs = (await this.getNativeTabs(created))
          .filter((tab) => tab.id !== undefined)
          .sort((left, right) => (left.index ?? 0) - (right.index ?? 0));
        const tabMap = new Map<string, number>();
        sourceTabs.forEach((sourceTab, index) => {
          const nativeTab = nativeTabs[index];
          if (nativeTab?.id !== undefined) tabMap.set(sourceTab.id, nativeTab.id);
        });
        for (const sourceTab of sourceTabs) {
          const nativeId = tabMap.get(sourceTab.id);
          if (nativeId === undefined) continue;
          if (sourceTab.pinned) {
            try { await invokeBrowser(this.api.tabs, "update", nativeId, { pinned: true }); } catch { /* best effort */ }
          }
        }
        for (const [index, sourceTab] of sourceTabs.entries()) {
          const nativeId = tabMap.get(sourceTab.id);
          if (index === 0 || nativeId === undefined || typeof this.api.tabs.discard !== "function") continue;
          try { await invokeBrowser(this.api.tabs, "discard", nativeId); } catch { /* best effort lazy restore */ }
        }
        let restoredSpecialTabs = 0;
        for (const sourceTab of sourceSpecialTabs) {
          try {
            if (!sourceTab.url) throw new Error(tr("backup.specialRestoreFailed"));
            const restored = await invokeBrowser<NativeTabLike>(this.api.tabs, "create", {
              windowId: created.id,
              url: sourceTab.url,
              active: false
            });
            if (restored?.id === undefined || !isTabInNativeWindow(restored, created.id)) {
              throw new Error(tr("backup.specialRestoreFailed"));
            }
            restoredSpecialTabs += 1;
            if (typeof this.api.tabs.discard === "function") {
              try { await invokeBrowser(this.api.tabs, "discard", restored.id); } catch { /* best effort lazy restore */ }
            }
          } catch {
            skippedTabs.push({
              id: sourceTab.id,
              ...(sourceTab.title ? { title: sourceTab.title } : {}),
              url: sourceTab.url,
              reason: "browser_blocked"
            });
          }
        }
        if (sourceTabs.length === 0 && restoredSpecialTabs > 0 && typeof this.api.tabs.remove === "function") {
          const placeholderId = nativeTabs[0]?.id;
          if (placeholderId !== undefined) {
            try { await invokeBrowser(this.api.tabs, "remove", placeholderId); } catch { /* keep harmless placeholder */ }
          }
        }
        const sourceWorkspaces = backup.workspaces
          .filter((workspace) => workspace.windowKey === sourceWindow.key)
          .sort((left, right) => left.order - right.order);
        for (const sourceWorkspace of sourceWorkspaces) {
          const nativeIds = backup.tabs
            .filter((tab) => tab.workspaceId === sourceWorkspace.id && tabMap.has(tab.id))
            .map((tab) => tabMap.get(tab.id) as number);
          const name = uniqueName(sourceWorkspace.name);
          let groupId: number | undefined;
          if (nativeIds.length) {
            groupId = await invokeBrowser<number>(this.api.tabs, "group", {
              tabIds: nativeIds,
              createProperties: { windowId: created.id }
            });
            try {
              await invokeBrowser(this.api.tabGroups, "update", groupId, {
                title: name,
                color: normalizeGroupColor(sourceWorkspace.color)
              });
            } catch { /* group metadata is restored during reconciliation */ }
          }
          importedWorkspaces.push({
            nativeWindowId: created.id,
            source: sourceWorkspace,
            name,
            groupId
          });
        }
      }

      await this.syncFromBrowser();
      for (const importedWindow of importedWindows) {
        const targetWindow = this.state.windows.find((window) => window.nativeId === importedWindow.nativeId);
        if (targetWindow) targetWindow.name = importedWindow.source.name;
      }
      for (const { nativeWindowId, source, name, groupId } of importedWorkspaces) {
        const targetWindow = this.state.windows.find((window) => window.nativeId === nativeWindowId);
        if (!targetWindow) continue;
        const metadata = {
          name,
          description: source.description,
          tags: [...source.tags],
          color: normalizeGroupColor(source.color),
          icon: normalizeWorkspaceIcon(source.icon),
          order: source.order,
          updatedAt: this.now()
        };
        if (groupId === undefined) {
          this.state.workspaces.push({
            ...metadata,
            id: this.newLocalWorkspaceId(targetWindow.key),
            windowKey: targetWindow.key,
            createdAt: source.createdAt
          });
        } else {
          const targetWorkspace = this.state.workspaces.find((workspace) =>
            workspace.windowKey === targetWindow.key && workspace.groupId === groupId);
          if (targetWorkspace) Object.assign(targetWorkspace, metadata);
        }
      }
      this.markChanged();
      await this.saver.flush();
      return { backup, skippedTabs };
      } catch (error) {
        for (const nativeWindowId of createdNativeWindowIds) {
          try { await invokeBrowser(this.api.windows, "remove", nativeWindowId); } catch { /* best effort rollback */ }
        }
        this.state = normalizeSnapshot(beforeState);
        await this.saver.flush();
        this.notify();
        throw error;
      }
    }
    this.state = normalizeSnapshot({
      windows: backup.windows,
      workspaces: backup.workspaces,
      tabs: backup.tabs
    });
    this.markChanged();
    await this.saver.flush();
    this.notify();
    return { backup, skippedTabs };
  }

  async handleRequest(request: BackgroundRequest): Promise<unknown> {
    switch (request.type) {
      case "panekeep/get-state":
        return this.getState();
      case "panekeep/refresh":
        return this.syncFromBrowser();
      case "panekeep/export-backup":
        return { backup: await this.exportBackup(false), json: request.asJson ? await this.exportBackup(true) : undefined };
      case "panekeep/import-backup":
        return this.importBackup(request.backup);
      case "panekeep/create-workspace":
        return this.createWorkspace(request);
      case "panekeep/update-workspace":
        return this.updateWorkspace(request.workspaceId, request.patch);
      case "panekeep/delete-workspace":
        return this.deleteWorkspace(request.workspaceId, request.closeTabs === true);
      case "panekeep/merge-workspaces":
        return this.mergeWorkspaces(request.preview);
      case "panekeep/move-tabs":
        return this.moveTabs(request);
      case "panekeep/ungroup-tabs":
        return this.ungroupTabs(request.tabIds);
      case "panekeep/close-empty-windows":
        return this.closeEmptyWindows();
      default:
        throw new Error(tr("background.unknownRequest", { action: (request as { type: string }).type }));
    }
  }

  /** Compatibility envelope consumed by the sidebar/manage UI adapter. */
  async handleUiAction(request: UiActionRequest): Promise<unknown> {
    const payload = request.payload ?? {};
    let result: unknown;
    switch (request.action) {
      case "snapshot":
        result = this.getState();
        break;
      case "refresh":
        await this.syncFromBrowser();
        result = this.getState();
        break;
      case "workspace.create":
        result = await this.createWorkspace({
          ...payload,
          windowKey: payload.windowKey,
          name: String(payload.name ?? ""),
          description: payload.description,
          tags: payload.tags,
          color: payload.color,
          icon: payload.icon,
          tabIds: payload.tabIds
        });
        break;
      case "workspace.update":
        result = await this.updateWorkspace(String(payload.id), payload.draft ?? {});
        break;
      case "workspace.delete":
        result = await this.deleteWorkspace(String(payload.id), payload.closeTabs === true);
        break;
      case "workspace.move":
        result = await this.moveWorkspace(String(payload.workspaceId), payload.beforeWorkspaceId);
        break;
      case "workspace.merge.preview":
        result = this.createWorkspaceMergePreview(String(payload.sourceWorkspaceId), String(payload.targetWorkspaceId));
        break;
      case "workspace.merge":
        result = await this.mergeWorkspaces(payload.preview);
        break;
      case "tabs.move":
      case "tab.move":
        result = await this.moveTabs({
          tabIds: request.action === "tab.move"
            ? [String(payload.tabId)]
            : Array.isArray(payload.tabIds) ? payload.tabIds.map(String) : [],
          workspaceId: payload.workspaceId,
          windowKey: typeof payload.windowKey === "string" && payload.windowKey ? payload.windowKey : undefined
        });
        break;
      case "tab.activate":
        result = await this.activateTab(String(payload.tabId));
        break;
      case "tab.close":
        result = await this.closeTabs(Array.isArray(payload.tabIds) ? payload.tabIds.map(String) : []);
        break;
      case "tab.pin":
        result = await this.setTabPinned(String(payload.tabId), payload.pinned === true);
        break;
      case "organization.preview":
        return this.organizationPreview(payload);
      case "organization.cancel":
        return this.cancelOrganization(payload);
      case "organization.apply":
        return this.applyOrganizationPreview(payload);
      case "backup.export":
        return { json: await this.exportBackup(true) };
      case "backup.import": {
        const result = await this.importBackup(String(payload.json ?? ""));
        return { ok: true, result, snapshot: this.getState() };
      }
      default:
        return undefined;
    }
    return { ok: true, result, snapshot: this.getState() };
  }

  private async organizationPreview(payload: Record<string, unknown>): Promise<unknown> {
    const deadlineAt = Date.now() + ORGANIZATION_BUDGET_MS;
    const mode = payload.mode === "type" ? "type" : "purpose";
    const configuredIds = Array.isArray(payload.tabIds)
      ? payload.tabIds.filter((id): id is string => typeof id === "string")
      : [];
    const eligible = this.state.tabs.filter((tab) =>
      (tab.kind === "normal" || tab.kind === "fixed")
      && (configuredIds.length ? configuredIds.includes(tab.id) : (tab.workspaceId === null && !tab.pinned))
    );
    if (!eligible.length) throw new Error(tr("error.noOrganizableTabs"));
    const requestId = typeof payload.requestId === "string" && payload.requestId ? payload.requestId : undefined;
    const controller = new AbortController();
    if (requestId) {
      this.organizationControllers.get(requestId)?.abort();
      this.organizationControllers.set(requestId, controller);
    }
    try {
      const [{ loadAIConfig }, { organizeTabs }] = await Promise.all([
        import("../ai/config"),
        import("../ai/pipeline")
      ]);
      const config = await loadAIConfig();
      if (controller.signal.aborted) throw new AIAbortError();
      if (typeof payload.expectedOrigin === "string" && payload.expectedOrigin !== new URL(config.baseUrl).origin) {
        throw new AIConfigError(tr("ai.invalidConfig"));
      }
      if (!config.apiKey || !config.model) throw new Error(tr("error.configureAIManage"));
      const preview = await organizeTabs({
        tabs: eligible,
        mode,
        config,
        clientOptions: { retry: { timeoutMs: ORGANIZATION_ATTEMPT_TIMEOUT_MS, maxRetries: 1 } },
        existingWorkspaces: this.state.workspaces,
        language: getAppLanguage(),
        getCurrentTabs: () => this.state.tabs.filter((tab) => eligible.some((item) => item.id === tab.id)),
        signal: controller.signal,
        deadlineAt
      });
      const targetWindowKey = this.state.windows.find((window) => window.isCurrent)?.key ?? this.state.windows[0]?.key;
      const existingColors = this.state.workspaces
        .filter((workspace) => workspace.windowKey === targetWindowKey)
        .map((workspace) => workspace.color);
      const suggestedColors = assignWorkspaceColors(existingColors, preview.groups.filter((group) => !group.existingWorkspaceId).length);
      let suggestedColorIndex = 0;
      return organizationPreviewSchema.parse({
        ...preview,
        groups: preview.groups.map((group) => {
          const existing = group.existingWorkspaceId
            ? this.state.workspaces.find((workspace) => workspace.id === group.existingWorkspaceId)
            : undefined;
          if (existing) return { ...group, color: existing.color, icon: existing.icon };
          const icon = inferWorkspaceIcon([group.name, group.description, ...group.tags]);
          return { ...group, icon, color: suggestedColors[suggestedColorIndex++] ?? "grey" };
        })
      });
    } finally {
      if (requestId && this.organizationControllers.get(requestId) === controller) {
        this.organizationControllers.delete(requestId);
      }
    }
  }

  private cancelOrganization(payload: Record<string, unknown>): { cancelled: boolean } {
    const requestId = typeof payload.requestId === "string" ? payload.requestId : "";
    const controller = requestId ? this.organizationControllers.get(requestId) : undefined;
    if (!controller) return { cancelled: false };
    controller.abort();
    this.organizationControllers.delete(requestId);
    return { cancelled: true };
  }

  private async applyOrganizationPreview(payload: Record<string, unknown>): Promise<unknown> {
    const parsed = organizationPreviewSchema.parse(payload.preview);
    const nonEmptyGroups = parsed.groups.filter((group) => group.tabIds.length > 0);
    const beforeState = this.getState();
    const sourceIds = new Set(parsed.sourceTabIds);
    if (sourceIds.size !== parsed.sourceTabIds.length || sourceIds.size === 0) {
      throw new Error(tr("error.invalidPreviewSource"));
    }
    const currentSourceTabs = this.state.tabs.filter((tab) => sourceIds.has(tab.id));
    if (currentSourceTabs.length !== sourceIds.size || currentSourceTabs.some((tab) => tab.kind === "special")) {
      throw new Error(tr("error.browserChanged"));
    }
    if (fingerprintTabs(currentSourceTabs) !== parsed.sourceFingerprint) {
      throw new Error(tr("error.tabChanged"));
    }
    const sourceWorkspaceIds = new Set(currentSourceTabs
      .map((tab) => tab.workspaceId)
      .filter((id): id is string => id !== null));
    const assignedIds: string[] = [];
    for (const group of nonEmptyGroups) assignedIds.push(...group.tabIds);
    assignedIds.push(...parsed.unclassifiedTabIds);
    if (assignedIds.length !== sourceIds.size || new Set(assignedIds).size !== sourceIds.size || assignedIds.some((id) => !sourceIds.has(id))) {
      throw new Error(tr("error.previewIncomplete"));
    }
    const targetWindowKey = typeof payload.targetWindowKey === "string"
      ? payload.targetWindowKey
      : this.state.windows.find((window) => window.isCurrent)?.key ?? this.state.windows[0]?.key;
    if (!targetWindowKey) throw new Error(tr("error.targetWindowMissing"));
    const existingIds = new Set(this.state.workspaces.map((workspace) => workspace.id));
    for (const group of nonEmptyGroups) {
      if (group.existingWorkspaceId && !existingIds.has(group.existingWorkspaceId)) {
        throw new Error(tr("error.aiUnknownWorkspace", { id: group.existingWorkspaceId }));
      }
    }
    const rollback: NativeRollbackScope = {
      tabIds: parsed.sourceTabIds, createdWorkspaces: new Set(), createdGroups: new Map()
    };
    try {
      const workspaceByGroup = new Map<string, string>();
      for (const group of nonEmptyGroups) {
        let workspaceId = group.existingWorkspaceId;
        if (!workspaceId) {
          // Cross-window selections intentionally consolidate into the window
          // currently being operated from, as defined by the product contract.
          const created = await this.addWorkspace({
            windowKey: targetWindowKey,
            name: group.name,
            description: group.description,
            tags: group.tags,
            color: group.color,
            icon: group.icon
          });
          workspaceId = created.id;
          rollback.createdWorkspaces.add(workspaceId);
        }
        workspaceByGroup.set(group.id, workspaceId);
      }
      for (const group of nonEmptyGroups) {
        const workspaceId = workspaceByGroup.get(group.id);
        if (!workspaceId) throw new Error(tr("error.aiMissingTarget"));
        await this.moveTabsToWorkspace(group.tabIds, workspaceId, rollback);
      }
      if (parsed.unclassifiedTabIds.length) {
        await this.moveTabsToUnclassified(parsed.unclassifiedTabIds, this.resolveTargetWindow(undefined, targetWindowKey)?.nativeId, targetWindowKey, true);
      }
      const emptiedSourceWorkspaceIds = new Set([...sourceWorkspaceIds].filter((workspaceId) =>
        !this.state.tabs.some((tab) => tab.workspaceId === workspaceId)
      ));
      if (emptiedSourceWorkspaceIds.size) {
        this.state.workspaces = this.state.workspaces.filter((workspace) => !emptiedSourceWorkspaceIds.has(workspace.id));
        this.markChanged();
      }
      await this.closeEmptyWindowsAfterMutation();
      await this.syncFromBrowser();
    } catch (error) {
      await this.rollbackNativeState(beforeState, rollback);
      throw error;
    }
    await this.saver.flush();
    return this.getState();
  }

  private async rollbackNativeState(before: StateSnapshot, scope: NativeRollbackScope): Promise<void> {
    const api = this.api;
    if (!api) {
      this.replaceState(before);
      await this.saver.flush();
      return;
    }
    let workspacesChanged = false;
    try {
      const { windows } = await this.getNativeWindows();
      const nativeTabs = new Map<number, { tab: NativeTabLike; windowId: number }>();
      const tabOrder = new Map<number, number[]>();
      const occupiedGroupIds = new Set<number>();
      for (const window of windows) {
        const ids: number[] = [];
        tabOrder.set(window.id, ids);
        for (const tab of await this.getNativeTabs(window)) {
          if (tab.id !== undefined) {
            nativeTabs.set(tab.id, { tab, windowId: window.id });
            ids.push(tab.id);
          }
          const groupId = browserTabGroupId(tab);
          if (groupId !== undefined) occupiedGroupIds.add(groupId);
        }
      }

      const selectedIds = new Set(scope.tabIds);
      const groups = new Map<number, { tabIds: number[]; window: WindowState }>();
      for (const tab of before.tabs) {
        if (!selectedIds.has(tab.id) || tab.kind === "special") continue;
        const nativeId = this.toNativeId(tab.id);
        const targetWindow = before.windows.find((window) => window.key === tab.windowKey);
        if (nativeId === undefined || !targetWindow) continue;
        const current = nativeTabs.get(nativeId);
        const originalOrder = tabOrder.get(targetWindow.nativeId);
        const currentOrder = current && tabOrder.get(current.windowId);
        if (!current || !currentOrder || !originalOrder) continue;
        const currentIndex = currentOrder.indexOf(nativeId);
        const moved = currentOrder !== originalOrder || currentIndex !== tab.index;
        try {
          if (moved) {
            await this.moveNativeTabToWindow(nativeId, targetWindow.nativeId, tab.index);
            currentOrder.splice(currentIndex, 1);
            originalOrder.splice(tab.index, 0, nativeId);
          }
          if (tab.pinned !== (current.tab.pinned === true)) {
            await invokeBrowser(api.tabs, "update", nativeId, { pinned: tab.pinned });
          }
        } catch {
          continue;
        }
        if (tab.groupId !== undefined) {
          if (moved || browserTabGroupId(current.tab) !== tab.groupId) {
            const group = groups.get(tab.groupId) ?? { tabIds: [], window: targetWindow };
            group.tabIds.push(nativeId);
            groups.set(tab.groupId, group);
          }
        } else if (browserTabGroupId(current.tab) !== undefined) {
          try { await invokeBrowser(api.tabs, "ungroup", [nativeId]); } catch { /* best effort */ }
        }
      }
      for (const [groupId, { tabIds, window }] of groups) {
        const workspace = before.workspaces.find((item) => item.groupId === groupId && item.windowKey === window.key);
        let restoredGroupId = groupId;
        let restored = false;
        if (occupiedGroupIds.has(groupId)) {
          try {
            await invokeBrowser(api.tabs, "group", { tabIds, groupId });
            restored = true;
          } catch { /* The original group may have closed with its last tab. */ }
        }
        if (!restored) {
          try {
            restoredGroupId = await invokeBrowser<number>(api.tabs, "group", {
              tabIds, createProperties: { windowId: window.nativeId }
            });
          } catch { continue; }
          if (workspace && api.tabGroups?.update) {
            try {
              await invokeBrowser(api.tabGroups, "update", restoredGroupId, {
                title: workspace.name, color: normalizeGroupColor(workspace.color)
              });
            } catch { /* best effort */ }
          }
        }
        if (!workspace) continue;
        const latest = this.state.workspaces.find((item) => item.id === workspace.id);
        if (latest?.groupId === restoredGroupId) continue;
        if (latest) latest.groupId = restoredGroupId;
        else this.state.workspaces.push({ ...workspace, groupId: restoredGroupId });
        workspacesChanged = true;
      }
    } finally {
      const workspaces = this.state.workspaces.filter((workspace) =>
        workspace.groupId !== undefined || !scope.createdWorkspaces.has(workspace.id));
      workspacesChanged ||= workspaces.length !== this.state.workspaces.length;
      this.state.workspaces = workspaces;
      const stateBeforeSync = this.state;
      await this.syncFromBrowser();
      // Publish local workspace changes when reconciliation leaves the state in place.
      if (workspacesChanged && this.state === stateBeforeSync) this.markChanged();
      const restoredLocalIds = new Set<string>();
      for (const [groupId, workspaceId] of scope.createdGroups) {
        if (this.state.tabs.some((tab) => tab.groupId === groupId)) continue;
        restoredLocalIds.add(workspaceId);
        if (api.tabGroups?.remove) {
          try { await invokeBrowser(api.tabGroups, "remove", groupId); } catch { /* Already removed with its last tab. */ }
        }
      }
      for (const workspace of before.workspaces) {
        if (workspace.groupId === undefined && restoredLocalIds.has(workspace.id)
          && this.state.windows.some((window) => window.key === workspace.windowKey)
          && !this.state.workspaces.some((item) => item.id === workspace.id)) {
          this.state.workspaces.push(workspace);
          this.markChanged();
        }
      }
      await this.saver.flush();
    }
  }

  private async performSync(persisted?: StateSnapshot): Promise<void> {
    if (!this.api) return;
    const { windows: nativeWindows, privateWindowIds } = await this.getNativeWindows();
    let focusedWindow: NativeWindowLike | undefined;
    try {
      focusedWindow = await invokeBrowser<NativeWindowLike>(this.api.windows, "getLastFocused", { populate: false });
    } catch {
      try {
        focusedWindow = await invokeBrowser<NativeWindowLike>(this.api.windows, "getCurrent");
      } catch { /* Use the focus flag from the window list. */ }
    }
    if (focusedWindow?.incognito === true && focusedWindow.id !== undefined) {
      privateWindowIds.add(focusedWindow.id);
    }
    const currentWindowId = isManagedNativeWindow(focusedWindow) && nativeWindows.some((window) => window.id === focusedWindow.id)
      ? focusedWindow.id
      : nativeWindows.find((window) => window.focused)?.id;

    const windows = await Promise.all(nativeWindows.map(async (nativeWindow) => {
      const tabs = await this.getNativeTabs(nativeWindow);
      const groups = await this.getNativeGroups(nativeWindow.id, tabs);
      return { id: nativeWindow.id, tabs, groups };
    }));

    const previous = this.state;
    const next = reconcileBrowserSnapshot({
      previous: persisted ?? previous,
      windows,
      privateWindowIds,
      currentWindowId,
      restoring: persisted !== undefined,
      now: this.now(),
      language: getAppLanguage()
    });
    const changed = !snapshotsEqual(previous, next);
    const needsSave = persisted ? !snapshotsEqual(persisted, next) : changed;
    if (!changed && !needsSave) return;
    this.state = next;
    this.notify();
    if (needsSave) this.saver.schedule();
  }

  private registerBrowserEvents(): void {
    if (!this.api) return;
    const tabs = this.api.tabs;
    const windows = this.api.windows;
    const groups = this.api.tabGroups;
    const schedule = (): void => this.scheduleSync();

    this.removeListeners.push(addBrowserListener(windows.onCreated as BrowserEvent | undefined, schedule));
    this.removeListeners.push(addBrowserListener(windows.onRemoved as BrowserEvent | undefined, () => {
      this.scheduleEmptyWindowCleanup();
      schedule();
    }));
    this.removeListeners.push(addBrowserListener(windows.onFocusChanged as BrowserEvent | undefined, schedule));
    this.removeListeners.push(addBrowserListener(tabs.onCreated as BrowserEvent | undefined, schedule));
    this.removeListeners.push(addBrowserListener(tabs.onRemoved as BrowserEvent | undefined, () => {
      this.scheduleEmptyWindowCleanup();
      schedule();
    }));
    this.removeListeners.push(addBrowserListener(tabs.onUpdated as BrowserEvent | undefined, (_tabId: number, changeInfo?: NativeTabChangeInfo) => {
      if (changeInfo == null || "title" in changeInfo || "url" in changeInfo || "favIconUrl" in changeInfo
        || "pinned" in changeInfo || "groupId" in changeInfo || changeInfo.status === "complete") {
        schedule();
      }
    }));
    this.removeListeners.push(addBrowserListener(tabs.onMoved as BrowserEvent | undefined, schedule));
    this.removeListeners.push(addBrowserListener(tabs.onAttached as BrowserEvent | undefined, () => {
      this.scheduleEmptyWindowCleanup();
      schedule();
    }));
    this.removeListeners.push(addBrowserListener(tabs.onDetached as BrowserEvent | undefined, () => {
      this.scheduleEmptyWindowCleanup();
      schedule();
    }));
    this.removeListeners.push(addBrowserListener(tabs.onReplaced as BrowserEvent | undefined, schedule));
    this.removeListeners.push(addBrowserListener(tabs.onActivated as BrowserEvent | undefined, (activeInfo: { tabId?: number }) => {
      if (activeInfo?.tabId !== undefined) {
        const tab = this.state.tabs.find((item) => item.id === String(activeInfo.tabId));
        if (tab) {
          for (const item of this.state.tabs) {
            if (item.windowKey === tab.windowKey) item.active = item.id === tab.id;
          }
          tab.lastActivatedAt = this.now();
          this.markChanged();
        }
      }
      schedule();
    }));
    this.removeListeners.push(addBrowserListener(groups?.onCreated as BrowserEvent | undefined, schedule));
    this.removeListeners.push(addBrowserListener(groups?.onRemoved as BrowserEvent | undefined, schedule));
    this.removeListeners.push(addBrowserListener(groups?.onUpdated as BrowserEvent | undefined, schedule));
    this.removeListeners.push(addBrowserListener(groups?.onMoved as BrowserEvent | undefined, schedule));
  }

  private scheduleSync(): void {
    if (!this.started || !this.api || this.syncTimer !== undefined) return;
    this.syncTimer = setTimeout(() => {
      this.syncTimer = undefined;
      void this.syncFromBrowser().catch(() => undefined);
    }, 0);
  }

  private scheduleEmptyWindowCleanup(): void {
    if (!this.autoCloseEmptyWindows || !this.api || this.cleanupTimer !== undefined) return;
    this.cleanupTimer = setTimeout(() => {
      this.cleanupTimer = undefined;
      void this.closeEmptyWindowsAfterMutation().catch(() => undefined);
    }, 100);
  }

  private async closeEmptyWindowsAfterMutation(): Promise<void> {
    if (!this.autoCloseEmptyWindows) return;
    await this.closeEmptyNativeWindows();
  }

  private async closeEmptyNativeWindows(): Promise<number[]> {
    if (!this.api) return [];
    const { windows } = await this.getNativeWindows();
    const closedWindowIds: number[] = [];
    for (const window of windows) {
      if ((await this.getNativeTabs(window)).length > 0) continue;
      try {
        await invokeBrowser(this.api.windows, "remove", window.id);
        closedWindowIds.push(window.id);
      } catch {
        // Chromium can reject closing the last browser window; preserving it
        // is safer than retrying in an event loop.
      }
    }
    return closedWindowIds;
  }

  private async getClosableNativeGroupTabIds(windowKey: string, groupId: number): Promise<number[]> {
    const nativeWindowId = this.state.windows.find((window) => window.key === windowKey)?.nativeId;
    const { windows } = await this.getNativeWindows();
    const window = windows.find((item) => item.id === nativeWindowId);
    if (!window) return [];
    const tabs = await this.getNativeTabs(window);
    return tabs.flatMap((tab) => tab.id !== undefined && browserTabGroupId(tab) === groupId
      && classifyBrowserTab(tab) !== "special" ? [tab.id] : []);
  }

  private async getNativeWindows(): Promise<{ windows: ManagedNativeWindow[]; privateWindowIds: Set<number> }> {
    const windows = this.api
      ? await invokeBrowser<NativeWindowLike[]>(this.api.windows, "getAll", { populate: true })
      : [];
    const entries = Array.isArray(windows) ? windows : [];
    return {
      windows: entries.filter(isManagedNativeWindow),
      privateWindowIds: new Set(entries.flatMap((window) => window.incognito === true && window.id !== undefined ? [window.id] : []))
    };
  }

  private async getNativeTabs(window: ManagedNativeWindow): Promise<NativeTabLike[]> {
    const tabs = window.tabs ?? (this.api
      ? await invokeBrowser<NativeTabLike[]>(this.api.tabs, "query", { windowId: window.id })
      : []);
    return Array.isArray(tabs) ? tabs.filter((tab) => isTabInNativeWindow(tab, window.id)) : [];
  }

  private async getNativeGroups(windowId: number, tabs: NativeTabLike[]): Promise<NativeGroup[]> {
    const occupiedGroupIds = new Set<number>();
    const firstTabIndex = new Map<number, number>();
    for (const tab of tabs) {
      const groupId = browserTabGroupId(tab);
      if (groupId !== undefined) {
        occupiedGroupIds.add(groupId);
        const index = Number.isInteger(tab.index) ? tab.index as number : Number.MAX_SAFE_INTEGER;
        firstTabIndex.set(groupId, Math.min(firstTabIndex.get(groupId) ?? Number.MAX_SAFE_INTEGER, index));
      }
    }
    const compareGroupPosition = (left: number, right: number) =>
      (firstTabIndex.get(left) ?? Number.MAX_SAFE_INTEGER) - (firstTabIndex.get(right) ?? Number.MAX_SAFE_INTEGER)
      || left - right;
    if (this.api?.tabGroups?.query) {
      try {
        const groups = await invokeBrowser<NativeGroupLike[]>(this.api.tabGroups, "query", { windowId });
        if (Array.isArray(groups)) {
          // tabGroups.query can briefly retain a group after its final tab was
          // moved. Only groups backed by the current tab snapshot are real
          // workspaces; otherwise synchronization recreates a ghost workspace.
          const groupsById = new Map<number, NativeGroup>();
          for (const group of groups) {
            const id = nativeGroupId(group.id);
            if (group.windowId === windowId && id !== undefined && occupiedGroupIds.has(id)) {
              groupsById.set(id, { ...group, id });
            }
          }
          return [...groupsById.values()].sort((left, right) => compareGroupPosition(left.id, right.id));
        }
      } catch {
        // The tabGroups permission is optional in a few Chromium variants.
      }
    }
    return [...occupiedGroupIds].sort(compareGroupPosition).map((id) => ({ id, windowId }));
  }

  private resolveTargetWindow(windowId?: number, windowKey?: string): WindowState | undefined {
    if (windowId !== undefined) return this.state.windows.find((window) => window.nativeId === windowId);
    if (windowKey !== undefined) return this.state.windows.find((window) => window.key === windowKey);
    return this.state.windows.find((window) => window.isCurrent) ?? this.state.windows[0];
  }

  private eligibleNativeTabIds(tabIds: string[]): string[] {
    return [...new Set(tabIds)].filter((id) => {
      const tab = this.state.tabs.find((item) => item.id === id);
      return tab?.kind === "normal" && this.toNativeId(id) !== undefined;
    });
  }

  private async moveTabsToWorkspace(tabIds: readonly string[], workspaceId: string, rollback?: NativeRollbackScope): Promise<string[]> {
    const workspace = this.state.workspaces.find((item) => item.id === workspaceId);
    if (!workspace) throw new Error(tr("error.workspaceNotFound"));
    const targetWindow = this.state.windows.find((item) => item.key === workspace.windowKey);
    if (!targetWindow) throw new Error(tr("error.workspaceWindowClosed"));
    const moved: string[] = [];
    for (const tabId of tabIds) {
      const nativeId = this.toNativeId(tabId);
      if (nativeId === undefined) continue;
      try {
        const record = this.state.tabs.find((tab) => tab.id === tabId);
        if (record?.pinned && this.api) {
          await invokeBrowser(this.api.tabs, "update", nativeId, { pinned: false });
        }
        await this.moveNativeTabToWindow(nativeId, targetWindow.nativeId);
        moved.push(tabId);
      } catch {
        if (rollback) throw new Error(tr("error.moveTabFailed", { id: tabId }));
        // Manual operations may continue when one stale/closed tab disappears.
      }
    }
    const nativeIds = moved.map((id) => this.toNativeId(id)).filter((id): id is number => id !== undefined);
    if (nativeIds.length > 0 && this.api) {
      await this.createOrUseNativeGroup(nativeIds.map(String), targetWindow.nativeId, workspace, rollback);
    }
    for (const tabId of moved) {
      const tab = this.state.tabs.find((item) => item.id === tabId);
      if (tab) {
        tab.workspaceId = workspaceId;
        tab.windowKey = targetWindow.key;
        if (tab.pinned || tab.kind === "fixed") {
          tab.pinned = false;
          tab.kind = "normal";
        }
        tab.groupId = workspace.groupId;
      }
    }
    if (moved.length) this.markChanged();
    return moved;
  }

  private async moveTabsToUnclassified(
    tabIds: string[],
    targetWindowId?: number,
    targetWindowKey?: string,
    strict = false
  ): Promise<string[]> {
    const targetWindow = targetWindowId !== undefined || targetWindowKey !== undefined
      ? this.resolveTargetWindow(targetWindowId, targetWindowKey)
      : undefined;
    const moved: string[] = [];
    for (const tabId of tabIds) {
      const nativeId = this.toNativeId(tabId);
      if (nativeId === undefined) continue;
      try {
        if (targetWindow) await this.moveNativeTabToWindow(nativeId, targetWindow.nativeId);
        if (this.api) await this.ungroupNativeTabs([tabId]);
        moved.push(tabId);
      } catch {
        if (strict) throw new Error(tr("error.unclassifyTabFailed", { id: tabId }));
        // See moveTabsToWorkspace: browser events can make an ID stale.
      }
    }
    for (const tabId of moved) {
      const tab = this.state.tabs.find((item) => item.id === tabId);
      if (tab) {
        tab.workspaceId = null;
        if (targetWindow) tab.windowKey = targetWindow.key;
        tab.groupId = undefined;
      }
    }
    if (moved.length) this.markChanged();
    return moved;
  }

  private async moveTabsToWindow(tabIds: string[], targetWindowId: number): Promise<string[]> {
    const moved: string[] = [];
    for (const tabId of tabIds) {
      const nativeId = this.toNativeId(tabId);
      if (nativeId === undefined) continue;
      try {
        await this.moveNativeTabToWindow(nativeId, targetWindowId);
        if (this.api) await this.ungroupNativeTabs([tabId]);
        moved.push(tabId);
      } catch {
        // Keep successful moves when another tab has disappeared.
      }
    }
    const targetWindow = this.state.windows.find((window) => window.nativeId === targetWindowId);
    for (const tabId of moved) {
      const tab = this.state.tabs.find((item) => item.id === tabId);
      if (tab) {
        tab.workspaceId = null;
        if (targetWindow) tab.windowKey = targetWindow.key;
        tab.groupId = undefined;
      }
    }
    if (moved.length) this.markChanged();
    return moved;
  }

  private async moveNativeTabsToWindow(tabIds: string[], targetWindowId: number): Promise<void> {
    for (const tabId of tabIds) {
      const nativeId = this.toNativeId(tabId);
      if (nativeId !== undefined) await this.moveNativeTabToWindow(nativeId, targetWindowId);
    }
  }

  private async moveNativeTabToWindow(nativeTabId: number, targetWindowId: number, index = -1): Promise<void> {
    if (!this.api) return;
    await invokeBrowser(this.api.tabs, "move", nativeTabId, { windowId: targetWindowId, index });
  }

  private async createOrUseNativeGroup(
    tabIds: string[],
    targetWindowId: number,
    workspace: Workspace,
    rollback?: NativeRollbackScope
  ): Promise<number> {
    if (!this.api) throw new Error(translate(getAppLanguage(), "browser.unavailable"));
    const nativeIds = tabIds.map((id) => this.toNativeId(id)).filter((id): id is number => id !== undefined);
    if (nativeIds.length === 0) throw new Error(tr("browser.normalTabRequired"));
    let groupId: number | undefined = workspace.groupId;
    if (groupId !== undefined) {
      try {
        await invokeBrowser(this.api.tabs, "group", { tabIds: nativeIds, groupId });
        return groupId;
      } catch {
        groupId = undefined;
      }
    }
    if (groupId === undefined) {
      const created = await invokeBrowser<number>(this.api.tabs, "group", {
        tabIds: nativeIds,
        createProperties: { windowId: targetWindowId }
      });
      groupId = Number(created);
    }
    if (!Number.isInteger(groupId) || groupId < 0) throw new Error(tr("browser.invalidGroupId"));
    workspace.groupId = groupId;
    rollback?.createdGroups.set(groupId, workspace.id);
    if (this.api.tabGroups?.update) {
      await invokeBrowser(this.api.tabGroups, "update", groupId, {
        title: workspace.name,
        color: normalizeGroupColor(workspace.color)
      });
    }
    return groupId;
  }

  private async ungroupNativeTabs(tabIds: string[]): Promise<void> {
    if (!this.api || tabIds.length === 0) return;
    const nativeIds = tabIds.map((id) => this.toNativeId(id)).filter((id): id is number => id !== undefined);
    if (nativeIds.length === 0) return;
    await invokeBrowser(this.api.tabs, "ungroup", nativeIds);
  }

  private toNativeId(tabId: string): number | undefined {
    const id = Number(tabId);
    return Number.isInteger(id) && id >= 0 ? id : undefined;
  }

  private newLocalWorkspaceId(windowKey: string): string {
    const base = `${windowKey}:local`;
    let candidate = `${base}:${this.now()}`;
    let suffix = 1;
    while (this.state.workspaces.some((workspace) => workspace.id === candidate)) {
      candidate = `${base}:${this.now()}:${suffix++}`;
    }
    return candidate;
  }

  private nextWorkspaceOrder(windowKey: string): number {
    const orders = this.state.workspaces
      .filter((workspace) => workspace.windowKey === windowKey)
      .map((workspace) => workspace.order);
    return orders.length > 0 ? Math.max(...orders) + 1 : 0;
  }

  private markChanged(): void {
    this.state = normalizeSnapshot(this.state);
    this.notify();
    this.saver.schedule();
  }

  private replaceState(state: StateSnapshot): void {
    this.state = normalizeSnapshot(state);
    this.notify();
    this.saver.schedule();
  }

  private notify(): void {
    const snapshot = this.getState();
    for (const listener of this.listeners) listener(snapshot);
  }
}

function isManagedNativeWindow(window: NativeWindowLike | undefined): window is ManagedNativeWindow {
  return window?.id !== undefined && window.incognito !== true && (!window.type || window.type === "normal");
}

function isTabInNativeWindow(tab: NativeTabLike, windowId: number): boolean {
  return tab.incognito !== true && (tab.windowId === undefined || tab.windowId === windowId);
}

function tryGetBrowserApi(): BrowserLike | undefined {
  try {
    return getBrowserApi();
  } catch {
    return undefined;
  }
}

function cloneSnapshot(snapshot: StateSnapshot): StateSnapshot {
  return {
    windows: snapshot.windows.map((window) => ({ ...window })),
    workspaces: snapshot.workspaces.map((workspace) => ({ ...workspace, tags: [...workspace.tags] })),
    tabs: snapshot.tabs.map((tab) => ({ ...tab }))
  };
}

function normalizeSnapshot(snapshot: StateSnapshot): StateSnapshot {
  return {
    windows: [...snapshot.windows].sort(compareWindow).map((window) => ({ ...window })),
    workspaces: [...snapshot.workspaces].sort(compareWorkspace).map((workspace) => ({
      ...workspace,
      tags: [...workspace.tags]
    })),
    tabs: [...snapshot.tabs].sort(compareTab).map((tab) => ({ ...tab }))
  };
}
