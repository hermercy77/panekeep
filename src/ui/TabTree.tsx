import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { AppWindow, ChevronDown, ChevronRight, GripVertical, Inbox, MoreHorizontal, Pencil, Pin, Plus, Rows3, ShieldAlert, Trash2, X } from "lucide-react";
import type { TabRecord, WindowState, Workspace } from "../shared/contracts";
import { tabHost, tabLabel } from "../ui-state/model";
import type { PaneKeepSnapshot } from "../ui-state/model";
import { workspaceColorClass } from "./workspaceColors";
import { useI18n } from "../i18n/react";
import { WorkspaceIcon } from "./WorkspaceIcon";

export type TabFilter = "all" | "unclassified";
export type WindowScope = "all" | "current";

interface TabTreeProps {
  snapshot: PaneKeepSnapshot;
  query: string;
  filter: TabFilter;
  windowScope: WindowScope;
  workspaceTag: string;
  expandedWindows: Set<string>;
  expandedWorkspaces: Set<string>;
  selectedTabId: string | null;
  checkedTabIds: Set<string>;
  onToggleWindow: (windowKey: string) => void;
  onToggleWorkspace: (workspaceId: string) => void;
  onActivateTab: (tabId: string) => void;
  onCheckedTabIdsChange: (tabIds: Set<string>) => void;
  onMoveTabs: (tabIds: string[], workspaceId: string | null, targetWindowKey?: string) => void;
  onMoveWorkspace: (workspaceId: string, beforeWorkspaceId?: string) => void;
  onRequestWorkspaceMerge: (sourceWorkspaceId: string, targetWorkspaceId: string) => void;
  onEditWorkspace: (workspace: Workspace) => void;
  onDeleteWorkspace: (workspace: Workspace) => void;
  onCreateWorkspace: (windowKey: string) => void;
}

type DragPayload =
  | { type: "tabs"; ids: string[]; anchorId: string }
  | { type: "workspace"; id: string };
type WorkspaceDropZone = "before" | "merge" | "after";
type TabSectionKind = "fixed" | "unclassified" | "special";

function parseDrag(event: DragEvent): DragPayload | null {
  const raw = event.dataTransfer.getData("application/x-panekeep");
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as DragPayload | { type: "tab"; id: string };
    if (data.type === "tab" && data.id) return { type: "tabs", ids: [data.id], anchorId: data.id };
    if (data.type === "tabs" && Array.isArray(data.ids) && data.ids.length && data.anchorId) return data;
    if (data.type === "workspace" && data.id) return data;
    return null;
  } catch {
    return null;
  }
}

function writeDrag(event: DragEvent, payload: DragPayload): void {
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("application/x-panekeep", JSON.stringify(payload));
}

function setBatchDragImage(event: DragEvent, title: string, count: number): void {
  if (typeof event.dataTransfer.setDragImage !== "function" || typeof document === "undefined") return;
  const ghost = document.createElement("div");
  ghost.className = "tab-drag-ghost";
  const titleElement = document.createElement("span");
  titleElement.className = "tab-drag-ghost-title";
  titleElement.textContent = title;
  const countElement = document.createElement("span");
  countElement.className = "tab-drag-ghost-count";
  countElement.textContent = String(count);
  ghost.append(titleElement, countElement);
  document.body.append(ghost);
  event.dataTransfer.setDragImage(ghost, 22, 18);
  window.setTimeout(() => ghost.remove(), 0);
}

function workspaceDropZone(event: DragEvent, crossWindow: boolean): WorkspaceDropZone {
  if (crossWindow) return "merge";
  const bounds = event.currentTarget.getBoundingClientRect();
  const ratio = bounds.height > 0 ? (event.clientY - bounds.top) / bounds.height : 0.5;
  if (ratio < 0.25) return "before";
  if (ratio > 0.75) return "after";
  return "merge";
}

export function dragAutoScrollVelocity(
  clientY: number,
  top: number,
  bottom: number,
  edgeSize = 64,
  maxSpeed = 18
): number {
  if (!Number.isFinite(clientY) || bottom <= top || edgeSize <= 0 || maxSpeed <= 0) return 0;
  const activeEdgeSize = Math.min(edgeSize, (bottom - top) / 2);
  if (clientY < top + activeEdgeSize) {
    const intensity = Math.min(1, Math.max(0, (top + activeEdgeSize - clientY) / activeEdgeSize));
    return -Math.max(2, Math.ceil(maxSpeed * intensity));
  }
  if (clientY > bottom - activeEdgeSize) {
    const intensity = Math.min(1, Math.max(0, (clientY - (bottom - activeEdgeSize)) / activeEdgeSize));
    return Math.max(2, Math.ceil(maxSpeed * intensity));
  }
  return 0;
}

