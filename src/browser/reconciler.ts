import { translate, type AppLanguage } from "../i18n/catalog";
import type { StateSnapshot } from "../shared/backup";
import { createWindowKey, createWorkspaceId, normalizeGroupColor, specialPageReason } from "../shared/constants";
import type { TabRecord, WindowState, Workspace } from "../shared/contracts";
import { inferWorkspaceIcon, normalizeWorkspaceIcon } from "../shared/workspaceAppearance";
import { browserTabGroupId, classifyBrowserTab, type BrowserTabLike } from "./classify";

interface BrowserGroup {
  id: number;
  title?: string | null;
  color?: string;
}

interface BrowserWindowContents {
  id: number;
  tabs: readonly BrowserTabLike[];
  groups: readonly BrowserGroup[];
}

interface ReconciliationInput {
  previous: StateSnapshot;
  windows: readonly BrowserWindowContents[];
  privateWindowIds: ReadonlySet<number>;
  currentWindowId?: number;
  restoring: boolean;
  now: number;
  language: AppLanguage;
}

interface MatchedWindowContents extends BrowserWindowContents {
  window: WindowState;
  restored: boolean;
}

export function reconcileBrowserSnapshot({
  previous, windows, privateWindowIds, currentWindowId, restoring, now, language
}: ReconciliationInput): StateSnapshot {
  const existingWindows = previous.windows.filter((window) => !privateWindowIds.has(window.nativeId));
  const existingWindowKeys = new Set(existingWindows.map((window) => window.key));
  const windowsByNativeId = new Map(existingWindows.map((window) => [window.nativeId, window]));
  const allowWindowOrderReconciliation = restoring && existingWindows.length === windows.length
    && !windows.some(({ id }) => windowsByNativeId.has(id));
  const windowContents = windows.map((contents, index): MatchedWindowContents => {
    const restoredWindow = allowWindowOrderReconciliation ? existingWindows[index] : undefined;
    const previousWindow = windowsByNativeId.get(contents.id) ?? restoredWindow;
    return {
      ...contents,
      window: {
        key: previousWindow?.key ?? createWindowKey(contents.id),
        nativeId: contents.id,
        name: previousWindow?.name || `Window ${index + 1}`,
        order: previousWindow?.order ?? index,
        isCurrent: contents.id === currentWindowId,
        expanded: previousWindow?.expanded ?? false
      },
      restored: restoredWindow !== undefined
    };
  });

  const existingWorkspaces = previous.workspaces.filter((workspace) => existingWindowKeys.has(workspace.windowKey));
  const existingTabs = new Map<string, TabRecord>();
  for (const tab of previous.tabs) {
    if (existingWindowKeys.has(tab.windowKey)) existingTabs.set(tab.id, tab);
  }
  const { matchedWorkspaces, claimedWorkspaceIds } = matchWorkspaces(windowContents, existingWorkspaces);
  const existingWorkspaceIds = new Set(existingWorkspaces.map((workspace) => workspace.id));
  const nextWorkspaces: Workspace[] = [];
  const nextTabs: TabRecord[] = [];
  for (const { window, tabs, groups } of windowContents) {
    const windowKey = window.key;
    const workspaceByGroup = new Map<number, Workspace>();
    for (const [groupIndex, group] of groups.entries()) {
      const groupId = group.id;
      const previousWorkspace = matchedWorkspaces.get(group);
      let id = previousWorkspace?.id ?? createWorkspaceId(window.nativeId, groupId);
      if (!previousWorkspace) {
        const baseId = id;
        let suffix = 1;
        while (existingWorkspaceIds.has(id) || claimedWorkspaceIds.has(id)) id = `${baseId}:${suffix++}`;
        claimedWorkspaceIds.add(id);
      }
      const workspace: Workspace = {
        id,
        windowKey,
        name: group.title?.trim() || previousWorkspace?.name || translate(language, "common.workspaceName", { count: groupIndex + 1 }),
        description: previousWorkspace?.description ?? "",
        tags: [...(previousWorkspace?.tags ?? [])],
        color: normalizeGroupColor(group.color ?? previousWorkspace?.color),
        icon: previousWorkspace?.icon
          ? normalizeWorkspaceIcon(previousWorkspace.icon)
          : inferWorkspaceIcon([group.title?.trim() ?? ""]),
        groupId,
        order: groupIndex,
        createdAt: previousWorkspace?.createdAt ?? now,
        updatedAt: previousWorkspace?.updatedAt ?? now
      };
      workspaceByGroup.set(groupId, workspace);
      nextWorkspaces.push(workspace);
    }

    for (const [tabIndex, nativeTab] of tabs.entries()) {
      if (nativeTab.id === undefined) continue;
      const id = String(nativeTab.id);
      const previousTab = existingTabs.get(id);
      const kind = classifyBrowserTab(nativeTab);
      const groupId = browserTabGroupId(nativeTab);
      const workspace = kind === "normal" && groupId !== undefined ? workspaceByGroup.get(groupId) : undefined;
      const active = nativeTab.active === true;
      const lastActivatedAt = active && previousTab?.active !== true
        ? now
        : previousTab?.lastActivatedAt ?? (active ? now : undefined);
      nextTabs.push({
        id,
        windowKey,
        workspaceId: workspace?.id ?? null,
        kind,
        url: nativeTab.url ?? "",
        index: nativeTab.index !== undefined && Number.isInteger(nativeTab.index) && nativeTab.index >= 0
          ? nativeTab.index
          : tabIndex,
        pinned: nativeTab.pinned === true,
        active,
        ...(nativeTab.title !== undefined ? { title: nativeTab.title } : {}),
        ...(nativeTab.favIconUrl !== undefined ? { faviconUrl: nativeTab.favIconUrl } : {}),
        ...(groupId !== undefined ? { groupId } : {}),
        ...(lastActivatedAt !== undefined ? { lastActivatedAt } : {}),
        ...(kind === "special" ? { specialReason: specialPageReason(nativeTab.url) } : {})
      });
    }
  }

  // A local workspace survives while its window is open and awaits a native group.
  const nextWindows = windowContents.map(({ window }) => window);
  const openWindowKeys = new Set(nextWindows.map((window) => window.key));
  for (const workspace of existingWorkspaces) {
    if (workspace.groupId === undefined && openWindowKeys.has(workspace.windowKey) && !claimedWorkspaceIds.has(workspace.id)) {
      claimedWorkspaceIds.add(workspace.id);
      nextWorkspaces.push({ ...workspace, tags: [...workspace.tags] });
    }
  }
  return {
    windows: nextWindows.sort(compareWindow),
    workspaces: nextWorkspaces.sort(compareWorkspace),
    tabs: nextTabs.sort(compareTab)
  };
}

