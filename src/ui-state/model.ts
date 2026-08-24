import type {
  OrganizationMode,
  OrganizationPreview,
  TabRecord,
  WindowState,
  Workspace,
  WorkspaceMergePreview
} from "../shared/contracts";
import { getAppLanguage, translate } from "../i18n";
import type { BackupImportResult } from "../shared/backup";
import type { MoveTabsResponse } from "../shared/messages";

/** The small, read-only view model consumed by both UI entrypoints. */
export interface TabFridgeSnapshot {
  windows: WindowState[];
  tabs: TabRecord[];
  workspaces: Workspace[];
}

export interface WorkspaceDraft {
  windowKey: string;
  name: string;
  description: string;
  tags: string[];
  color: string;
  icon: Workspace["icon"];
  groupId?: number;
}

export interface TabFridgeAdapter {
  getSnapshot(): Promise<TabFridgeSnapshot>;
  createWorkspace(draft: WorkspaceDraft): Promise<Workspace>;
  updateWorkspace(id: string, draft: Partial<WorkspaceDraft>): Promise<Workspace>;
  deleteWorkspace(id: string): Promise<void>;
  moveTab(tabId: string, workspaceId: string | null): Promise<void>;
  moveTabs(tabIds: string[], workspaceId: string | null, targetWindowKey?: string): Promise<MoveTabsResponse>;
  moveWorkspace(workspaceId: string, beforeWorkspaceId?: string): Promise<void>;
  previewWorkspaceMerge(sourceWorkspaceId: string, targetWorkspaceId: string): Promise<WorkspaceMergePreview>;
  mergeWorkspaces(preview: WorkspaceMergePreview): Promise<void>;
  activateTab(tabId: string): Promise<void>;
  requestOrganization(mode: OrganizationMode, tabIds?: string[]): Promise<OrganizationPreview>;
  applyOrganization(preview: OrganizationPreview): Promise<void>;
  exportBackup?: () => Promise<string>;
  importBackup?: (json: string) => Promise<BackupImportResult>;
  subscribe?(listener: (snapshot: TabFridgeSnapshot) => void): () => void;
}

export const emptySnapshot: TabFridgeSnapshot = {
  windows: [],
  tabs: [],
  workspaces: []
};

export function cloneSnapshot(snapshot: TabFridgeSnapshot): TabFridgeSnapshot {
  return {
    windows: snapshot.windows.map((window) => ({ ...window })),
    tabs: snapshot.tabs.map((tab) => ({ ...tab })),
    workspaces: snapshot.workspaces.map((workspace) => ({
      ...workspace,
      tags: [...workspace.tags]
    }))
  };
}

/**
 * Bridge responses are intentionally normalized here so UI components do not
 * depend on a storage or background implementation detail.
 */
export function normalizeSnapshot(value: unknown): TabFridgeSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<TabFridgeSnapshot>;
  if (!Array.isArray(candidate.windows) || !Array.isArray(candidate.tabs) || !Array.isArray(candidate.workspaces)) {
    return null;
  }
  return {
    windows: candidate.windows as WindowState[],
    tabs: candidate.tabs as TabRecord[],
    workspaces: candidate.workspaces as Workspace[]
  };
}

export function workspaceForTab(tab: TabRecord, workspaces: Workspace[]): Workspace | undefined {
  return tab.workspaceId ? workspaces.find((workspace) => workspace.id === tab.workspaceId) : undefined;
}

export function tabLabel(tab: TabRecord): string {
  return tab.title?.trim() || tab.url.replace(/^https?:\/\//, "").split("/")[0] || translate(getAppLanguage(), "common.unnamedTab");
}

export function tabHost(tab: TabRecord): string {
  try {
    return new URL(tab.url).hostname.replace(/^www\./, "");
  } catch {
    return tab.url;
  }
}

export function makeId(prefix: string): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  return randomUuid ? `${prefix}-${randomUuid}` : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