function tabMatches(tab: TabRecord, query: string, filter: TabFilter): boolean {
  if (filter === "unclassified" && (tab.workspaceId !== null || tab.pinned || tab.kind !== "normal")) return false;
  if (!query.trim()) return true;
  const haystack = `${tab.title ?? ""} ${tab.url}`.toLowerCase();
  return haystack.includes(query.trim().toLowerCase());
}

function workspaceMatches(workspace: Workspace, query: string, workspaceTag: string): boolean {
  if (workspaceTag && !workspace.tags.includes(workspaceTag)) return false;
  if (!query.trim()) return true;
  const haystack = `${workspace.name} ${workspace.description} ${workspace.tags.join(" ")}`.toLowerCase();
  return haystack.includes(query.trim().toLowerCase());
}

function workspaceTagMatches(workspace: Workspace, workspaceTag: string): boolean {
  return !workspaceTag || workspace.tags.includes(workspaceTag);
}

function windowLabel(window: WindowState, fallback: string): string {
  const name = window.name.trim();
  return !name || /^(?:Window|\u7a97\u53e3) \d+$/.test(name) ? fallback : name;
}

function sortWorkspaces(workspaces: Workspace[]): Workspace[] {
  return [...workspaces].sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
}

function Favicon({ tab }: { tab: TabRecord }) {
  const fallback = (tab.title?.trim() || "?").slice(0, 1).toUpperCase();
  return tab.faviconUrl ? (
    <img className="tab-favicon" src={tab.faviconUrl} alt="" onError={(event) => (event.currentTarget.style.display = "none")} />
  ) : (
    <span className="tab-favicon-fallback" aria-hidden="true">
      {fallback}
    </span>
  );
}

