import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { AppWindow, ChevronDown, ChevronRight, GripVertical, Inbox, Pencil, Pin, Plus, Rows3, ShieldAlert, Trash2 } from "lucide-react";
import type { TabRecord, WindowState, Workspace } from "../shared/contracts";
import { tabHost, tabLabel } from "../ui-state/model";
import type { TabFridgeSnapshot } from "../ui-state/model";

export type TabFilter = "all" | "unclassified";
export type WindowScope = "all" | "current";

interface TabTreeProps {
  snapshot: TabFridgeSnapshot;
  query: string;
  filter: TabFilter;
  windowScope: WindowScope;
  workspaceTag: string;
  expandedWindows: Set<string>;
  expandedWorkspaces: Set<string>;
  selectedTabId: string | null;
  onToggleWindow: (windowKey: string) => void;
  onToggleWorkspace: (workspaceId: string) => void;
  onActivateTab: (tabId: string) => void;
  onMoveTab: (tabId: string, workspaceId: string | null) => void;
  onMoveWorkspace: (workspaceId: string, beforeWorkspaceId?: string) => void;
  onEditWorkspace: (workspace: Workspace) => void;
  onDeleteWorkspace: (workspace: Workspace) => void;
  onCreateWorkspace: (windowKey: string) => void;
}

type DragPayload = { type: "tab" | "workspace"; id: string };
type TabSectionKind = "fixed" | "unclassified" | "special";

const WORKSPACE_COLORS = new Set(["slate", "blue", "cyan", "green", "amber", "rose", "violet"]);

function workspaceColorName(color: string): string {
  return WORKSPACE_COLORS.has(color) ? color : "slate";
}

function parseDrag(event: DragEvent): DragPayload | null {
  const raw = event.dataTransfer.getData("application/x-tab-fridge");
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as DragPayload;
    return data.type && data.id ? data : null;
  } catch {
    return null;
  }
}

