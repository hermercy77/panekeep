import type {
  TabRecord,
  TabKind,
  WindowState,
  Workspace
} from "../shared/contracts";
import type { BackgroundRequest, BrowserStateResponse, MoveTabsResponse } from "../shared/messages";
import {
  createWindowKey,
  createWorkspaceId,
  nativeGroupId,
  normalizeGroupColor,
  specialPageReason,
  STORAGE_DEBOUNCE_MS
} from "../shared/constants";
import { createBackup, parseBackup, stringifyBackup, type StateSnapshot } from "../shared/backup";
import { addBrowserListener, getBrowserApi, invokeBrowser, type BrowserEvent, type BrowserLike } from "./api";
import { browserTabGroupId, classifyBrowserTab } from "./classify";
import { DebouncedSaver } from "../storage/debouncedSaver";
import { DexieStateRepository, type StateRepository } from "../storage/repository";
import { loadAIConfig } from "../ai/config";
import { organizeTabs } from "../ai/pipeline";
import { organizationPreviewSchema } from "../shared/contracts";

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
  tabIds?: string[];
}

export interface WorkspacePatch {
  name?: string;
  description?: string;
  tags?: string[];
  color?: string;
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
  focused?: boolean;
  tabs?: NativeTabLike[];
}

interface NativeTabLike {
  id?: number;
  windowId?: number;
  groupId?: number;
  index?: number;
  pinned?: boolean;
  active?: boolean;
  url?: string;
  title?: string;
  favIconUrl?: string;
}

interface NativeGroupLike {
  id?: number;
  windowId?: number;
  title?: string | null;
  color?: string;
  collapsed?: boolean;
}

type StateListener = (state: StateSnapshot) => void;

const EMPTY_STATE: StateSnapshot = { windows: [], workspaces: [], tabs: [] };

