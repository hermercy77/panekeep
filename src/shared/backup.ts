import { backupSchema, type Backup, type TabRecord, type WindowState, type Workspace } from "./contracts";
import { BACKUP_SCHEMA_VERSION, TAB_FRIDGE_PRODUCT } from "./constants";

export interface StateSnapshot {
  windows: WindowState[];
  workspaces: Workspace[];
  tabs: TabRecord[];
}

export function createBackup(
  snapshot: StateSnapshot,
  browserFamily = detectBrowserFamily(),
  exportedAt = new Date().toISOString()
): Backup {
  return backupSchema.parse({
    schemaVersion: BACKUP_SCHEMA_VERSION,
    product: TAB_FRIDGE_PRODUCT,
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
    } catch (error) {
      throw new Error(`Invalid Tab Fridge backup JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const parsed = backupSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(`Invalid Tab Fridge backup: ${parsed.error.message}`);
  }
  return parsed.data;
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

