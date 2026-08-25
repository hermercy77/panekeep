/**
 * Values shared by the browser state engine and the UI.  The browser is the
 * source of truth for which tabs exist; these constants describe how that
 * browser state is represented in the local model.
 */

export const PANEKEEP_PRODUCT = "panekeep" as const;
export const LEGACY_TAB_FRIDGE_PRODUCT = "tab-fridge" as const;
export const BACKUP_SCHEMA_VERSION = 1 as const;
export const STORAGE_DEBOUNCE_MS = 250;

export const WINDOW_KEY_PREFIX = "window:";
export const WORKSPACE_KEY_PREFIX = "workspace:";

/** A tab with no native group is represented by a null workspaceId. */
export const UNCLASSIFIED_WORKSPACE_ID = null;

/**
 * These URLs are controlled by the browser or extension, so Chrome/Edge will
 * not allow them to be moved or placed in a user tab group.
 */
const SPECIAL_SCHEMES = new Set([
  "about:",
  "chrome:",
  "chrome-extension:",
  "devtools:",
  "edge:",
  "moz-extension:",
  "view-source:"
]);

export function createWindowKey(nativeId: number): string {
  return `${WINDOW_KEY_PREFIX}${nativeId}`;
}

export function createWorkspaceId(nativeWindowId: number, nativeGroupId: number): string {
  return `${WORKSPACE_KEY_PREFIX}${nativeWindowId}:${nativeGroupId}`;
}

export function specialPageReason(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const lowerUrl = url.trim().toLowerCase();
  for (const scheme of SPECIAL_SCHEMES) {
    if (lowerUrl.startsWith(scheme)) return scheme.slice(0, -1);
  }
  return undefined;
}

export function isSpecialPageUrl(url: string | undefined): boolean {
  return specialPageReason(url) !== undefined;
}

export function nativeGroupId(groupId: number | undefined): number | undefined {
  return typeof groupId === "number" && Number.isInteger(groupId) && groupId >= 0
    ? groupId
    : undefined;
}

export function normalizeGroupColor(color: unknown): string {
  const value = typeof color === "string" ? color.trim().toLowerCase() : "";
  const aliases: Record<string, string> = {
    slate: "grey",
    amber: "yellow",
    rose: "pink",
    violet: "purple"
  };
  const normalized = aliases[value] ?? value;
  return new Set(["grey", "blue", "cyan", "green", "orange", "pink", "purple", "red", "yellow"]).has(normalized)
    ? normalized
    : "grey";
}
