import type { Backup, OrganizationMode, TabRecord, Workspace } from "./contracts";

export const MESSAGE_TYPES = {
  getState: "tab-fridge/get-state",
  refresh: "tab-fridge/refresh",
  exportBackup: "tab-fridge/export-backup",
  importBackup: "tab-fridge/import-backup",
  createWorkspace: "tab-fridge/create-workspace",
  updateWorkspace: "tab-fridge/update-workspace",
  deleteWorkspace: "tab-fridge/delete-workspace",
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
      tabIds?: string[];
    }
  | {
      type: typeof MESSAGE_TYPES.updateWorkspace;
      workspaceId: string;
      patch: Partial<Pick<Workspace, "name" | "description" | "tags" | "color" | "order">>;
    }
  | { type: typeof MESSAGE_TYPES.deleteWorkspace; workspaceId: string }
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

export function isOrganizationMode(value: unknown): value is OrganizationMode {
  return value === "purpose" || value === "type";
}