function matchWorkspaces(windowContents: readonly MatchedWindowContents[], existingWorkspaces: readonly Workspace[]) {
  const matchedWorkspaces = new Map<BrowserGroup, Workspace>();
  const claimedWorkspaceIds = new Set<string>();
  const claimWorkspace = (group: BrowserGroup, workspace: Workspace) => {
    matchedWorkspaces.set(group, workspace);
    claimedWorkspaceIds.add(workspace.id);
  };

  // Reserve exact matches across every window before considering recovery.
  for (const { window, groups } of windowContents) {
    for (const group of groups) {
      const workspace = existingWorkspaces.find((item) => item.windowKey === window.key
        && item.groupId === group.id && !claimedWorkspaceIds.has(item.id));
      if (workspace) claimWorkspace(group, workspace);
    }
  }

  for (const { window, groups, restored } of windowContents) {
    if (!restored) continue;
    const unmatchedGroups = groups.filter((group) => !matchedWorkspaces.has(group));
    const candidates = () => existingWorkspaces.filter((item) => item.windowKey === window.key
      && item.groupId !== undefined && !claimedWorkspaceIds.has(item.id));
    for (const group of unmatchedGroups) {
      const title = group.title?.trim();
      if (!title) continue;
      const color = normalizeGroupColor(group.color);
      const sameLabels = unmatchedGroups.filter((item) => item.title?.trim() === title && normalizeGroupColor(item.color) === color);
      const matchingWorkspaces = candidates().filter((item) => item.name === title && item.color === color);
      if (sameLabels.length === 1 && matchingWorkspaces.length === 1) claimWorkspace(group, matchingWorkspaces[0]);
    }
    const remainingGroups = unmatchedGroups.filter((group) => !matchedWorkspaces.has(group));
    const remainingWorkspaces = candidates();
    if (remainingGroups.length === 1 && remainingWorkspaces.length === 1
      && remainingWorkspaces[0].order === groups.indexOf(remainingGroups[0])) {
      claimWorkspace(remainingGroups[0], remainingWorkspaces[0]);
    }
  }
  return { matchedWorkspaces, claimedWorkspaceIds };
}

/** Compare normalized snapshots in display order. */
export function snapshotsEqual(left: StateSnapshot, right: StateSnapshot): boolean {
  return arraysEqual(left.windows, right.windows, (a, b) =>
    a.key === b.key && a.nativeId === b.nativeId && a.name === b.name && a.order === b.order
    && a.isCurrent === b.isCurrent && a.expanded === b.expanded)
    && arraysEqual(left.workspaces, right.workspaces, (a, b) =>
      a.id === b.id && a.windowKey === b.windowKey && a.name === b.name && a.description === b.description
      && a.color === b.color && a.icon === b.icon && a.groupId === b.groupId && a.order === b.order
      && a.createdAt === b.createdAt && a.updatedAt === b.updatedAt
      && arraysEqual(a.tags, b.tags, (tag, other) => tag === other))
    && arraysEqual(left.tabs, right.tabs, (a, b) =>
      a.id === b.id && a.windowKey === b.windowKey && a.workspaceId === b.workspaceId && a.kind === b.kind
      && a.url === b.url && a.title === b.title && a.faviconUrl === b.faviconUrl && a.index === b.index
      && a.pinned === b.pinned && a.active === b.active && a.groupId === b.groupId
      && a.lastActivatedAt === b.lastActivatedAt && a.specialReason === b.specialReason);
}

function arraysEqual<T>(left: readonly T[], right: readonly T[], equal: (a: T, b: T) => boolean): boolean {
  return left.length === right.length && left.every((value, index) => equal(value, right[index]));
}

export function compareWindow(left: WindowState, right: WindowState): number {
  return left.order - right.order || left.nativeId - right.nativeId;
}

export function compareWorkspace(left: Workspace, right: Workspace): number {
  return left.windowKey.localeCompare(right.windowKey) || left.order - right.order || left.id.localeCompare(right.id);
}

export function compareTab(left: TabRecord, right: TabRecord): number {
  return left.windowKey.localeCompare(right.windowKey) || left.index - right.index || left.id.localeCompare(right.id);
}
