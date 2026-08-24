import type { Backup, OrganizationMode, TabRecord, Workspace, WorkspaceMergePreview } from "./contracts";

export const UI_MESSAGE_SOURCE = "tab-fridge-ui" as const;
export const BACKGROUND_MESSAGE_SOURCE = "tab-fridge-background" as const;
export const STATE_UPDATED_ACTION = "state.updated" as const;

export const MESSAGE_TYPES = {
  getState: "tab-fridge/get-state",
  refresh: "tab-fridge/refresh",
  exportBackup: "tab-fridge/export-backup",
  importBackup: "tab-fridge/import-backup",
  createWorkspace: "tab-fridge/create-workspace",
  updateWorkspace: "tab-fridge/update-workspace",
  deleteWorkspace: "tab-fridge/delete-workspace",
  mergeWorkspaces: "tab-fridge/merge-workspaces",
  moveTabs: "tab-fridge/move-tabs",
  ungroupTabs: "tab-fridge/ungroup-tabs",
  closeEmptyWindows: "tab-fridge/close-empty-windows"
} as const;

export type BackgroundRequest =
  | { type: typeof MESSAGE_TYPES.getState }
  | { type: typeof MESSAGE_TYPES.refresh }
  | { type: typeof MESSAGE_TYPES.exportBackup; asJson?: boolean }
  | { type: typeof MESSAGE_TYPES.importBackup; backup: Backup | string }
  | {
      type: typeof MESSAGE_TYPES.createWorkspace;
      windowId?: number;
      windowKey?: string;
      name: string;
      description?: string;
      tags?: string[];
      color?: string;
      icon?: Workspace["icon"];
      tabIds?: string[];
    }
  | {
      type: typeof MESSAGE_TYPES.updateWorkspace;
      workspaceId: string;
      patch: Partial<Pick<Workspace, "name" | "description" | "tags" | "color" | "icon" | "order">>;
    }
  | { type: typeof MESSAGE_TYPES.deleteWorkspace; workspaceId: string }
  | { type: typeof MESSAGE_TYPES.mergeWorkspaces; preview: WorkspaceMergePreview }
  | {
      type: typeof MESSAGE_TYPES.moveTabs;
      tabIds: string[];
      workspaceId?: string | null;
      windowId?: number;
      windowKey?: string;
    }
  | { type: typeof MESSAGE_TYPES.ungroupTabs; tabIds: string[] }
  | { type: typeof MESSAGE_TYPES.closeEmptyWindows };

export interface BrowserStateResponse {
  windows: import("./contracts").WindowState[];
  workspaces: Workspace[];
  tabs: TabRecord[];
}

export interface UiActionMessage {
  source: typeof UI_MESSAGE_SOURCE;
  action: string;
  payload?: unknown;
}

export interface StateUpdatedMessage {
  source: typeof BACKGROUND_MESSAGE_SOURCE;
  action: typeof STATE_UPDATED_ACTION;
  snapshot: BrowserStateResponse;
}

export interface MoveTabsResponse extends BrowserStateResponse {
  movedTabIds: string[];
  skippedTabIds: string[];
}

export interface ExportBackupResponse {
  backup: Backup;
  json?: string;
}

export type BackgroundResponse =
  | BrowserStateResponse
  | MoveTabsResponse
  | ExportBackupResponse
  | Backup
  | Workspace
  | { closedWindowIds: number[] };

export function isBackgroundRequest(value: unknown): value is BackgroundRequest {
  return typeof value === "object" && value !== null && "type" in value;
}

export function isUiActionMessage(value: unknown): value is UiActionMessage {
  return typeof value === "object"
    && value !== null
    && (value as { source?: unknown }).source === UI_MESSAGE_SOURCE
    && typeof (value as { action?: unknown }).action === "string";
}

export function isStateUpdatedMessage(value: unknown): value is StateUpdatedMessage {
  return typeof value === "object"
    && value !== null
    && (value as { source?: unknown }).source === BACKGROUND_MESSAGE_SOURCE
    && (value as { action?: unknown }).action === STATE_UPDATED_ACTION
    && "snapshot" in value;
}

export function isOrganizationMode(value: unknown): value is OrganizationMode {
  return value === "purpose" || value === "type";
}