function writeDrag(event: DragEvent, payload: DragPayload): void {
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("application/x-tab-fridge", JSON.stringify(payload));
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

function windowLabel(window: WindowState, index: number): string {
  return window.name.trim() || `窗口 ${index + 1}`;
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
  selected,
  dragging,
  onActivate,
  onDragStart,
  onDragEnd
}: {
  tab: TabRecord;
  selected: boolean;
  dragging: boolean;
  onActivate: () => void;
  onDragStart: (event: DragEvent) => void;
  onDragEnd: (event: DragEvent) => void;
}) {
  const canDrag = tab.kind !== "special";
  return (
    <button
      className={`tab-row${selected ? " selected" : ""}${dragging ? " dragging-source" : ""}`}
      type="button"
      draggable={canDrag}
      onDragStart={canDrag ? onDragStart : undefined}
      onDragEnd={canDrag ? onDragEnd : undefined}
      onClick={onActivate}
      title={`${tabLabel(tab)}\n${tab.url}`}
    >
      <Favicon tab={tab} />
      <span className="tab-copy">
        <span className="tab-title">{tabLabel(tab)}</span>
        <span className="tab-host">{tabHost(tab)}</span>
      </span>
      {tab.pinned ? <span className="tab-marker" title="已固定"><Pin aria-hidden="true" size={12} /></span> : null}
      {tab.specialReason ? <span className="tab-marker special-marker" title={tab.specialReason}><ShieldAlert aria-hidden="true" size={12} /></span> : null}
    </button>
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
  return (
    <div className="empty-state tree-empty">
      <div className="empty-illustration"><Rows3 aria-hidden="true" size={22} /></div>
      <strong>{query ? "没有匹配的标签" : filter === "unclassified" ? "未分类为空" : "当前窗口还没有标签"}</strong>
      <span>{query ? "换个关键词试试，支持标题和网址搜索。" : "打开网页后，标签会自动出现在这里。"}</span>
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
  onToggleWindow,
  onToggleWorkspace,
  onActivateTab,
  onMoveTab,
  onMoveWorkspace,
  onEditWorkspace,
  onDeleteWorkspace,
  onCreateWorkspace
}: TabTreeProps) {
  const [collapsedTabSections, setCollapsedTabSections] = useState<Set<string>>(new Set());
  const [dragPayload, setDragPayload] = useState<DragPayload | null>(null);
  const [activeDropTarget, setActiveDropTarget] = useState<string | null>(null);
  const activeDropTargetRef = useRef<string | null>(null);
  const workspaceExpandTimerRef = useRef<number | null>(null);
  const windows = useMemo(() => {
    if (snapshot.windows.length) return snapshot.windows;
    const keys = [...new Set(snapshot.tabs.map((tab) => tab.windowKey))];
    return keys.map((key, index) => ({ key, nativeId: 0, name: "", order: index, isCurrent: index === 0, expanded: true }));
  }, [snapshot.tabs, snapshot.windows]);
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

  const finishDrag = (event?: DragEvent) => {
    event?.stopPropagation();
    clearWorkspaceExpandTimer();
    setDropTarget(null);
    setDragPayload(null);
  };

  const beginDrag = (event: DragEvent, payload: DragPayload) => {
    event.stopPropagation();
    writeDrag(event, payload);
    setDragPayload(payload);
    setDropTarget(null);
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

  const draggedTab = dragPayload?.type === "tab" ? snapshot.tabs.find((tab) => tab.id === dragPayload.id) : undefined;
  const canMoveDraggedTab = dragPayload?.type === "tab" && draggedTab !== undefined && draggedTab.kind !== "special";
  const canMoveDraggedTabToUnclassified = canMoveDraggedTab && draggedTab.workspaceId !== null;
  const tabDropGuidance = draggedTab?.pinned ? "取消固定并移入" : "松开移入";

  return (
    <div className={`tree${dragPayload ? ` dragging-${dragPayload.type}` : ""}`} aria-label="标签树">
      <span className="sr-only" aria-live="polite">
        {dragPayload?.type === "tab" ? "正在移动标签，可放入其他工作区或未分类" : dragPayload?.type === "workspace" ? "正在调整工作区顺序" : ""}
      </span>
      {!windows.length || (!visibleTabCount && !visibleWorkspaceCount) ? <EmptyTree query={query} filter={filter} /> : null}
      {windows.filter((window) => windowScope === "all" || window.isCurrent).map((window, windowIndex) => {
        const windowTabs = snapshot.tabs.filter((tab) => tab.windowKey === window.key);
        const fixedTabs = windowTabs.filter((tab) => tab.kind !== "special" && (tab.pinned || tab.kind === "fixed")).filter((tab) => tabMatches(tab, query, filter));
        const specialTabs = windowTabs.filter((tab) => tab.kind === "special").filter((tab) => tabMatches(tab, query, filter));
        const workspaces = sortWorkspaces(snapshot.workspaces.filter((workspace) => workspace.windowKey === window.key && workspaceMatches(workspace, query, workspaceTag)));
        const unclassified = windowTabs
          .filter((tab) => tab.kind === "normal" && !tab.pinned && tab.workspaceId === null)
          .filter((tab) => tabMatches(tab, query, filter));
        const isExpanded = expandedWindows.has(window.key);
        const unclassifiedExpanded = sectionExpanded(window.key, "unclassified");
        const specialExpanded = sectionExpanded(window.key, "special");
        const fixedExpanded = sectionExpanded(window.key, "fixed");
        const canDropIntoWindowUnclassified = canMoveDraggedTabToUnclassified && draggedTab.windowKey === window.key;
        return (
          <section className={window.isCurrent ? "window-section current" : "window-section"} data-level="window" key={window.key}>
            <button className="window-heading" type="button" onClick={() => onToggleWindow(window.key)} aria-expanded={isExpanded}>
              <span className="tree-chevron">{isExpanded ? <ChevronDown aria-hidden="true" size={15} /> : <ChevronRight aria-hidden="true" size={15} />}</span>
              <span className="window-icon"><AppWindow aria-hidden="true" size={14} /></span>
              <span className="window-name">{windowLabel(window, windowIndex)}</span>
              {window.isCurrent ? <span className="current-pill">当前</span> : null}
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
                  const acceptsTab = canMoveDraggedTab && draggedTab.workspaceId !== workspace.id;
                  const acceptsWorkspace = dragPayload?.type === "workspace" && dragPayload.id !== workspace.id;
                  const acceptsDrop = acceptsTab || acceptsWorkspace;
                  return (
                    <div
                      className={`tree-section workspace-section workspace-accent-${workspaceColorName(workspace.color)}${acceptsTab ? " drop-zone-tab" : ""}${acceptsWorkspace ? " drop-zone-workspace" : ""}${activeDropTarget === workspaceDropTarget ? " drag-active" : ""}${dragPayload?.type === "workspace" && dragPayload.id === workspace.id ? " dragging-source" : ""}`}
                      data-level="workspace"
                      key={workspace.id}
                      onDragEnter={(event) => {
                        if (!acceptsDrop) return;
                        activateDropTarget(event, workspaceDropTarget);
                        if (acceptsTab) scheduleWorkspaceExpand(workspace.id, workspaceDropTarget, workspaceExpanded);
                      }}
                      onDragOver={(event) => {
                        if (!acceptsDrop) return;
                        activateDropTarget(event, workspaceDropTarget);
                      }}
                      onDragLeave={(event) => leaveDropTarget(event, workspaceDropTarget)}
                      onDrop={(event) => {
                        if (!acceptsDrop) return;
                        event.preventDefault();
                        event.stopPropagation();
                        const payload = parseDrag(event) ?? dragPayload;
                        if (!payload) return;
                        if (payload.type === "tab") onMoveTab(payload.id, workspace.id);
                        if (payload.type === "workspace" && payload.id !== workspace.id) onMoveWorkspace(payload.id, workspace.id);
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
                          <span className={`workspace-dot workspace-dot-${workspaceColorName(workspace.color)}`} aria-hidden="true" />
                          <span className="workspace-level">工作区</span>
                          <span className="workspace-name">{workspace.name}</span>
                          <span className="workspace-count">{workspaceTabs.length}</span>
                        </button>
                        <div className="workspace-actions">
                          <button className="mini-icon-button" type="button" onClick={() => onEditWorkspace(workspace)} aria-label={`编辑${workspace.name}`}>
                            <Pencil aria-hidden="true" size={14} />
                          </button>
                          <button className="mini-icon-button danger" type="button" onClick={() => onDeleteWorkspace(workspace)} aria-label={`删除${workspace.name}`}>
                            <Trash2 aria-hidden="true" size={14} />
                          </button>
                        </div>
                        {workspace.description ? <span className="description-tooltip">{workspace.description}</span> : null}
                      </div>
                      <span className="drop-guidance" aria-hidden="true">{tabDropGuidance}</span>
                      {workspaceExpanded ? (
                        <div className="workspace-tabs drop-target">
                          {workspaceTabs.length ? (
                            workspaceTabs.map((tab) => (
                              <TabRow key={tab.id} tab={tab} selected={selectedTabId === tab.id} dragging={dragPayload?.type === "tab" && dragPayload.id === tab.id} onActivate={() => onActivateTab(tab.id)} onDragStart={(event) => beginDrag(event, { type: "tab", id: tab.id })} onDragEnd={finishDrag} />
                            ))
                          ) : (
                            <div className="drop-placeholder">把标签拖到这里</div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                <button className="create-workspace-link" type="button" onClick={() => onCreateWorkspace(window.key)}>
                  <Plus aria-hidden="true" size={14} />新建工作区
                </button>
                <div
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
                    if (payload?.type === "tab") onMoveTab(payload.id, null);
                    finishDrag();
                  }}
                >
                  <SectionHeading
                    icon={<Inbox aria-hidden="true" size={14} />}
                    label="未分类"
                    count={unclassified.length}
                    kind="unclassified"
                    expanded={unclassifiedExpanded}
                    onToggle={() => toggleSection(window.key, "unclassified")}
                  />
                  <span className="drop-guidance" aria-hidden="true">松开移回未分类</span>
                  {unclassifiedExpanded ? unclassified.map((tab) => (
                    <TabRow key={tab.id} tab={tab} selected={selectedTabId === tab.id} dragging={dragPayload?.type === "tab" && dragPayload.id === tab.id} onActivate={() => onActivateTab(tab.id)} onDragStart={(event) => beginDrag(event, { type: "tab", id: tab.id })} onDragEnd={finishDrag} />
                  )) : null}
                </div>
                <div className="tree-section">
                  <SectionHeading
                    icon={<ShieldAlert aria-hidden="true" size={14} />}
                    label="特殊页面"
                    count={specialTabs.length}
                    kind="special"
                    expanded={specialExpanded}
                    onToggle={() => toggleSection(window.key, "special")}
                  />
                  {specialExpanded ? specialTabs.map((tab) => (
                    <TabRow key={tab.id} tab={tab} selected={selectedTabId === tab.id} dragging={false} onActivate={() => onActivateTab(tab.id)} onDragStart={(event) => beginDrag(event, { type: "tab", id: tab.id })} onDragEnd={finishDrag} />
                  )) : null}
                </div>
                <div className="tree-section">
                  <SectionHeading
                    icon={<Pin aria-hidden="true" size={14} />}
                    label="固定标签"
                    count={fixedTabs.length}
                    kind="fixed"
                    expanded={fixedExpanded}
                    onToggle={() => toggleSection(window.key, "fixed")}
                  />
                  {fixedExpanded ? fixedTabs.map((tab) => (
                    <TabRow key={tab.id} tab={tab} selected={selectedTabId === tab.id} dragging={dragPayload?.type === "tab" && dragPayload.id === tab.id} onActivate={() => onActivateTab(tab.id)} onDragStart={(event) => beginDrag(event, { type: "tab", id: tab.id })} onDragEnd={finishDrag} />
                  )) : null}
                </div>
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
