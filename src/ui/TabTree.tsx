import { useMemo, type DragEvent } from "react";
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

function TabRow({ tab, selected, onActivate, onDragStart }: { tab: TabRecord; selected: boolean; onActivate: () => void; onDragStart: (event: DragEvent) => void }) {
  return (
    <button
      className={selected ? "tab-row selected" : "tab-row"}
      type="button"
      draggable
      onDragStart={onDragStart}
      onClick={onActivate}
      title={`${tabLabel(tab)}\n${tab.url}`}
    >
      <Favicon tab={tab} />
      <span className="tab-copy">
        <span className="tab-title">{tabLabel(tab)}</span>
        <span className="tab-host">{tabHost(tab)}</span>
      </span>
      {tab.pinned ? <span className="tab-marker" title="已固定">●</span> : null}
      {tab.specialReason ? <span className="tab-marker special-marker" title={tab.specialReason}>✦</span> : null}
    </button>
  );
}

function SectionHeading({
  icon,
  label,
  count,
  workspaceId,
  onDrop
}: {
  icon: string;
  label: string;
  count: number;
  workspaceId?: string;
  onDrop?: (event: DragEvent) => void;
}) {
  return (
    <div className="section-heading drop-target" onDragOver={onDrop ? (event) => event.preventDefault() : undefined} onDrop={onDrop}>
      <span className="section-icon">{icon}</span>
      <span>{label}</span>
      <span className="section-count">{count}</span>
      {workspaceId ? <span className="drop-hint">拖放整理</span> : null}
    </div>
  );
}

function EmptyTree({ query, filter }: { query: string; filter: TabFilter }) {
  return (
    <div className="empty-state tree-empty">
      <div className="empty-illustration">◌</div>
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
  const windows = useMemo(() => {
    if (snapshot.windows.length) return snapshot.windows;
    const keys = [...new Set(snapshot.tabs.map((tab) => tab.windowKey))];
    return keys.map((key, index) => ({ key, nativeId: 0, name: "", order: index, isCurrent: index === 0, expanded: true }));
  }, [snapshot.tabs, snapshot.windows]);
  const visibleTabCount = snapshot.tabs.filter((tab) => tabMatches(tab, query, filter)).length;
  const visibleWorkspaceCount = snapshot.workspaces.filter((workspace) => workspaceMatches(workspace, query, workspaceTag)).length;

  return (
    <div className="tree" aria-label="标签树">
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
        return (
          <section className={window.isCurrent ? "window-section current" : "window-section"} key={window.key}>
            <button className="window-heading" type="button" onClick={() => onToggleWindow(window.key)} aria-expanded={isExpanded}>
              <span className="tree-chevron">{isExpanded ? "⌄" : "›"}</span>
              <span className="window-icon">▦</span>
              <span className="window-name">{windowLabel(window, windowIndex)}</span>
              {window.isCurrent ? <span className="current-pill">当前</span> : null}
              <span className="window-count">{windowTabs.length}</span>
            </button>
            {isExpanded ? (
              <div className="window-children">
                <div className="tree-section">
                  <SectionHeading icon="⌂" label="固定标签" count={fixedTabs.length} />
                  {fixedTabs.map((tab) => (
                    <TabRow key={tab.id} tab={tab} selected={selectedTabId === tab.id} onActivate={() => onActivateTab(tab.id)} onDragStart={(event) => writeDrag(event, { type: "tab", id: tab.id })} />
                  ))}
                </div>
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
                  return (
                    <div
                      className="tree-section workspace-section"
                      key={workspace.id}
                      draggable
                      onDragStart={(event) => writeDrag(event, { type: "workspace", id: workspace.id })}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        const payload = parseDrag(event);
                        if (!payload) return;
                        if (payload.type === "tab") onMoveTab(payload.id, workspace.id);
                        if (payload.type === "workspace" && payload.id !== workspace.id) onMoveWorkspace(payload.id, workspace.id);
                      }}
                    >
                      <div className="workspace-heading-row" title={workspace.description || undefined}>
                        <button className="workspace-heading" type="button" onClick={() => onToggleWorkspace(workspace.id)} aria-expanded={workspaceExpanded}>
                          <span className="tree-chevron">{workspaceExpanded ? "⌄" : "›"}</span>
                          <span className={`workspace-dot workspace-dot-${workspace.color || "slate"}`} />
                          <span className="workspace-name">{workspace.name}</span>
                          <span className="workspace-count">{workspaceTabs.length}</span>
                        </button>
                        <div className="workspace-actions">
                          <button className="mini-icon-button" type="button" onClick={() => onEditWorkspace(workspace)} aria-label={`编辑${workspace.name}`}>
                            ✎
                          </button>
                          <button className="mini-icon-button danger" type="button" onClick={() => onDeleteWorkspace(workspace)} aria-label={`删除${workspace.name}`}>
                            ×
                          </button>
                        </div>
                        {workspace.description ? <span className="description-tooltip">{workspace.description}</span> : null}
                      </div>
                      {workspaceExpanded ? (
                        <div className="workspace-tabs drop-target">
                          {workspaceTabs.length ? (
                            workspaceTabs.map((tab) => (
                              <TabRow key={tab.id} tab={tab} selected={selectedTabId === tab.id} onActivate={() => onActivateTab(tab.id)} onDragStart={(event) => writeDrag(event, { type: "tab", id: tab.id })} />
                            ))
                          ) : (
                            <div className="drop-placeholder">把标签拖到这里</div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                <div className="tree-section">
                  <SectionHeading
                    icon="◇"
                    label="未分类"
                    count={unclassified.length}
                    onDrop={(event) => {
                      event.preventDefault();
                      const payload = parseDrag(event);
                      if (payload?.type === "tab") onMoveTab(payload.id, null);
                    }}
                  />
                  {unclassified.map((tab) => (
                    <TabRow key={tab.id} tab={tab} selected={selectedTabId === tab.id} onActivate={() => onActivateTab(tab.id)} onDragStart={(event) => writeDrag(event, { type: "tab", id: tab.id })} />
                  ))}
                </div>
                <div className="tree-section">
                  <SectionHeading icon="✦" label="特殊页面" count={specialTabs.length} />
                  {specialTabs.map((tab) => (
                    <TabRow key={tab.id} tab={tab} selected={selectedTabId === tab.id} onActivate={() => onActivateTab(tab.id)} onDragStart={(event) => writeDrag(event, { type: "tab", id: tab.id })} />
                  ))}
                </div>
                <button className="create-workspace-link" type="button" onClick={() => onCreateWorkspace(window.key)}>
                  <span>＋</span> 新建工作区
                </button>
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