function TabRow({
  tab,
  now,
  active,
  checked,
  dragging,
  onActivate,
  onToggleChecked,
  onDragStart,
  onDragEnd
}: {
  tab: TabRecord;
  now: number;
  active: boolean;
  checked: boolean;
  dragging: boolean;
  onActivate: () => void;
  onToggleChecked: (shiftKey: boolean) => void;
  onDragStart: (event: DragEvent) => void;
  onDragEnd: (event: DragEvent) => void;
}) {
  const { language, t } = useI18n();
  const canDrag = tab.kind !== "special";
  const lastVisited = (() => {
    if (tab.lastActivatedAt === undefined) return null;
    const elapsed = Math.max(0, now - tab.lastActivatedAt);
    const minutes = Math.floor(elapsed / 60_000);
    if (minutes < 1) return t("tab.visitedJustNow");
    if (minutes < 60) return t("tab.visitedMinutes", { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t("tab.visitedHours", { count: hours });
    const days = Math.floor(hours / 24);
    if (days < 7) return t("tab.visitedDays", { count: days });
    return new Intl.DateTimeFormat(language, { year: "numeric", month: "short", day: "numeric" }).format(tab.lastActivatedAt);
  })();
  const lastVisitedLabel = lastVisited ? t("tab.lastVisited", { time: lastVisited }) : null;
  return (
    <div
      className={`tab-row${active ? " selected" : ""}${checked ? " checked" : ""}${dragging ? " dragging-source" : ""}`}
      data-tab-id={tab.id}
      draggable={canDrag}
      onDragStart={canDrag ? onDragStart : undefined}
      onDragEnd={canDrag ? onDragEnd : undefined}
    >
      <input
        className="tab-checkbox"
        type="checkbox"
        checked={checked}
        disabled={!canDrag}
        readOnly
        aria-label={canDrag ? t("tree.selectTab", { name: tabLabel(tab) }) : t("tree.specialNotSelectable")}
        title={canDrag ? t("tree.selectTab", { name: tabLabel(tab) }) : t("tree.specialNotSelectable")}
        onClick={(event) => {
          event.stopPropagation();
          onToggleChecked(event.shiftKey);
        }}
      />
      <button
        className="tab-activate"
        type="button"
        draggable={canDrag}
        onDragStart={canDrag ? onDragStart : undefined}
        onDragEnd={canDrag ? onDragEnd : undefined}
        onClick={onActivate}
        title={[tabLabel(tab), tab.url, tab.specialReason, lastVisitedLabel].filter(Boolean).join("\n")}
      >
        <Favicon tab={tab} />
        <span className="tab-copy">
          <span className="tab-title">{tabLabel(tab)}</span>
          <span className="tab-host">{tabHost(tab)}</span>
          {lastVisited ? <span className="tab-last-visited">{lastVisited}</span> : null}
        </span>
      </button>
    </div>
  );
}

function SectionHeading({
  icon,
  label,
  count,
  kind,
  expanded,
  onToggle
}: {
  icon: ReactNode;
  label: string;
  count: number;
  kind: TabSectionKind;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      className={`section-heading section-heading-${kind}`}
      type="button"
      data-level="tab-type"
      aria-expanded={expanded}
      onClick={onToggle}
    >
      <span className="tree-chevron">{expanded ? <ChevronDown aria-hidden="true" size={14} /> : <ChevronRight aria-hidden="true" size={14} />}</span>
      <span className="section-icon">{icon}</span>
      <span>{label}</span>
      <span className="section-count">{count}</span>
    </button>
  );
}

function EmptyTree({ query, filter }: { query: string; filter: TabFilter }) {
  const { t } = useI18n();
  return (
    <div className="empty-state tree-empty">
      <div className="empty-illustration"><Rows3 aria-hidden="true" size={22} /></div>
      <strong>{query ? t("tree.noMatches") : filter === "unclassified" ? t("tree.unclassifiedEmpty") : t("tree.currentWindowEmpty")}</strong>
      <span>{query ? t("tree.searchHint") : t("tree.emptyHint")}</span>
    </div>
  );
}

export function TabTree({
  snapshot,
  query,
  filter,
  windowScope,
  workspaceTag,
  expandedWindows,
  expandedWorkspaces,
  selectedTabId,
  checkedTabIds,
  onToggleWindow,
  onToggleWorkspace,
  onActivateTab,
  onCheckedTabIdsChange,
  onMoveTabs,
  onMoveWorkspace,
  onRequestWorkspaceMerge,
  onEditWorkspace,
  onDeleteWorkspace,
  onCreateWorkspace
}: TabTreeProps) {
  const { t } = useI18n();
  const [timeNow, setTimeNow] = useState(() => Date.now());
  const [collapsedTabSections, setCollapsedTabSections] = useState<Set<string>>(new Set());
  const [dragPayload, setDragPayload] = useState<DragPayload | null>(null);
  const [activeDropTarget, setActiveDropTarget] = useState<string | null>(null);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);
  const activeDropTargetRef = useRef<string | null>(null);
  const workspaceExpandTimerRef = useRef<number | null>(null);
  const treeRef = useRef<HTMLDivElement | null>(null);
  const autoScrollFrameRef = useRef<number | null>(null);
  const autoScrollVelocityRef = useRef(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTimeNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const windows = useMemo(() => {
    if (snapshot.windows.length) return snapshot.windows;
    const keys = [...new Set(snapshot.tabs.map((tab) => tab.windowKey))];
    return keys.map((key, index) => ({ key, nativeId: 0, name: "", order: index, isCurrent: index === 0, expanded: true }));
  }, [snapshot.tabs, snapshot.windows]);
  const visibleSelectableTabIds = useMemo(() => {
    const ids: string[] = [];
    for (const window of windows.filter((item) => windowScope === "all" || item.isCurrent)) {
      if (!expandedWindows.has(window.key)) continue;
      const windowTabs = snapshot.tabs.filter((tab) => tab.windowKey === window.key);
      const workspaces = sortWorkspaces(snapshot.workspaces.filter(
        (workspace) => workspace.windowKey === window.key && workspaceTagMatches(workspace, workspaceTag)
      )).filter((workspace) => {
        if (!query.trim()) return true;
        if (workspaceMatches(workspace, query, workspaceTag)) return true;
        return windowTabs.some((tab) => tab.workspaceId === workspace.id && tabMatches(tab, query, filter));
      });
      for (const workspace of workspaces) {
        if (!expandedWorkspaces.has(workspace.id)) continue;
        const workspaceNameMatches = workspaceMatches(workspace, query, workspaceTag);
        ids.push(...windowTabs
          .filter((tab) => tab.workspaceId === workspace.id && tab.kind !== "special" && !tab.pinned)
          .filter((tab) => !query.trim() || workspaceNameMatches || tabMatches(tab, query, filter))
          .map((tab) => tab.id));
      }
      if (!collapsedTabSections.has(`${window.key}:unclassified`)) {
        ids.push(...windowTabs
          .filter((tab) => tab.kind === "normal" && !tab.pinned && tab.workspaceId === null)
          .filter((tab) => tabMatches(tab, query, filter))
          .map((tab) => tab.id));
      }
      if (!collapsedTabSections.has(`${window.key}:fixed`)) {
        ids.push(...windowTabs
          .filter((tab) => tab.kind !== "special" && (tab.pinned || tab.kind === "fixed"))
          .filter((tab) => tabMatches(tab, query, filter))
          .map((tab) => tab.id));
      }
    }
    return ids;
  }, [collapsedTabSections, expandedWindows, expandedWorkspaces, filter, query, snapshot.tabs, snapshot.workspaces, windowScope, windows, workspaceTag]);
  const visibleTabCount = snapshot.tabs.filter((tab) => tabMatches(tab, query, filter)).length;
  const visibleWorkspaceCount = snapshot.workspaces.filter((workspace) => workspaceMatches(workspace, query, workspaceTag)).length;
  const sectionExpanded = (windowKey: string, kind: TabSectionKind) => !collapsedTabSections.has(`${windowKey}:${kind}`);
  const toggleSection = (windowKey: string, kind: TabSectionKind) => {
    const key = `${windowKey}:${kind}`;
    setCollapsedTabSections((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const toggleCheckedTab = (tabId: string, shiftKey: boolean) => {
    const next = new Set(checkedTabIds);
    if (shiftKey && selectionAnchorId) {
      const anchorIndex = visibleSelectableTabIds.indexOf(selectionAnchorId);
      const targetIndex = visibleSelectableTabIds.indexOf(tabId);
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const [start, end] = anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
        for (const id of visibleSelectableTabIds.slice(start, end + 1)) next.add(id);
      } else if (next.has(tabId)) next.delete(tabId);
      else next.add(tabId);
    } else if (next.has(tabId)) next.delete(tabId);
    else next.add(tabId);
    setSelectionAnchorId(tabId);
    onCheckedTabIdsChange(next);
  };

  useEffect(() => () => {
    if (workspaceExpandTimerRef.current !== null) window.clearTimeout(workspaceExpandTimerRef.current);
  }, []);

  const clearWorkspaceExpandTimer = () => {
    if (workspaceExpandTimerRef.current === null) return;
    window.clearTimeout(workspaceExpandTimerRef.current);
    workspaceExpandTimerRef.current = null;
  };

  const setDropTarget = (target: string | null) => {
    activeDropTargetRef.current = target;
    setActiveDropTarget(target);
  };

  const stopAutoScroll = () => {
    autoScrollVelocityRef.current = 0;
    if (autoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(autoScrollFrameRef.current);
      autoScrollFrameRef.current = null;
    }
  };

  const runAutoScrollFrame = () => {
    const panel = treeRef.current?.closest(".tree-panel");
    if (!(panel instanceof HTMLElement) || autoScrollVelocityRef.current === 0) {
      autoScrollFrameRef.current = null;
      return;
    }
    panel.scrollTop += autoScrollVelocityRef.current;
    autoScrollFrameRef.current = window.requestAnimationFrame(runAutoScrollFrame);
  };

  const updateAutoScroll = (clientY: number) => {
    const panel = treeRef.current?.closest(".tree-panel");
    if (!(panel instanceof HTMLElement)) return;
    const bounds = panel.getBoundingClientRect();
    autoScrollVelocityRef.current = dragAutoScrollVelocity(clientY, bounds.top, bounds.bottom);
    if (autoScrollVelocityRef.current === 0) {
      stopAutoScroll();
      return;
    }
    if (autoScrollFrameRef.current === null) {
      autoScrollFrameRef.current = window.requestAnimationFrame(runAutoScrollFrame);
    }
  };

  useEffect(() => {
    if (!dragPayload) {
      stopAutoScroll();
      return;
    }
    const handleDragOver = (event: Event) => updateAutoScroll((event as MouseEvent).clientY);
    const handleStop = () => stopAutoScroll();
    window.addEventListener("dragover", handleDragOver, true);
    window.addEventListener("drop", handleStop, true);
    return () => {
      window.removeEventListener("dragover", handleDragOver, true);
      window.removeEventListener("drop", handleStop, true);
      stopAutoScroll();
    };
  }, [dragPayload]);

  const finishDrag = (event?: DragEvent) => {
    event?.stopPropagation();
    clearWorkspaceExpandTimer();
    stopAutoScroll();
    setDropTarget(null);
    setDragPayload(null);
  };

  const beginDrag = (event: DragEvent, payload: DragPayload) => {
    event.stopPropagation();
    writeDrag(event, payload);
    setDragPayload(payload);
    setDropTarget(null);
  };
  const beginTabDrag = (event: DragEvent, tab: TabRecord) => {
    const selectedMovableIds = [...checkedTabIds].filter((id) => {
      const selectedTab = snapshot.tabs.find((item) => item.id === id);
      return selectedTab && selectedTab.kind !== "special";
    });
    const ids = checkedTabIds.has(tab.id) && selectedMovableIds.length ? selectedMovableIds : [tab.id];
    if (!checkedTabIds.has(tab.id)) {
      onCheckedTabIdsChange(new Set([tab.id]));
      setSelectionAnchorId(tab.id);
    }
    setBatchDragImage(event, tabLabel(tab), ids.length);
    beginDrag(event, { type: "tabs", ids, anchorId: tab.id });
  };

  const activateDropTarget = (event: DragEvent, target: string) => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDropTarget(target);
  };

  const leaveDropTarget = (event: DragEvent, target: string) => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    if (activeDropTargetRef.current === target) setDropTarget(null);
    clearWorkspaceExpandTimer();
  };

  const scheduleWorkspaceExpand = (workspaceId: string, target: string, expanded: boolean) => {
    if (expanded || workspaceExpandTimerRef.current !== null) return;
    workspaceExpandTimerRef.current = window.setTimeout(() => {
      workspaceExpandTimerRef.current = null;
      if (activeDropTargetRef.current === target) onToggleWorkspace(workspaceId);
    }, 600);
  };

  const draggedTabs = dragPayload?.type === "tabs"
    ? dragPayload.ids.map((id) => snapshot.tabs.find((tab) => tab.id === id)).filter((tab): tab is TabRecord => Boolean(tab))
    : [];
  const draggedWorkspace = dragPayload?.type === "workspace" ? snapshot.workspaces.find((workspace) => workspace.id === dragPayload.id) : undefined;
  const canMoveDraggedTabs = dragPayload?.type === "tabs" && draggedTabs.some((tab) => tab.kind !== "special");
  const tabDropGuidance = draggedTabs.some((tab) => tab.pinned) ? t("tree.unpinAndMove") : t("tree.dropToMove");
  const renderTabRow = (tab: TabRecord) => (
    <TabRow
      key={tab.id}
      tab={tab}
      now={timeNow}
      active={selectedTabId === tab.id}
      checked={checkedTabIds.has(tab.id)}
      dragging={dragPayload?.type === "tabs" && dragPayload.ids.includes(tab.id)}
      onActivate={() => onActivateTab(tab.id)}
      onToggleChecked={(shiftKey) => toggleCheckedTab(tab.id, shiftKey)}
      onDragStart={(event) => beginTabDrag(event, tab)}
      onDragEnd={finishDrag}
    />
  );

  return (
    <div ref={treeRef} className={`tree${dragPayload ? ` dragging-${dragPayload.type}` : ""}`} aria-label={t("tree.label")}>
      <span className="sr-only" aria-live="polite">
        {dragPayload?.type === "tabs" ? t("tree.movingTabs", { count: dragPayload.ids.length }) : dragPayload?.type === "workspace" ? t("tree.movingWorkspace") : ""}
      </span>
      {!windows.length || (!visibleTabCount && !visibleWorkspaceCount) ? <EmptyTree query={query} filter={filter} /> : null}
      {windows.filter((window) => windowScope === "all" || window.isCurrent).map((window, windowIndex) => {
        const windowTabs = snapshot.tabs.filter((tab) => tab.windowKey === window.key);
        const fixedTabs = windowTabs.filter((tab) => tab.kind !== "special" && (tab.pinned || tab.kind === "fixed")).filter((tab) => tabMatches(tab, query, filter));
        const specialTabs = windowTabs.filter((tab) => tab.kind === "special").filter((tab) => tabMatches(tab, query, filter));
        const workspaces = sortWorkspaces(snapshot.workspaces.filter(
          (workspace) => workspace.windowKey === window.key && workspaceTagMatches(workspace, workspaceTag)
        ));
        const unclassified = windowTabs
          .filter((tab) => tab.kind === "normal" && !tab.pinned && tab.workspaceId === null)
          .filter((tab) => tabMatches(tab, query, filter));
        const isExpanded = expandedWindows.has(window.key);
        const unclassifiedExpanded = sectionExpanded(window.key, "unclassified");
        const specialExpanded = sectionExpanded(window.key, "special");
        const fixedExpanded = sectionExpanded(window.key, "fixed");
        const normalDraggedTabs = draggedTabs.filter((tab) => tab.kind === "normal" && !tab.pinned);
        const canDropIntoWindowUnclassified = canMoveDraggedTabs
          && normalDraggedTabs.length > 0
          && normalDraggedTabs.some((tab) => tab.workspaceId !== null || tab.windowKey !== window.key);
        const showUnclassified = true;
        const showSpecial = true;
        const showFixed = true;
        return (
          <section className={window.isCurrent ? "window-section current" : "window-section"} data-level="window" key={window.key}>
            <button className="window-heading" type="button" onClick={() => onToggleWindow(window.key)} aria-expanded={isExpanded}>
              <span className="tree-chevron">{isExpanded ? <ChevronDown aria-hidden="true" size={15} /> : <ChevronRight aria-hidden="true" size={15} />}</span>
              <span className="window-icon"><AppWindow aria-hidden="true" size={14} /></span>
              <span className="window-name">{windowLabel(window, t("common.windowName", { count: windowIndex + 1 }))}</span>
              {window.isCurrent ? <span className="current-pill">{t("common.current")}</span> : null}
              <span className="window-count">{windowTabs.length}</span>
            </button>
            {isExpanded ? (
              <div className="window-children">
                {workspaces.filter((workspace) => {
                  if (!query.trim()) return true;
                  if (workspaceMatches(workspace, query, workspaceTag)) return true;
                  return windowTabs.some((tab) => tab.workspaceId === workspace.id && tabMatches(tab, query, filter));
                }).map((workspace) => {
                  const workspaceNameMatches = workspaceMatches(workspace, query, workspaceTag);
                  const workspaceTabs = windowTabs
                    .filter((tab) => tab.workspaceId === workspace.id && tab.kind !== "special" && !tab.pinned)
                    .filter((tab) => !query.trim() || workspaceNameMatches || tabMatches(tab, query, filter));
                  const workspaceExpanded = expandedWorkspaces.has(workspace.id);
                  const workspaceDropTarget = `workspace:${workspace.id}`;
                  const acceptsTab = canMoveDraggedTabs && draggedTabs.some((tab) => tab.workspaceId !== workspace.id || tab.pinned || tab.kind === "fixed");
                  const acceptsWorkspace = dragPayload?.type === "workspace"
                    && dragPayload.id !== workspace.id;
                  const acceptsDrop = acceptsTab || acceptsWorkspace;
                  const activeWorkspaceTarget = activeDropTarget?.startsWith(`${workspaceDropTarget}:`) === true;
                  const activeWorkspaceZone = activeWorkspaceTarget
                    ? activeDropTarget?.slice(`${workspaceDropTarget}:`.length) as WorkspaceDropZone | "tabs"
                    : undefined;
                  return (
                    <div
                      className={`tree-section workspace-section workspace-accent-${workspaceColorClass(workspace.color)}${acceptsTab ? " drop-zone-tab" : ""}${acceptsWorkspace ? " drop-zone-workspace" : ""}${activeWorkspaceTarget ? " drag-active" : ""}${activeWorkspaceZone ? ` workspace-drop-${activeWorkspaceZone}` : ""}${dragPayload?.type === "workspace" && dragPayload.id === workspace.id ? " dragging-source" : ""}`}
                      data-level="workspace"
                      data-workspace-id={workspace.id}
                      data-drop-zone={activeWorkspaceZone && activeWorkspaceZone !== "tabs" ? activeWorkspaceZone : undefined}
                      key={workspace.id}
                      onDragEnter={(event) => {
                        if (!acceptsDrop) return;
                        if (acceptsWorkspace && dragPayload?.type === "workspace") {
                          const zone = workspaceDropZone(event, draggedWorkspace?.windowKey !== workspace.windowKey);
                          activateDropTarget(event, `${workspaceDropTarget}:${zone}`);
                        } else {
                          activateDropTarget(event, `${workspaceDropTarget}:tabs`);
                          if (acceptsTab) scheduleWorkspaceExpand(workspace.id, `${workspaceDropTarget}:tabs`, workspaceExpanded);
                        }
                      }}
                      onDragOver={(event) => {
                        if (!acceptsDrop) return;
                        if (acceptsWorkspace && dragPayload?.type === "workspace") {
                          const zone = workspaceDropZone(event, draggedWorkspace?.windowKey !== workspace.windowKey);
                          activateDropTarget(event, `${workspaceDropTarget}:${zone}`);
                        } else activateDropTarget(event, `${workspaceDropTarget}:tabs`);
                      }}
                      onDragLeave={(event) => {
                        const next = event.relatedTarget;
                        if (next instanceof Node && event.currentTarget.contains(next)) return;
                        if (activeDropTargetRef.current?.startsWith(`${workspaceDropTarget}:`)) setDropTarget(null);
                        clearWorkspaceExpandTimer();
                      }}
                      onDrop={(event) => {
                        if (!acceptsDrop) return;
                        event.preventDefault();
                        event.stopPropagation();
                        const payload = parseDrag(event) ?? dragPayload;
                        if (!payload) return;
                        if (payload.type === "tabs") onMoveTabs(payload.ids, workspace.id);
                        if (payload.type === "workspace" && payload.id !== workspace.id) {
                          const source = snapshot.workspaces.find((candidate) => candidate.id === payload.id);
                          const zone = activeWorkspaceZone && activeWorkspaceZone !== "tabs"
                            ? activeWorkspaceZone
                            : workspaceDropZone(event, source?.windowKey !== workspace.windowKey);
                          if (zone === "merge") onRequestWorkspaceMerge(payload.id, workspace.id);
                          else {
                            const siblings = sortWorkspaces(snapshot.workspaces.filter((candidate) => candidate.windowKey === workspace.windowKey && candidate.id !== payload.id));
                            const targetIndex = siblings.findIndex((candidate) => candidate.id === workspace.id);
                            const beforeId = zone === "before" ? workspace.id : siblings[targetIndex + 1]?.id;
                            onMoveWorkspace(payload.id, beforeId);
                          }
                        }
                        finishDrag();
                      }}
                    >
                      <div className="workspace-heading-row" title={workspace.description || undefined}>
                        <button
                          className="workspace-heading"
                          type="button"
                          draggable
                          onDragStart={(event) => beginDrag(event, { type: "workspace", id: workspace.id })}
                          onDragEnd={finishDrag}
                          onClick={() => onToggleWorkspace(workspace.id)}
                          aria-expanded={workspaceExpanded}
                        >
                          <GripVertical className="drag-handle" aria-hidden="true" size={14} />
                          <span className="tree-chevron">{workspaceExpanded ? <ChevronDown aria-hidden="true" size={14} /> : <ChevronRight aria-hidden="true" size={14} />}</span>
                          <span className={`workspace-icon workspace-icon-${workspaceColorClass(workspace.color)}`} aria-hidden="true"><WorkspaceIcon icon={workspace.icon} /></span>
                          <span className="workspace-name">{workspace.name}</span>
                          <span className="workspace-count">{workspaceTabs.length}</span>
                        </button>
                        <details className="workspace-menu" onClick={(event) => event.stopPropagation()}>
                          <summary className="mini-icon-button workspace-menu-trigger" aria-label={t("tree.moreActions", { name: workspace.name })} title={t("tree.moreActions", { name: workspace.name })}>
                            <MoreHorizontal aria-hidden="true" size={15} />
                          </summary>
                          <div className="workspace-menu-list">
                            <button type="button" onClick={(event) => {
                              event.currentTarget.closest("details")?.removeAttribute("open");
                              onEditWorkspace(workspace);
                            }}>
                              <Pencil aria-hidden="true" size={14} />{t("common.edit")}
                            </button>
                            <button className="danger" type="button" onClick={(event) => {
                              event.currentTarget.closest("details")?.removeAttribute("open");
                              onDeleteWorkspace(workspace);
                            }}>
                              <Trash2 aria-hidden="true" size={14} />{t("common.delete")}
                            </button>
                          </div>
                        </details>
                        {workspace.description ? <span className="description-tooltip">{workspace.description}</span> : null}
                      </div>
                      <span className="drop-guidance" aria-hidden="true">{tabDropGuidance}</span>
                      {acceptsWorkspace && activeWorkspaceZone && activeWorkspaceZone !== "tabs" ? (
                        <span className="workspace-drop-guidance" aria-hidden="true">
                          {activeWorkspaceZone === "merge" ? t("tree.mergeHere") : activeWorkspaceZone === "before" ? t("tree.moveBefore") : t("tree.moveAfter")}
                        </span>
                      ) : null}
                      {workspaceExpanded ? (
                        <div className="workspace-tabs drop-target">
                          {workspaceTabs.length ? (
                            workspaceTabs.map(renderTabRow)
                          ) : (
                            <div className="drop-placeholder">{t("tree.dropHere")}</div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                <button className="create-workspace-link" type="button" onClick={() => onCreateWorkspace(window.key)}>
                  <Plus aria-hidden="true" size={14} />{t("common.newWorkspace")}
                </button>
                {showUnclassified ? <div
                  className={`tree-section unclassified-section${canDropIntoWindowUnclassified ? " drop-zone-tab" : ""}${activeDropTarget === `unclassified:${window.key}` ? " drag-active" : ""}`}
                  onDragEnter={(event) => {
                    if (!canDropIntoWindowUnclassified) return;
                    activateDropTarget(event, `unclassified:${window.key}`);
                  }}
                  onDragOver={(event) => {
                    if (!canDropIntoWindowUnclassified) return;
                    activateDropTarget(event, `unclassified:${window.key}`);
                  }}
                  onDragLeave={(event) => leaveDropTarget(event, `unclassified:${window.key}`)}
                  onDrop={(event) => {
                    if (!canDropIntoWindowUnclassified) return;
                    event.preventDefault();
                    event.stopPropagation();
                    const payload = parseDrag(event) ?? dragPayload;
                    if (payload?.type === "tabs") onMoveTabs(payload.ids, null, window.key);
                    finishDrag();
                  }}
                >
                  <SectionHeading
                    icon={<Inbox aria-hidden="true" size={14} />}
                    label={t("common.unclassified")}
                    count={unclassified.length}
                    kind="unclassified"
                    expanded={unclassifiedExpanded}
                    onToggle={() => toggleSection(window.key, "unclassified")}
                  />
                  <span className="drop-guidance" aria-hidden="true">{t("tree.dropBackUnclassified")}</span>
                  {unclassifiedExpanded ? unclassified.map(renderTabRow) : null}
                </div> : null}
                {showSpecial ? <div className="tree-section">
                  <SectionHeading
                    icon={<ShieldAlert aria-hidden="true" size={14} />}
                    label={t("common.specialPages")}
                    count={specialTabs.length}
                    kind="special"
                    expanded={specialExpanded}
                    onToggle={() => toggleSection(window.key, "special")}
                  />
                  {specialExpanded ? specialTabs.map(renderTabRow) : null}
                </div> : null}
                {showFixed ? <div className="tree-section">
                  <SectionHeading
                    icon={<Pin aria-hidden="true" size={14} />}
                    label={t("common.fixedTabs")}
                    count={fixedTabs.length}
                    kind="fixed"
                    expanded={fixedExpanded}
                    onToggle={() => toggleSection(window.key, "fixed")}
                  />
                  {fixedExpanded ? fixedTabs.map(renderTabRow) : null}
                </div> : null}
              </div>
            ) : null}
          </section>
        );
      })}
      {dragPayload ? (
        <div
          className={`drag-cancel-zone${activeDropTarget === "cancel" ? " drag-active" : ""}`}
          role="status"
          onDragEnter={(event) => activateDropTarget(event, "cancel")}
          onDragOver={(event) => activateDropTarget(event, "cancel")}
          onDragLeave={(event) => leaveDropTarget(event, "cancel")}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            finishDrag(event);
          }}
        >
          <X aria-hidden="true" size={16} />
          <span>{activeDropTarget === "cancel" ? t("tree.dropCancelActive") : t("tree.dropCancel")}</span>
        </div>
      ) : null}
    </div>
  );
}
