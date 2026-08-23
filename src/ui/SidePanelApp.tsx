import { useEffect, useMemo, useState } from "react";
import { CircleAlert, RefreshCw, Rows3, ScanLine, Search, Settings2, X } from "lucide-react";
import type { OrganizationMode, OrganizationPreview, Workspace } from "../shared/contracts";
import { useTabFridgeState } from "../ui-state/useTabFridgeState";
import { OrganizationDialog } from "./OrganizationDialog";
import { TabTree, type TabFilter, type WindowScope } from "./TabTree";
import { WorkspaceDialog } from "./WorkspaceDialog";

function manageUrl(): string {
  try {
    const browser = (globalThis as { chrome?: { runtime?: { getURL?: (path: string) => string } } }).chrome;
    return browser?.runtime?.getURL?.("manage.html") ?? "manage.html";
  } catch {
    return "manage.html";
  }
}

function currentWindowKey(windows: { key: string; isCurrent: boolean }[]): string {
  return windows.find((window) => window.isCurrent)?.key ?? windows[0]?.key ?? "window:unknown";
}

export function SidePanelApp() {
  const state = useTabFridgeState();
  const { snapshot } = state;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<TabFilter>("all");
  const [windowScope, setWindowScope] = useState<WindowScope>("all");
  const [workspaceTag, setWorkspaceTag] = useState("");
  const [expandedWindows, setExpandedWindows] = useState<Set<string>>(new Set());
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(new Set());
  const [selectedTabId, setSelectedTabId] = useState<string | null>(null);
  const [workspaceDialog, setWorkspaceDialog] = useState<{ windowKey: string; workspace?: Workspace } | null>(null);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Workspace | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiMode, setAiMode] = useState<OrganizationMode>("purpose");
  const [aiPreview, setAiPreview] = useState<OrganizationPreview | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiApplying, setAiApplying] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    const keys = snapshot.windows.length ? snapshot.windows.map((window) => window.key) : [...new Set(snapshot.tabs.map((tab) => tab.windowKey))];
    if (!keys.length) return;
    setExpandedWindows((current) => (current.size ? current : new Set(keys)));
  }, [snapshot.tabs, snapshot.windows]);

  useEffect(() => {
    setExpandedWorkspaces((current) => {
      const ids = new Set(snapshot.workspaces.map((workspace) => workspace.id));
      const next = new Set([...current].filter((id) => ids.has(id)));
      return next;
    });
  }, [snapshot.workspaces]);

  const currentKey = useMemo(() => currentWindowKey(snapshot.windows), [snapshot.windows]);
  const unclassifiedCount = snapshot.tabs.filter((tab) => tab.kind === "normal" && !tab.pinned && tab.workspaceId === null).length;

  const openCreateWorkspace = (windowKey = currentKey) => setWorkspaceDialog({ windowKey });
  const openEditWorkspace = (workspace: Workspace) => setWorkspaceDialog({ windowKey: workspace.windowKey, workspace });

  const submitWorkspace = async (draft: Parameters<typeof state.createWorkspace>[0]) => {
    setWorkspaceBusy(true);
    const saved = workspaceDialog?.workspace
      ? await state.updateWorkspace(workspaceDialog.workspace.id, draft)
      : await state.createWorkspace(draft);
    setWorkspaceBusy(false);
    if (saved) {
      setWorkspaceDialog(null);
      setExpandedWorkspaces((current) => new Set(current).add(saved.id));
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    await state.deleteWorkspace(target.id);
  };

  const openAi = () => {
    setAiOpen(true);
    setAiPreview(null);
    setAiError(null);
  };

  const generatePreview = async (mode: OrganizationMode, tabIds: string[]) => {
    setAiMode(mode);
    setAiLoading(true);
    setAiError(null);
    const preview = await state.requestOrganization(mode, tabIds);
    setAiLoading(false);
    if (preview) setAiPreview(preview);
    else setAiError(state.error ?? "无法生成整理预览");
  };

  const applyPreview = async (preview: OrganizationPreview) => {
    if (!preview) return;
    setAiApplying(true);
    const ok = await state.applyOrganization(preview);
    setAiApplying(false);
    if (ok) {
      setAiOpen(false);
      setAiPreview(null);
    }
  };

  return (
    <main className="app-shell sidepanel-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            <Rows3 size={18} />
          </div>
          <div>
            <h1>Tab Fridge</h1>
            <p>标签工作台</p>
          </div>
        </div>
        <div className="header-actions">
          <button className="icon-button" type="button" onClick={() => void state.refresh()} aria-label="刷新" title="刷新">
            <RefreshCw aria-hidden="true" size={17} />
          </button>
          <a className="icon-button" href={manageUrl()} aria-label="打开管理页" title="管理工作区">
            <Settings2 aria-hidden="true" size={17} />
          </a>
        </div>
      </header>

      <section className="search-section">
        <label className="search-box">
          <Search aria-hidden="true" size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标签、网址或工作区" aria-label="搜索标签、网址或工作区" />
          {query ? (
            <button className="search-clear" type="button" onClick={() => setQuery("")} aria-label="清除搜索">
              <X aria-hidden="true" size={14} />
            </button>
          ) : null}
        </label>
        <div className="filter-row" role="tablist" aria-label="标签筛选">
          <button className={filter === "unclassified" ? "filter-chip active" : "filter-chip"} type="button" onClick={() => setFilter((current) => current === "unclassified" ? "all" : "unclassified")}>未分类 <span>{unclassifiedCount}</span></button>
          <button className={windowScope === "current" ? "filter-chip active" : "filter-chip"} type="button" onClick={() => setWindowScope((current) => current === "current" ? "all" : "current")}>当前窗口</button>
          <select className="filter-select" value={workspaceTag} onChange={(event) => setWorkspaceTag(event.target.value)} aria-label="工作区标签筛选">
            <option value="">工作区标签</option>
            {[...new Set(snapshot.workspaces.flatMap((workspace) => workspace.tags))].sort().map((tag) => <option value={tag} key={tag}>{tag}</option>)}
          </select>
        </div>
      </section>

      {state.error ? (
        <div className="error-banner" role="alert">
          <CircleAlert aria-hidden="true" size={16} />
          <p>{state.error}</p>
          <button type="button" onClick={() => state.clearError()} aria-label="关闭错误提示">
              <X aria-hidden="true" size={14} />
          </button>
        </div>
      ) : null}

      <section className="tree-panel">
        {state.status === "loading" && !snapshot.tabs.length && !snapshot.windows.length ? (
          <div className="loading-state" aria-live="polite">
            <span className="spinner" />
            正在加载标签…
          </div>
        ) : (
          <TabTree
            snapshot={snapshot}
            query={query}
            filter={filter}
            windowScope={windowScope}
            workspaceTag={workspaceTag}
            expandedWindows={expandedWindows}
            expandedWorkspaces={expandedWorkspaces}
            selectedTabId={selectedTabId}
            onToggleWindow={(key) => setExpandedWindows((current) => {
              const next = new Set(current);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return next;
            })}
            onToggleWorkspace={(id) => setExpandedWorkspaces((current) => {
              const next = new Set(current);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })}
            onActivateTab={(id) => {
              setSelectedTabId(id);
              void state.activateTab(id);
            }}
            onMoveTab={(tabId, workspaceId) => void state.moveTab(tabId, workspaceId)}
            onMoveWorkspace={(workspaceId, beforeId) => void state.moveWorkspace(workspaceId, beforeId)}
            onEditWorkspace={openEditWorkspace}
            onDeleteWorkspace={setDeleteTarget}
            onCreateWorkspace={openCreateWorkspace}
          />
        )}
      </section>

      <footer className="sidepanel-footer">
        <div className="footer-stat">
          <span className="status-dot" aria-hidden="true" />
          <span>{snapshot.tabs.length ? `${snapshot.tabs.length} 个标签已在本地保存` : "本地优先 · 等待标签"}</span>
        </div>
        <button className="button button-ai" type="button" onClick={openAi}>
          <ScanLine aria-hidden="true" size={16} />AI 整理
        </button>
      </footer>

      <WorkspaceDialog
        open={Boolean(workspaceDialog)}
        windowKey={workspaceDialog?.windowKey ?? currentKey}
        workspace={workspaceDialog?.workspace}
        busy={workspaceBusy}
        onClose={() => setWorkspaceDialog(null)}
        onSubmit={submitWorkspace}
      />
      {deleteTarget ? (
        <div className="dialog-backdrop" role="presentation">
          <section className="dialog-card confirm-card" role="dialog" aria-modal="true" aria-labelledby="delete-title">
            <div className="confirm-icon"><CircleAlert aria-hidden="true" size={18} /></div>
            <h2 id="delete-title">删除「{deleteTarget.name}」？</h2>
            <p>工作区会被删除，其中的标签会移到“未分类”，标签本身不会关闭。</p>
            <div className="dialog-actions">
              <button className="button button-ghost" type="button" onClick={() => setDeleteTarget(null)}>
                取消
              </button>
              <button className="button button-danger" type="button" onClick={() => void confirmDelete()}>
                删除工作区
              </button>
            </div>
          </section>
        </div>
      ) : null}
      <OrganizationDialog
        open={aiOpen}
        tabs={snapshot.tabs}
        mode={aiMode}
        preview={aiPreview}
        loading={aiLoading}
        applying={aiApplying}
        error={aiError ?? (aiApplying ? state.error : null)}
        onModeChange={(mode) => {
          setAiMode(mode);
          setAiPreview(null);
        }}
        onGenerate={generatePreview}
        onConfirm={applyPreview}
        onClose={() => {
          if (!aiApplying) setAiOpen(false);
        }}
      />
    </main>
  );
}