/**
 * Synchronizes Chromium windows, tabs and native tab groups into the local
 * Tab Fridge model. Browser state is authoritative for membership; IndexedDB
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
  private readonly removeListeners: Array<() => void> = [];
  private syncTimer: ReturnType<typeof setTimeout> | undefined;
  private cleanupTimer: ReturnType<typeof setTimeout> | undefined;
  private syncing = false;
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
    this.state = normalizeSnapshot(await this.repository.load());
    this.notify();
    if (this.api) {
      await this.syncFromBrowser();
      this.registerBrowserEvents();
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    if (this.syncTimer !== undefined) clearTimeout(this.syncTimer);
    if (this.cleanupTimer !== undefined) clearTimeout(this.cleanupTimer);
    this.syncTimer = undefined;
    this.cleanupTimer = undefined;
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
    if (!this.api) return this.getState();
    if (this.syncing) {
      this.syncAgain = true;
      return this.getState();
    }

    this.syncing = true;
    try {
      do {
        this.syncAgain = false;
        await this.performSync();
      } while (this.syncAgain);
    } finally {
      this.syncing = false;
    }
    return this.getState();
  }

  async createWorkspace(input: WorkspaceInput): Promise<Workspace> {
    const targetWindow = this.resolveTargetWindow(input.windowId, input.windowKey);
    if (!targetWindow) throw new Error("A target browser window is required to create a workspace");
    const name = input.name.trim();
    if (!name) throw new Error("Workspace name cannot be empty");

    const workspace: Workspace = {
      id: this.newLocalWorkspaceId(targetWindow.key),
      windowKey: targetWindow.key,
      name,
      description: input.description ?? "",
      tags: [...(input.tags ?? [])],
      color: normalizeGroupColor(input.color),
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
    if (this.api) await this.syncFromBrowser();
    return this.state.workspaces.find((item) => item.id === workspace.id) ?? workspace;
  }

  async updateWorkspace(workspaceId: string, patch: WorkspacePatch): Promise<Workspace> {
    const workspace = this.state.workspaces.find((item) => item.id === workspaceId);
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);
    const nextName = patch.name === undefined ? workspace.name : patch.name.trim();
    if (!nextName) throw new Error("Workspace name cannot be empty");

    if (this.api && workspace.groupId !== undefined && this.api.tabGroups?.update) {
      await invokeBrowser(this.api.tabGroups, "update", workspace.groupId, {
        title: nextName,
        color: normalizeGroupColor(patch.color ?? workspace.color)
      });
    }

    Object.assign(workspace, {
      ...patch,
      name: nextName,
      color: normalizeGroupColor(patch.color ?? workspace.color),
      tags: patch.tags ? [...patch.tags] : workspace.tags,
      updatedAt: this.now()
    });
    this.state.workspaces.sort(compareWorkspace);
    this.markChanged();
    return { ...workspace, tags: [...workspace.tags] };
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    const workspace = this.state.workspaces.find((item) => item.id === workspaceId);
    if (!workspace) return;
    const tabIds = this.state.tabs
      .filter((tab) => tab.workspaceId === workspaceId && tab.kind === "normal")
      .map((tab) => tab.id);
    if (this.api && tabIds.length > 0) await this.ungroupNativeTabs(tabIds);
    this.state.workspaces = this.state.workspaces.filter((item) => item.id !== workspaceId);
    for (const tab of this.state.tabs) {
      if (tab.workspaceId === workspaceId) tab.workspaceId = null;
    }
    this.markChanged();
    if (this.api) await this.syncFromBrowser();
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
    const eligible = requested.filter((id) => {
      const tab = this.state.tabs.find((item) => item.id === id);
      const allowed = options.workspaceId === null ? tab?.kind === "normal" : (tab?.kind === "normal" || tab?.kind === "fixed");
      return allowed && this.toNativeId(id) !== undefined;
    });
    const skippedTabIds = requested.filter((id) => !eligible.includes(id));
    let movedTabIds: string[] = [];

    if (options.workspaceId !== undefined) {
      if (options.workspaceId === null) {
        movedTabIds = await this.moveTabsToUnclassified(eligible, options.windowId, options.windowKey);
      } else {
        movedTabIds = await this.moveTabsToWorkspace(eligible, options.workspaceId);
      }
    } else if (options.windowId !== undefined || options.windowKey !== undefined) {
      const targetWindow = this.resolveTargetWindow(options.windowId, options.windowKey);
      if (!targetWindow) throw new Error("Target browser window not found");
      movedTabIds = await this.moveTabsToWindow(eligible, targetWindow.nativeId);
    } else {
      throw new Error("A workspaceId or target window is required");
    }

    if (this.api) {
      await this.closeEmptyWindowsAfterMutation();
      await this.syncFromBrowser();
    }
    return { ...this.getState(), movedTabIds, skippedTabIds };
  }

  async closeEmptyWindows(): Promise<{ closedWindowIds: number[] }> {
    const closedWindowIds = await this.closeEmptyNativeWindows();
    if (closedWindowIds.length > 0) await this.syncFromBrowser();
    return { closedWindowIds };
  }

  async activateTab(tabId: string): Promise<void> {
    const tab = this.state.tabs.find((item) => item.id === tabId);
    const nativeId = this.toNativeId(tabId);
    if (!tab || nativeId === undefined) throw new Error("Tab not found");
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
    const siblings = this.state.workspaces
      .filter((workspace) => workspace.windowKey === source.windowKey && workspace.id !== workspaceId)
      .sort(compareWorkspace);
    const beforeIndex = beforeWorkspaceId
      ? siblings.findIndex((workspace) => workspace.id === beforeWorkspaceId)
      : siblings.length;
    const insertAt = beforeIndex < 0 ? siblings.length : beforeIndex;
    siblings.splice(insertAt, 0, source);
    siblings.forEach((workspace, index) => {
      workspace.order = index;
      workspace.updatedAt = this.now();
    });

    if (this.api && source.groupId !== undefined && this.api.tabGroups?.move) {
      const before = beforeWorkspaceId
        ? this.state.workspaces.find((workspace) => workspace.id === beforeWorkspaceId)
        : undefined;
      const beforeTab = before
        ? this.state.tabs.find((tab) => tab.workspaceId === before.id && tab.kind === "normal")
        : undefined;
      try {
        await invokeBrowser(this.api.tabGroups, "move", source.groupId, {
          index: beforeTab?.index ?? -1
        });
      } catch {
        // Local ordering remains valid on browsers without tab-group moving.
      }
    }
    this.markChanged();
  }

  async exportBackup(asJson = false): Promise<ReturnType<typeof createBackup> | string> {
    const backup = createBackup(this.state);
    return asJson ? stringifyBackup(backup) : backup;
  }

  async importBackup(value: unknown): Promise<ReturnType<typeof createBackup>> {
    const backup = parseBackup(value);
    if (this.api) {
      const beforeState = this.getState();
      const createdNativeWindowIds: number[] = [];
      try {
      const usedNames = new Set(this.state.workspaces.map((workspace) => workspace.name));
      const uniqueName = (base: string): string => {
        const clean = base.trim() || "导入工作区";
        if (!usedNames.has(clean)) {
          usedNames.add(clean);
          return clean;
        }
        let suffix = 1;
        let candidate = `${clean}（副本）`;
        while (usedNames.has(candidate)) candidate = `${clean}（${suffix++}）`;
        usedNames.add(candidate);
        return candidate;
      };
      const importedGroups: Array<{
        nativeWindowId: number;
        sourceWindowKey: string;
        sourceWorkspaceId: string;
        name: string;
        description: string;
        tags: string[];
        color: string;
        order: number;
        groupId: number;
      }> = [];
      const importedWindows: Array<{ source: WindowState; nativeId: number }> = [];

      for (const sourceWindow of [...backup.windows].sort((left, right) => left.order - right.order)) {
        const sourceTabs = backup.tabs
          .filter((tab) => tab.windowKey === sourceWindow.key && tab.kind !== "special")
          .sort((left, right) => left.index - right.index);
        const urls = sourceTabs.map((tab) => tab.url || "about:blank");
        const created = await invokeBrowser<NativeWindowLike>(this.api.windows, "create", {
          url: urls.length ? urls : ["about:blank"],
          focused: false
        });
        if (!created?.id) continue;
        createdNativeWindowIds.push(created.id);
        importedWindows.push({ source: sourceWindow, nativeId: created.id });
        const nativeTabs = (Array.isArray(created.tabs) ? created.tabs : await this.getNativeTabs(created.id))
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
        const sourceWorkspaces = backup.workspaces
          .filter((workspace) => workspace.windowKey === sourceWindow.key)
          .sort((left, right) => left.order - right.order);
        for (const sourceWorkspace of sourceWorkspaces) {
          const nativeIds = backup.tabs
            .filter((tab) => tab.workspaceId === sourceWorkspace.id && tabMap.has(tab.id))
            .map((tab) => tabMap.get(tab.id) as number);
          if (!nativeIds.length) continue;
          const groupId = await invokeBrowser<number>(this.api.tabs, "group", {
            tabIds: nativeIds,
            createProperties: { windowId: created.id }
          });
          const name = uniqueName(sourceWorkspace.name);
          try {
            await invokeBrowser(this.api.tabGroups, "update", groupId, {
              title: name,
              color: normalizeGroupColor(sourceWorkspace.color)
            });
          } catch { /* group metadata is restored during reconciliation */ }
          importedGroups.push({
            nativeWindowId: created.id,
            sourceWindowKey: sourceWindow.key,
            sourceWorkspaceId: sourceWorkspace.id,
            name,
            description: sourceWorkspace.description,
            tags: [...sourceWorkspace.tags],
            color: normalizeGroupColor(sourceWorkspace.color),
            order: sourceWorkspace.order,
            groupId
          });
        }
      }

      await this.syncFromBrowser();
      for (const importedWindow of importedWindows) {
        const targetWindow = this.state.windows.find((window) => window.nativeId === importedWindow.nativeId);
        if (targetWindow) targetWindow.name = importedWindow.source.name;
      }
      for (const importedGroup of importedGroups) {
        const targetWindow = this.state.windows.find((window) => window.nativeId === importedGroup.nativeWindowId);
        const targetWorkspace = targetWindow
          ? this.state.workspaces.find((workspace) => workspace.windowKey === targetWindow.key && workspace.groupId === importedGroup.groupId)
          : undefined;
        if (targetWorkspace) {
          Object.assign(targetWorkspace, {
            name: importedGroup.name,
            description: importedGroup.description,
            tags: [...importedGroup.tags],
            color: importedGroup.color,
            order: importedGroup.order,
            updatedAt: this.now()
          });
        }
      }
      this.markChanged();
      await this.saver.flush();
      return backup;
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
    return backup;
  }

  async handleRequest(request: BackgroundRequest): Promise<unknown> {
    switch (request.type) {
      case "tab-fridge/get-state":
        return this.getState();
      case "tab-fridge/refresh":
        return this.syncFromBrowser();
      case "tab-fridge/export-backup":
        return { backup: await this.exportBackup(false), json: request.asJson ? await this.exportBackup(true) : undefined };
      case "tab-fridge/import-backup":
        return this.importBackup(request.backup);
      case "tab-fridge/create-workspace":
        return this.createWorkspace(request);
      case "tab-fridge/update-workspace":
        return this.updateWorkspace(request.workspaceId, request.patch);
      case "tab-fridge/delete-workspace":
        return this.deleteWorkspace(request.workspaceId);
      case "tab-fridge/move-tabs":
        return this.moveTabs(request);
      case "tab-fridge/ungroup-tabs":
        return this.ungroupTabs(request.tabIds);
      case "tab-fridge/close-empty-windows":
        return this.closeEmptyWindows();
      default:
        throw new Error(`Unknown Tab Fridge request: ${(request as { type: string }).type}`);
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
          tabIds: payload.tabIds
        });
        break;
      case "workspace.update":
        result = await this.updateWorkspace(String(payload.id), payload.draft ?? {});
        break;
      case "workspace.delete":
        result = await this.deleteWorkspace(String(payload.id));
        break;
      case "workspace.move":
        result = await this.moveWorkspace(String(payload.workspaceId), payload.beforeWorkspaceId);
        break;
      case "tab.move":
        result = await this.moveTabs({
          tabIds: [String(payload.tabId)],
          workspaceId: payload.workspaceId === undefined ? null : payload.workspaceId
        });
        break;
      case "tab.activate":
        result = await this.activateTab(String(payload.tabId));
        break;
      // Organization is intentionally owned by the AI/provider layer. An
      // undefined response lets the UI adapter use its local preview fallback.
      case "organization.preview":
        return this.organizationPreview(payload);
      case "organization.apply":
        return this.applyOrganizationPreview(payload);
      case "backup.export":
        return { json: await this.exportBackup(true) };
      case "backup.import":
        await this.importBackup(String(payload.json ?? ""));
        return this.getState();
      default:
        return undefined;
    }
    return { ok: true, result, snapshot: this.getState() };
  }

  private async organizationPreview(payload: Record<string, unknown>): Promise<unknown> {
    const mode = payload.mode === "type" ? "type" : "purpose";
    const configuredIds = Array.isArray(payload.tabIds)
      ? payload.tabIds.filter((id): id is string => typeof id === "string")
      : [];
    const eligible = this.state.tabs.filter((tab) =>
      (tab.kind === "normal" || tab.kind === "fixed")
      && (configuredIds.length ? configuredIds.includes(tab.id) : (tab.workspaceId === null && !tab.pinned))
    );
    if (!eligible.length) throw new Error("没有可整理的标签");
    const config = await loadAIConfig();
    if (!config.apiKey || !config.model) throw new Error("请先在管理页配置 AI API、Key 和模型");
    return organizeTabs({
      tabs: eligible,
      mode,
      config,
      existingWorkspaces: this.state.workspaces,
      getCurrentTabs: () => this.state.tabs.filter((tab) => eligible.some((item) => item.id === tab.id))
    });
  }

  private async applyOrganizationPreview(payload: Record<string, unknown>): Promise<unknown> {
    const parsed = organizationPreviewSchema.parse(payload.preview);
    const beforeState = this.getState();
    const sourceIds = new Set(parsed.sourceTabIds);
    if (sourceIds.size !== parsed.sourceTabIds.length || sourceIds.size === 0) {
      throw new Error("AI 整理预览的来源标签无效");
    }
    const currentSourceTabs = this.state.tabs.filter((tab) => sourceIds.has(tab.id));
    if (currentSourceTabs.length !== sourceIds.size || currentSourceTabs.some((tab) => tab.kind === "special")) {
      throw new Error("浏览器状态已变化，请重新整理");
    }
    const assignedIds: string[] = [];
    for (const group of parsed.groups) assignedIds.push(...group.tabIds);
    assignedIds.push(...parsed.unclassifiedTabIds);
    if (assignedIds.length !== sourceIds.size || new Set(assignedIds).size !== sourceIds.size || assignedIds.some((id) => !sourceIds.has(id))) {
      throw new Error("AI 整理预览没有完整覆盖本次选中的标签");
    }
    const targetWindowKey = typeof payload.targetWindowKey === "string"
      ? payload.targetWindowKey
      : this.state.windows.find((window) => window.isCurrent)?.key ?? this.state.windows[0]?.key;
    if (!targetWindowKey) throw new Error("找不到目标窗口");
    const existingIds = new Set(this.state.workspaces.map((workspace) => workspace.id));
    for (const group of parsed.groups) {
      if (group.existingWorkspaceId && !existingIds.has(group.existingWorkspaceId)) {
        throw new Error(`AI 结果引用了不存在的工作区: ${group.existingWorkspaceId}`);
      }
    }
    try {
      const workspaceByGroup = new Map<string, string>();
      for (const group of parsed.groups) {
        let workspaceId = group.existingWorkspaceId;
        if (!workspaceId) {
          // Cross-window selections intentionally consolidate into the window
          // currently being operated from, as defined by the product contract.
          const created = await this.createWorkspace({
            windowKey: targetWindowKey,
            name: group.name,
            description: group.description,
            tags: group.tags,
            color: "grey"
          });
          workspaceId = created.id;
        }
        workspaceByGroup.set(group.id, workspaceId);
      }
      for (const group of parsed.groups) {
        const workspaceId = workspaceByGroup.get(group.id);
        if (!workspaceId) throw new Error("AI 结果缺少目标工作区");
        await this.moveTabsToWorkspace(group.tabIds, workspaceId, true);
      }
      if (parsed.unclassifiedTabIds.length) {
        await this.moveTabsToUnclassified(parsed.unclassifiedTabIds, this.resolveTargetWindow(undefined, targetWindowKey)?.nativeId, targetWindowKey, true);
      }
      await this.closeEmptyWindowsAfterMutation();
      await this.syncFromBrowser();
      return this.getState();
    } catch (error) {
      await this.rollbackNativeState(beforeState);
      throw error;
    }
  }

  private async rollbackNativeState(before: StateSnapshot): Promise<void> {
    if (!this.api) {
      this.state = normalizeSnapshot(before);
      this.notify();
      return;
    }
    try {
      const groups = new Map<number, string[]>();
      for (const tab of before.tabs.filter((item) => item.kind !== "special")) {
        const nativeId = this.toNativeId(tab.id);
        const targetWindow = before.windows.find((window) => window.key === tab.windowKey);
        if (nativeId === undefined || !targetWindow) continue;
        await this.moveNativeTabToWindow(nativeId, targetWindow.nativeId);
        if (tab.pinned) {
          try { await invokeBrowser(this.api.tabs, "update", nativeId, { pinned: true }); } catch { /* best effort */ }
        }
        if (tab.groupId !== undefined) {
          const ids = groups.get(tab.groupId) ?? [];
          ids.push(String(nativeId));
          groups.set(tab.groupId, ids);
        } else {
          try { await invokeBrowser(this.api.tabs, "ungroup", [nativeId]); } catch { /* best effort */ }
        }
      }
      for (const [groupId, ids] of groups) {
        try {
          await invokeBrowser(this.api.tabs, "group", { tabIds: ids.map(Number), groupId });
        } catch {
          const workspace = before.workspaces.find((item) => item.groupId === groupId);
          const first = before.tabs.find((tab) => tab.groupId === groupId);
          const targetWindow = first ? before.windows.find((window) => window.key === first.windowKey) : undefined;
          if (workspace && targetWindow) {
            try {
              const created = await invokeBrowser<number>(this.api.tabs, "group", { tabIds: ids.map(Number), createProperties: { windowId: targetWindow.nativeId } });
              await invokeBrowser(this.api.tabGroups, "update", created, { title: workspace.name, color: normalizeGroupColor(workspace.color) });
            } catch { /* best effort */ }
          }
        }
      }
      const originalGroupIds = new Set(before.workspaces.map((workspace) => workspace.groupId).filter((id): id is number => id !== undefined));
      if (this.api.tabGroups?.query && this.api.tabGroups?.remove) {
        try {
          const currentGroups = await invokeBrowser<NativeGroupLike[]>(this.api.tabGroups, "query", {});
          for (const group of currentGroups ?? []) {
            const groupId = nativeGroupId(group.id);
            if (groupId !== undefined && !originalGroupIds.has(groupId)) {
              try { await invokeBrowser(this.api.tabGroups, "remove", groupId); } catch { /* best effort */ }
            }
          }
        } catch { /* best effort */ }
      }
    } finally {
      this.state = normalizeSnapshot(before);
      await this.saver.flush();
      this.notify();
    }
  }

  private async performSync(): Promise<void> {
    if (!this.api) return;
    const nativeWindows = await this.getNativeWindows();
    let currentWindowId: number | undefined;
    try {
      const current = await invokeBrowser<NativeWindowLike>(this.api.windows, "getCurrent");
      currentWindowId = current?.id;
    } catch {
      currentWindowId = nativeWindows.find((window) => window.focused)?.id;
    }

    const existingWindows = this.state.windows;
    const existingWorkspaces = this.state.workspaces;
    const existingTabs = this.state.tabs;
    const allowWindowOrderReconciliation = existingWindows.length === nativeWindows.length;
    const nextWindows: WindowState[] = [];
    const nextWorkspaces: Workspace[] = [];
    const nextTabs: TabRecord[] = [];

    for (const [windowIndex, nativeWindow] of nativeWindows.entries()) {
      const nativeWindowId = nativeWindow.id;
      if (nativeWindowId === undefined) continue;
      const candidateByNativeId = existingWindows.find((window) => window.nativeId === nativeWindowId);
      const candidateByOrder = allowWindowOrderReconciliation ? existingWindows[windowIndex] : undefined;
      const previousWindow = candidateByNativeId ?? candidateByOrder;
      const windowKey = previousWindow?.key ?? createWindowKey(nativeWindowId);
      nextWindows.push({
        key: windowKey,
        nativeId: nativeWindowId,
        name: previousWindow?.name || `Window ${windowIndex + 1}`,
        order: previousWindow?.order ?? windowIndex,
        isCurrent: nativeWindowId === currentWindowId,
        expanded: previousWindow?.expanded ?? false
      });

      const tabs = Array.isArray(nativeWindow.tabs)
        ? nativeWindow.tabs
        : await this.getNativeTabs(nativeWindowId);
      const groups = await this.getNativeGroups(nativeWindowId, tabs);
      const workspaceByGroup = new Map<number, Workspace>();
      for (const [groupIndex, group] of groups.entries()) {
        const groupId = nativeGroupId(group.id);
        if (groupId === undefined) continue;
        const previousWorkspace = existingWorkspaces.find(
          (workspace) => workspace.windowKey === windowKey && workspace.groupId === groupId
        ) ?? existingWorkspaces.find((workspace) =>
          workspace.windowKey === windowKey
          && workspace.name === (group.title?.trim() || "")
          && workspace.color === normalizeGroupColor(group.color)
        ) ?? existingWorkspaces.find((workspace) => workspace.windowKey === windowKey && workspace.order === groupIndex);
        const workspace: Workspace = {
          id: previousWorkspace?.id ?? createWorkspaceId(nativeWindowId, groupId),
          windowKey,
          name: previousWorkspace?.name || group.title?.trim() || `Workspace ${groupIndex + 1}`,
          description: previousWorkspace?.description ?? "",
          tags: [...(previousWorkspace?.tags ?? [])],
          color: normalizeGroupColor(group.color ?? previousWorkspace?.color),
          groupId,
          order: previousWorkspace?.order ?? groupIndex,
          createdAt: previousWorkspace?.createdAt ?? this.now(),
          updatedAt: previousWorkspace?.updatedAt ?? this.now()
        };
        workspaceByGroup.set(groupId, workspace);
        nextWorkspaces.push(workspace);
      }

      for (const [tabIndex, nativeTab] of tabs.entries()) {
        const nativeTabId = nativeTab.id;
        if (nativeTabId === undefined) continue;
        const id = String(nativeTabId);
        const previousTab = existingTabs.find((tab) => tab.id === id);
        const kind = classifyBrowserTab(nativeTab);
        const groupId = browserTabGroupId(nativeTab);
        const workspace = kind === "normal" && groupId !== undefined ? workspaceByGroup.get(groupId) : undefined;
        const lastActivatedAt = previousTab?.lastActivatedAt ?? (nativeTab.active ? this.now() : undefined);
        const record: TabRecord = {
          id,
          windowKey,
          workspaceId: workspace?.id ?? null,
          kind,
          url: nativeTab.url ?? "",
          index: Number.isInteger(nativeTab.index) && (nativeTab.index as number) >= 0
            ? (nativeTab.index as number)
            : tabIndex,
          pinned: nativeTab.pinned === true,
          ...(nativeTab.title !== undefined ? { title: nativeTab.title } : {}),
          ...(nativeTab.favIconUrl !== undefined ? { faviconUrl: nativeTab.favIconUrl } : {}),
          ...(groupId !== undefined ? { groupId } : {}),
          ...(lastActivatedAt !== undefined ? { lastActivatedAt } : {}),
          ...(kind === "special" ? { specialReason: specialPageReason(nativeTab.url) } : {})
        };
        nextTabs.push(record);
      }
    }

    // A workspace created before it contains any tabs has no native group yet.
    // Keep that local workspace while its browser window is still open; once a
    // group is created, subsequent reconciliations bind it to the native ID.
    const openWindowKeys = new Set(nextWindows.map((window) => window.key));
    for (const workspace of existingWorkspaces) {
      if (workspace.groupId === undefined && openWindowKeys.has(workspace.windowKey)) {
        if (!nextWorkspaces.some((item) => item.id === workspace.id)) {
          nextWorkspaces.push({ ...workspace, tags: [...workspace.tags] });
        }
      }
    }

    nextWindows.sort(compareWindow);
    nextWorkspaces.sort(compareWorkspace);
    nextTabs.sort(compareTab);
    this.replaceState({ windows: nextWindows, workspaces: nextWorkspaces, tabs: nextTabs });
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
    this.removeListeners.push(addBrowserListener(tabs.onUpdated as BrowserEvent | undefined, schedule));
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
    const windows = await this.getNativeWindows();
    const closedWindowIds: number[] = [];
    for (const window of windows) {
      if (window.id === undefined || (window.type && window.type !== "normal")) continue;
      if (Array.isArray(window.tabs) && window.tabs.length > 0) continue;
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

  private async getNativeWindows(): Promise<NativeWindowLike[]> {
    if (!this.api) return [];
    const windows = await invokeBrowser<NativeWindowLike[]>(this.api.windows, "getAll", { populate: true });
    return Array.isArray(windows)
      ? windows.filter((window) => window.id !== undefined && (!window.type || window.type === "normal"))
      : [];
  }

  private async getNativeTabs(windowId: number): Promise<NativeTabLike[]> {
    if (!this.api) return [];
    const tabs = await invokeBrowser<NativeTabLike[]>(this.api.tabs, "query", { windowId });
    return Array.isArray(tabs) ? tabs : [];
  }

  private async getNativeGroups(windowId: number, tabs: NativeTabLike[]): Promise<NativeGroupLike[]> {
    const groupIds = new Set<number>();
    for (const tab of tabs) {
      const groupId = browserTabGroupId(tab);
      if (groupId !== undefined) groupIds.add(groupId);
    }
    if (this.api?.tabGroups?.query) {
      try {
        const groups = await invokeBrowser<NativeGroupLike[]>(this.api.tabGroups, "query", { windowId });
        if (Array.isArray(groups)) {
          for (const group of groups) {
            if (nativeGroupId(group.id) !== undefined) groupIds.add(group.id as number);
          }
          return groups
            .filter((group) => nativeGroupId(group.id) !== undefined)
            .sort((left, right) => (left.id as number) - (right.id as number));
        }
      } catch {
        // The tabGroups permission is optional in a few Chromium variants.
      }
    }
    return [...groupIds].sort((left, right) => left - right).map((id) => ({ id, windowId }));
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

  private async moveTabsToWorkspace(tabIds: string[], workspaceId: string, strict = false): Promise<string[]> {
    const workspace = this.state.workspaces.find((item) => item.id === workspaceId);
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);
    const targetWindow = this.state.windows.find((item) => item.key === workspace.windowKey);
    if (!targetWindow) throw new Error("Workspace's browser window is not open");
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
        if (strict) throw new Error(`无法移动标签 ${tabId}`);
        // Manual operations may continue when one stale/closed tab disappears.
      }
    }
    const nativeIds = moved.map((id) => this.toNativeId(id)).filter((id): id is number => id !== undefined);
    if (nativeIds.length > 0 && this.api) {
      await this.createOrUseNativeGroup(nativeIds.map(String), targetWindow.nativeId, workspace);
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
        if (strict) throw new Error(`无法移出标签 ${tabId}`);
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

  private async moveNativeTabToWindow(nativeTabId: number, targetWindowId: number): Promise<void> {
    if (!this.api) return;
    await invokeBrowser(this.api.tabs, "move", nativeTabId, { windowId: targetWindowId, index: -1 });
  }

  private async createOrUseNativeGroup(
    tabIds: string[],
    targetWindowId: number,
    workspace: Workspace
  ): Promise<number> {
    if (!this.api) throw new Error("Browser API is unavailable");
    const nativeIds = tabIds.map((id) => this.toNativeId(id)).filter((id): id is number => id !== undefined);
    if (nativeIds.length === 0) throw new Error("At least one normal tab is required to create a native group");
    let groupId: number | undefined = workspace.groupId;
    if (groupId !== undefined) {
      try {
        await invokeBrowser(this.api.tabs, "group", { tabIds: nativeIds, groupId });
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
    if (!Number.isInteger(groupId) || groupId < 0) throw new Error("Browser did not return a valid native group ID");
    workspace.groupId = groupId;
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

function compareWindow(left: WindowState, right: WindowState): number {
  return left.order - right.order || left.nativeId - right.nativeId;
}

function compareWorkspace(left: Workspace, right: Workspace): number {
  return left.windowKey.localeCompare(right.windowKey) || left.order - right.order || left.id.localeCompare(right.id);
}

function compareTab(left: TabRecord, right: TabRecord): number {
  return left.windowKey.localeCompare(right.windowKey) || left.index - right.index || left.id.localeCompare(right.id);
}
