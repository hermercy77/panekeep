import { backupSchema, type Backup, type TabRecord, type WindowState, type Workspace } from "./contracts";
import { BACKUP_SCHEMA_VERSION, PANEKEEP_PRODUCT } from "./constants";
import { getAppLanguage, translate } from "../i18n";

export interface StateSnapshot {
  windows: WindowState[];
  workspaces: Workspace[];
  tabs: TabRecord[];
}

export interface BackupImportSkippedTab {
  id: string;
  title?: string;
  url: string;
  reason: "browser_blocked";
}

export interface BackupImportResult {
  backup: Backup;
  skippedTabs: BackupImportSkippedTab[];
}

export function createBackup(
  snapshot: StateSnapshot,
  browserFamily = detectBrowserFamily(),
  exportedAt = new Date().toISOString()
): Backup {
  return backupSchema.parse({
    schemaVersion: BACKUP_SCHEMA_VERSION,
    product: PANEKEEP_PRODUCT,
    browserFamily,
    exportedAt,
    windows: snapshot.windows,
    workspaces: snapshot.workspaces,
    tabs: snapshot.tabs
  });
}

export function stringifyBackup(backup: Backup): string {
  return JSON.stringify(backup, null, 2);
}

export function parseBackup(value: unknown): Backup {
  let candidate: unknown = value;
  if (typeof value === "string") {
    try {
      candidate = JSON.parse(value) as unknown;
    } catch {
      throw new Error(translate(getAppLanguage(), "backup.invalidJson"));
    }
  }

  if (candidate && typeof candidate === "object" && "schemaVersion" in candidate) {
    const version = (candidate as { schemaVersion?: unknown }).schemaVersion;
    if (version !== BACKUP_SCHEMA_VERSION) {
      throw new Error(translate(getAppLanguage(), "backup.unsupportedVersion", { version: String(version) }));
    }
  }

  const parsed = backupSchema.safeParse(candidate);
  if (!parsed.success || !hasValidReferences(parsed.data)) {
    throw new Error(translate(getAppLanguage(), "backup.invalid"));
  }
  return parsed.data;
}

function hasValidReferences({ windows, workspaces, tabs }: Backup): boolean {
  const windowKeys = new Set(windows.map((window) => window.key));
  const workspaceWindows = new Map(workspaces.map((workspace) => [workspace.id, workspace.windowKey]));
  const tabIds = new Set(tabs.map((tab) => tab.id));

  return windowKeys.size === windows.length
    && workspaceWindows.size === workspaces.length
    && tabIds.size === tabs.length
    && workspaces.every((workspace) => windowKeys.has(workspace.windowKey))
    && tabs.every((tab) => windowKeys.has(tab.windowKey)
      && (tab.workspaceId === null || workspaceWindows.get(tab.workspaceId) === tab.windowKey));
}

export function detectBrowserFamily(userAgent = getUserAgent()): string {
  const lower = userAgent.toLowerCase();
  if (lower.includes("edg/")) return "edge";
  if (lower.includes("firefox/")) return "firefox";
  if (lower.includes("safari/") && !lower.includes("chrome/")) return "safari";
  if (lower.includes("chrome/") || lower.includes("chromium/")) return "chrome";
  return "unknown";
}

function getUserAgent(): string {
  if (typeof navigator === "undefined") return "";
  return navigator.userAgent;
}
