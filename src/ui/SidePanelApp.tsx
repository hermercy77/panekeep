import { useEffect, useMemo, useState } from "react";
import { CircleAlert, RefreshCw, Rows3, ScanLine, Search, Settings2, X } from "lucide-react";
import { isWorkspaceClosableTab, type OrganizationMode, type OrganizationPreview, type Workspace, type WorkspaceMergePreview } from "../shared/contracts";
import { usePaneKeepState } from "../ui-state/usePaneKeepState";
import { OrganizationDialog } from "./OrganizationDialog";
import { TabTree, type TabFilter, type WindowScope } from "./TabTree";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { useI18n } from "../i18n/react";
import { WorkspaceMergeDialog } from "./WorkspaceMergeDialog";
import { DeleteWorkspaceDialog } from "./DeleteWorkspaceDialog";
import { createAIConfigStore } from "../ai/config";
import { getAIProviderPreset } from "../ai/providers";

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
  const { t } = useI18n();
  const state = usePaneKeepState();
  const { snapshot } = state;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<TabFilter>("all");
  const [windowScope, setWindowScope] = useState<WindowScope>("all");
  const [workspaceTag, setWorkspaceTag] = useState("");
  const [expandedWindows, setExpandedWindows] = useState<Set<string>>(new Set());
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(new Set());
  const [selectedTabId, setSelectedTabId] = useState<string | null>(null);
  const [checkedTabIds, setCheckedTabIds] = useState<Set<string>>(new Set());
  const [batchNotice, setBatchNotice] = useState<string | null>(null);
  const [workspaceDialog, setWorkspaceDialog] = useState<{ windowKey: string; workspace?: Workspace } | null>(null);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Workspace | null>(null);
  const [mergePreview, setMergePreview] = useState<WorkspaceMergePreview | null>(null);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiMode, setAiMode] = useState<OrganizationMode>("purpose");
  const [aiPreview, setAiPreview] = useState<OrganizationPreview | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiApplying, setAiApplying] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiDestination, setAiDestination] = useState("");

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

  useEffect(() => {
    const existingIds = new Set(snapshot.tabs.filter((tab) => tab.kind !== "special").map((tab) => tab.id));
    setCheckedTabIds((current) => new Set([...current].filter((id) => existingIds.has(id))));
  }, [snapshot.tabs]);

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

  const confirmDelete = async (closeTabs: boolean) => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    await state.deleteWorkspace(target.id, closeTabs);
  };

  const moveCheckedTabs = async (tabIds: string[], workspaceId: string | null, targetWindowKey?: string) => {
    setBatchNotice(null);
    const outcome = await state.moveTabs(tabIds, workspaceId, targetWindowKey);
    if (!outcome) return;
    const remainingIds = new Set(outcome.tabs.map((tab) => tab.id));
    setCheckedTabIds(new Set(outcome.skippedTabIds.filter((id) => remainingIds.has(id))));
    if (outcome.skippedTabIds.length) {
      setBatchNotice(t("tree.batchMoveSkipped", { moved: outcome.movedTabIds.length, skipped: outcome.skippedTabIds.length }));
    }
  };

  const requestWorkspaceMerge = async (sourceWorkspaceId: string, targetWorkspaceId: string) => {
    setMergeError(null);
    const preview = await state.previewWorkspaceMerge(sourceWorkspaceId, targetWorkspaceId);
    if (preview) setMergePreview(preview);
    else setMergeError(t("error.mergePreviewFailed"));
  };

  const confirmWorkspaceMerge = async (preview: WorkspaceMergePreview) => {
    setMergeBusy(true);
    setMergeError(null);
    const ok = await state.mergeWorkspaces(preview);
    setMergeBusy(false);
    if (ok) {
      setMergePreview(null);
      setCheckedTabIds((current) => new Set([...current].filter((id) => !preview.sourceTabIds.includes(id))));
    } else setMergeError(t("error.mergeStateChanged"));
  };

  const openAi = () => {
    setAiOpen(true);
    setAiPreview(null);
    setAiError(null);
    void createAIConfigStore().load().then((config) => {
      const preset = getAIProviderPreset(config.providerId);
      let origin = config.baseUrl;
      try { origin = new URL(config.baseUrl).origin; } catch { /* keep configured value */ }
      const provider = preset ? t(preset.nameKey) : t("manage.providerCustom");
      setAiDestination(origin ? `${provider} (${origin})` : provider);
    }).catch(() => setAiDestination(t("organize.configuredProvider")));
  };

  const generatePreview = async (mode: OrganizationMode, tabIds: string[]) => {
    setAiMode(mode);
    setAiLoading(true);
    setAiError(null);
    const preview = await state.requestOrganization(mode, tabIds);
    setAiLoading(false);
    if (preview) setAiPreview(preview);
    else setAiError(state.error ?? t("side.previewFailed"));
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
            <h1>{t("brand.name")}</h1>
            <p>{t("side.subtitle")}</p>
          </div>
        </div>
        <div className="header-actions">
          <button className="icon-button" type="button" onClick={() => void state.refresh()} aria-label={t("common.refresh")} title={t("common.refresh")}>
            <RefreshCw aria-hidden="true" size={17} />
          </button>
          <a className="icon-button" href={manageUrl()} aria-label={t("side.openManage")} title={t("side.manageWorkspaces")}>
            <Settings2 aria-hidden="true" size={17} />
          </a>
        </div>
      </header>

      <section className="search-section">
        <label className="search-box">
          <Search aria-hidden="true" size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("side.search")} aria-label={t("side.search")} />
          {query ? (
            <button className="search-clear" type="button" onClick={() => setQuery("")} aria-label={t("side.clearSearch")}>
              <X aria-hidden="true" size={14} />
            </button>
          ) : null}
        </label>
        <div className="filter-row" role="tablist" aria-label={t("side.tabFilters")}>
          <button className={filter === "unclassified" ? "filter-chip active" : "filter-chip"} type="button" onClick={() => setFilter((current) => current === "unclassified" ? "all" : "unclassified")}>{t("common.unclassified")} <span>{unclassifiedCount}</span></button>
          <button className={windowScope === "current" ? "filter-chip active" : "filter-chip"} type="button" onClick={() => setWindowScope((current) => current === "current" ? "all" : "current")}>{t("side.currentWindow")}</button>
          <select className="filter-select" value={workspaceTag} onChange={(event) => setWorkspaceTag(event.target.value)} aria-label={t("side.workspaceTagFilter")}>
            <option value="">{t("side.workspaceTags")}</option>
            {[...new Set(snapshot.workspaces.flatMap((workspace) => workspace.tags))].sort().map((tag) => <option value={tag} key={tag}>{tag}</option>)}
          </select>
        </div>
      </section>

      {state.error ? (
        <div className="error-banner" role="alert">
          <CircleAlert aria-hidden="true" size={16} />
          <p>{state.error}</p>
          <button type="button" onClick={() => state.clearError()} aria-label={t("side.closeError")}>
              <X aria-hidden="true" size={14} />
          </button>
        </div>
      ) : null}
      {batchNotice ? (
        <div className="batch-notice" role="status">
          <p>{batchNotice}</p>
          <button type="button" onClick={() => setBatchNotice(null)} aria-label={t("common.close")}><X aria-hidden="true" size={14} /></button>
        </div>
      ) : null}

      <section className="tree-panel">
        {state.status === "loading" && !snapshot.tabs.length && !snapshot.windows.length ? (
          <div className="loading-state" aria-live="polite">
            <span className="spinner" />
            {t("side.loadingTabs")}
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
            checkedTabIds={checkedTabIds}
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
            onCheckedTabIdsChange={setCheckedTabIds}
            onMoveTabs={(tabIds, workspaceId, targetWindowKey) => void moveCheckedTabs(tabIds, workspaceId, targetWindowKey)}
            onMoveWorkspace={(workspaceId, beforeId) => void state.moveWorkspace(workspaceId, beforeId)}
            onRequestWorkspaceMerge={(sourceId, targetId) => void requestWorkspaceMerge(sourceId, targetId)}
            onEditWorkspace={openEditWorkspace}
            onDeleteWorkspace={setDeleteTarget}
            onCreateWorkspace={openCreateWorkspace}
          />
        )}
      </section>

      <footer className="sidepanel-footer">
        <div className="footer-stat">
          {checkedTabIds.size ? (
            <><span>{t("tree.selectedCount", { count: checkedTabIds.size })}</span><button className="selection-clear" type="button" onClick={() => setCheckedTabIds(new Set())}>{t("tree.clearSelection")}</button></>
          ) : (
            <><span className="status-dot" aria-hidden="true" /><span>{snapshot.tabs.length ? t("common.tabsCount", { count: snapshot.tabs.length }) : t("side.waitingTabs")}</span></>
          )}
        </div>
        <button className="button button-ai" type="button" onClick={openAi}>
          <ScanLine aria-hidden="true" size={16} />{t("side.aiOrganize")}
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
        <DeleteWorkspaceDialog
          workspace={deleteTarget}
          tabCount={snapshot.tabs.filter((tab) => isWorkspaceClosableTab(tab, deleteTarget.id)).length}
          onClose={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
        />
      ) : null}
      <WorkspaceMergeDialog
        preview={mergePreview}
        source={snapshot.workspaces.find((workspace) => workspace.id === mergePreview?.sourceWorkspaceId)}
        target={snapshot.workspaces.find((workspace) => workspace.id === mergePreview?.targetWorkspaceId)}
        targetTabCount={snapshot.tabs.filter((tab) => tab.workspaceId === mergePreview?.targetWorkspaceId).length}
        busy={mergeBusy}
        error={mergeError}
        onClose={() => { if (!mergeBusy) { setMergePreview(null); setMergeError(null); } }}
        onConfirm={(preview) => void confirmWorkspaceMerge(preview)}
      />
      <OrganizationDialog
        open={aiOpen}
        destination={aiDestination}
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
