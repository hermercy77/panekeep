import type { TabRecord } from "../shared/contracts";
import { AIConflictError, AIValidationError } from "./errors";
import { getAppLanguage, translate } from "../i18n";

export interface TabSnapshot {
  fingerprint: string;
  tabIds: string[];
  revision?: string | number;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, stableValue(entry)])
    );
  }
  return value;
}

export function fingerprintTabs(tabs: readonly TabRecord[]): string {
  const serializable = tabs
    .map((tab) => ({
      id: tab.id,
      windowKey: tab.windowKey,
      workspaceId: tab.workspaceId,
      kind: tab.kind,
      url: tab.url,
      title: tab.title,
      faviconUrl: tab.faviconUrl,
      index: tab.index,
      pinned: tab.pinned,
      groupId: tab.groupId,
      specialReason: tab.specialReason
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify(stableValue(serializable));
}

export function createTabSnapshot(tabs: readonly TabRecord[], revision?: string | number): TabSnapshot {
  const tabIds = tabs.map((tab) => tab.id);
  if (new Set(tabIds).size !== tabIds.length) {
    throw new AIValidationError(translate(getAppLanguage(), "ai.snapshotDuplicateIds"));
  }
  return {
    fingerprint: fingerprintTabs(tabs),
    tabIds,
    ...(revision === undefined ? {} : { revision })
  };
}

export function assertSnapshotUnchanged(
  expected: TabSnapshot,
  current: TabSnapshot | readonly TabRecord[]
): void {
  const actual: TabSnapshot = Array.isArray(current) ? createTabSnapshot(current) : (current as TabSnapshot);
  const sameRevision = expected.revision === undefined || expected.revision === actual.revision;
  if (!sameRevision || expected.fingerprint !== actual.fingerprint) {
    throw new AIConflictError(translate(getAppLanguage(), "ai.tabsChanged"));
  }
}

export const captureTabSnapshot = createTabSnapshot;
export const compareTabSnapshot = assertSnapshotUnchanged;
