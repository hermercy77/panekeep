import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronsDownUp, ChevronsUpDown, CircleAlert, CopyMinus, RefreshCw, Search, Settings2, Sparkles, Trash2, X } from "lucide-react";
import { isWorkspaceClosableTab, type AIProfile, type OrganizationMode, type OrganizationPreview, type Workspace, type WorkspaceMergePreview } from "../shared/contracts";
import { usePaneKeepState } from "../ui-state/usePaneKeepState";
import { OrganizationDialog } from "./OrganizationDialog";
import { TabTree, type TabFilter, type WindowScope } from "./TabTree";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { useI18n } from "../i18n/react";
import { WorkspaceMergeDialog } from "./WorkspaceMergeDialog";
import { DeleteWorkspaceDialog } from "./DeleteWorkspaceDialog";
import { createAIConfigStore } from "../ai/config";
import { ensureAIOriginPermission } from "../ai/permissions";
import { BrandMark } from "./BrandMark";

const COLLAPSED_WINDOWS_KEY = "panekeep.collapsed-windows";
const EXPANDED_WORKSPACES_KEY = "panekeep.expanded-workspaces";

function readStoredSet(key: string): Set<string> {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((item): item is string => typeof item === "string")) : new Set();
  } catch {
    return new Set();
  }
}

function writeStoredSet(key: string, values: Set<string>): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify([...values]));
  } catch {
    // Ignore storage quota or private-context failures for UI fold state.
  }
}

function manageUrl(hash = ""): string {
  try {
    const browser = (globalThis as { chrome?: { runtime?: { getURL?: (path: string) => string } } }).chrome;
    return `${browser?.runtime?.getURL?.("manage.html") ?? "manage.html"}${hash}`;
  } catch {
    return `manage.html${hash}`;
  }
}

async function openManageTab(hash = ""): Promise<void> {
  const url = manageUrl(hash);
  const baseUrl = manageUrl();
  const chromeApi = (globalThis as {
    chrome?: {
      tabs?: {
        query?: (queryInfo: { url?: string }) => Promise<Array<{ id?: number; windowId?: number }>>;
        update?: (tabId: number, updateProperties: { active?: boolean; url?: string }) => Promise<unknown>;
        create?: (createProperties: { url: string }) => Promise<unknown>;
      };
      windows?: {
        update?: (windowId: number, updateInfo: { focused?: boolean }) => Promise<unknown>;
      };
    };
  }).chrome;
  if (chromeApi?.tabs?.create) {
    try {
      const existing = chromeApi.tabs.query ? await chromeApi.tabs.query({ url: `${baseUrl}*` }) : [];
      const first = existing.find((tab) => tab.id !== undefined);
      if (first?.id !== undefined && chromeApi.tabs.update) {
        await chromeApi.tabs.update(first.id, { active: true, ...(hash ? { url } : {}) });
        if (first.windowId !== undefined && chromeApi.windows?.update) {
          await chromeApi.windows.update(first.windowId, { focused: true });
        }
        return;
      }
      await chromeApi.tabs.create({ url });
      return;
    } catch {
      // Fall through to opening via window.open when extension tab APIs fail.
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
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
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(() => readStoredSet(EXPANDED_WORKSPACES_KEY));
  const collapsedWindowsRef = useRef<Set<string>>(readStoredSet(COLLAPSED_WINDOWS_KEY));
  const seenWindowsRef = useRef<Set<string>>(new Set());
  const [selectedTabId, setSelectedTabId] = useState<string | null>(null);
  const [checkedTabIds, setCheckedTabIds] = useState<Set<string>>(new Set());
  const [batchNotice, setBatchNotice] = useState<string | null>(null);
  const [workspaceDialog, setWorkspaceDialog] = useState<{ windowKey: string; workspace?: Workspace } | null>(null);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Workspace | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [mergePreview, setMergePreview] = useState<WorkspaceMergePreview | null>(null);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiMode, setAiMode] = useState<OrganizationMode>("purpose");
  const [aiPreview, setAiPreview] = useState<OrganizationPreview | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiApplying, setAiApplying] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiExpectedOrigin, setAiExpectedOrigin] = useState<string | undefined>(undefined);
  const [aiProfiles, setAiProfiles] = useState<AIProfile[]>([]);
  const [activeAiProfileId, setActiveAiProfileId] = useState<string | null>(null);

  useEffect(() => {
    const keys = snapshot.windows.length ? snapshot.windows.map((window) => window.key) : [...new Set(snapshot.tabs.map((tab) => tab.windowKey))];
    if (!keys.length) return;
    setExpandedWindows((current) => {
      const next = new Set([...current].filter((key) => keys.includes(key)));
      for (const key of keys) {
        if (!seenWindowsRef.current.has(key)) {
          seenWindowsRef.current.add(key);
          if (!collapsedWindowsRef.current.has(key)) next.add(key);
        }
      }
      return next;
    });
  }, [snapshot.tabs, snapshot.windows]);

  useEffect(() => {
    setExpandedWorkspaces((current) => {
      const ids = new Set(snapshot.workspaces.map((workspace) => workspace.id));
      const next = new Set([...current].filter((id) => ids.has(id)));
      writeStoredSet(EXPANDED_WORKSPACES_KEY, next);
      return next;
    });
  }, [snapshot.workspaces]);

  useEffect(() => {
    const existingIds = new Set(snapshot.tabs.filter((tab) => tab.kind !== "special").map((tab) => tab.id));
    setCheckedTabIds((current) => new Set([...current].filter((id) => existingIds.has(id))));
  }, [snapshot.tabs]);

  const currentKey = useMemo(() => currentWindowKey(snapshot.windows), [snapshot.windows]);
  const activeTabId = useMemo(
    () => snapshot.tabs.find((tab) => tab.active && tab.windowKey === currentKey)?.id
      ?? snapshot.tabs.find((tab) => tab.active)?.id
      ?? selectedTabId,
    [currentKey, selectedTabId, snapshot.tabs]
  );
  const allWindowKeys = useMemo(
    () => (snapshot.windows.length ? snapshot.windows.map((window) => window.key) : [...new Set(snapshot.tabs.map((tab) => tab.windowKey))]),
    [snapshot.tabs, snapshot.windows]
  );
  const allExpanded = allWindowKeys.every((key) => expandedWindows.has(key))
    && snapshot.workspaces.every((workspace) => expandedWorkspaces.has(workspace.id));
  const toggleExpandAll = () => {
    if (allExpanded) {
      collapsedWindowsRef.current = new Set(allWindowKeys);
      writeStoredSet(COLLAPSED_WINDOWS_KEY, collapsedWindowsRef.current);
      setExpandedWindows(new Set());
      setExpandedWorkspaces(new Set());
      writeStoredSet(EXPANDED_WORKSPACES_KEY, new Set());
    } else {
      collapsedWindowsRef.current = new Set();
      writeStoredSet(COLLAPSED_WINDOWS_KEY, collapsedWindowsRef.current);
      setExpandedWindows(new Set(allWindowKeys));
      const allWs = new Set(snapshot.workspaces.map((workspace) => workspace.id));
      setExpandedWorkspaces(allWs);
      writeStoredSet(EXPANDED_WORKSPACES_KEY, allWs);
    }
  };
  const copyTabUrl = (url: string) => {
    void navigator.clipboard?.writeText(url).then(() => {
      setBatchNotice(t("tree.urlCopied"));
    }).catch(() => undefined);
  };
  const closeSelectedTabs = async (tabIds: string[]) => {
    if (!tabIds.length) return;
    setBatchNotice(null);
    const outcome = await state.closeTabs(tabIds);
    if (!outcome) return;
    const closedSet = new Set(outcome.closedTabIds);
    setCheckedTabIds((current) => new Set([...current].filter((id) => !closedSet.has(id))));
  };
  const deduplicateTabs = async () => {
    setBatchNotice(null);
    const seenByUrl = new Map<string, typeof snapshot.tabs[number]>();
    const duplicateIds: string[] = [];
    const candidates = snapshot.tabs
      .filter((tab) => tab.kind === "normal" && !tab.pinned && tab.url.trim().length > 0)
      .sort((left, right) => {
        if (left.active !== right.active) return left.active ? -1 : 1;
        return (right.lastActivatedAt ?? 0) - (left.lastActivatedAt ?? 0) || left.index - right.index;
      });
    for (const tab of candidates) {
      const normalized = tab.url.trim().replace(/#.*$/, "");
      if (seenByUrl.has(normalized)) duplicateIds.push(tab.id);
      else seenByUrl.set(normalized, tab);
    }
    if (!duplicateIds.length) {
      setBatchNotice(t("side.noDuplicates"));
      return;
    }
    const outcome = await state.closeTabs(duplicateIds);
    if (outcome) {
      setBatchNotice(t("side.duplicatesClosed", { count: outcome.closedTabIds.length }));
    }
  };
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
      setExpandedWorkspaces((current) => {
        const next = new Set(current).add(saved.id);
        writeStoredSet(EXPANDED_WORKSPACES_KEY, next);
        return next;
      });
    }
  };

  const confirmDelete = async (closeTabs: boolean) => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteBusy(true);
    const ok = await state.deleteWorkspace(target.id, closeTabs);
    setDeleteBusy(false);
    if (ok) setDeleteTarget(null);
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
    else setMergeError(state.getLastError() ?? t("error.mergePreviewFailed"));
  };

  const confirmWorkspaceMerge = async (preview: WorkspaceMergePreview) => {
    setMergeBusy(true);
    setMergeError(null);
    const ok = await state.mergeWorkspaces(preview);
    setMergeBusy(false);
    if (ok) {
      setMergePreview(null);
      setCheckedTabIds((current) => new Set([...current].filter((id) => !preview.sourceTabIds.includes(id))));
    } else setMergeError(state.getLastError() ?? t("error.mergeStateChanged"));
  };

  const applyAiExpectedOrigin = (config: { baseUrl: string }) => {
    let parsedOrigin: string | undefined;
    try {
      parsedOrigin = new URL(config.baseUrl).origin;
    } catch { /* keep undefined */ }
    setAiExpectedOrigin(parsedOrigin);
  };

  const openAi = () => {
    setAiOpen(true);
    setAiPreview(null);
    setAiError(null);
    const store = createAIConfigStore();
    void store.loadSettings().then(async (settings) => {
      setAiProfiles(settings.profiles);
      setActiveAiProfileId(settings.activeProfileId);
      const active = settings.profiles.find((item) => item.id === settings.activeProfileId);
      if (active) applyAiExpectedOrigin(active);
      else applyAiExpectedOrigin(await store.load());
    }).catch(() => {
      setAiProfiles([]);
      setActiveAiProfileId(null);
      setAiExpectedOrigin(undefined);
    });
  };

  const selectAiProfile = (profileId: string) => {
    const store = createAIConfigStore();
    void store.setActiveProfile(profileId).then((settings) => {
      setAiProfiles(settings.profiles);
      setActiveAiProfileId(settings.activeProfileId);
      const active = settings.profiles.find((item) => item.id === settings.activeProfileId);
      if (active) applyAiExpectedOrigin(active);
      setAiError(null);
    }).catch((error) => {
      setAiError(error instanceof Error ? error.message : t("notice.aiSaveFailed"));
    });
  };

  const generatePreview = async (mode: OrganizationMode, tabIds: string[]) => {
    setAiMode(mode);
    setAiLoading(true);
    setAiError(null);
    let expectedOrigin = aiExpectedOrigin;
    try {
      const config = await createAIConfigStore().load();
      let currentOrigin: string | undefined;
      try { currentOrigin = new URL(config.baseUrl).origin; } catch { /* validated below */ }
      if (expectedOrigin && currentOrigin && expectedOrigin !== currentOrigin) {
        setAiExpectedOrigin(currentOrigin);
        setAiLoading(false);
        setAiError(t("error.browserChanged"));
        return;
      }
      expectedOrigin = currentOrigin;
      if (config.apiKey && config.model && config.baseUrl) {
        await ensureAIOriginPermission(config.baseUrl);
      }
    } catch (error) {
      setAiLoading(false);
      setAiError(error instanceof Error ? error.message : t("side.previewFailed"));
      return;
    }
    const preview = await state.requestOrganization(mode, tabIds, expectedOrigin);
    setAiLoading(false);
    if (preview) setAiPreview(preview);
    else setAiError(state.getLastError() ?? t("side.previewFailed"));
  };

  const applyPreview = async (preview: OrganizationPreview) => {
    if (!preview) return;
    setAiApplying(true);
    setAiError(null);
    const ok = await state.applyOrganization(preview);
    setAiApplying(false);
    if (ok) {
      setAiOpen(false);
      setAiPreview(null);
    } else {
      setAiError(state.getLastError() ?? t("error.operationFailed"));
    }
  };

  return (
    <main className="app-shell sidepanel-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            <BrandMark size={20} />
          </div>
          <div>
            <h1>{t("brand.name")}</h1>
            <p>{t("side.subtitle")}</p>
          </div>
        </div>
        <div className="header-actions">
          <button className="icon-button" type="button" onClick={() => void deduplicateTabs()} aria-label={t("side.deduplicateTabs")} title={t("side.deduplicateTabs")}>
            <CopyMinus aria-hidden="true" size={17} />
          </button>
          <button className="icon-button" type="button" onClick={toggleExpandAll} aria-label={allExpanded ? t("side.collapseAll") : t("side.expandAll")} title={allExpanded ? t("side.collapseAll") : t("side.expandAll")}>
            {allExpanded ? <ChevronsDownUp aria-hidden="true" size={17} /> : <ChevronsUpDown aria-hidden="true" size={17} />}
          </button>
          <button className="icon-button" type="button" onClick={() => void state.refresh()} aria-label={t("common.refresh")} title={t("common.refresh")}>
            <RefreshCw aria-hidden="true" size={17} />
          </button>
          <a
            className="icon-button"
            href={manageUrl()}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => {
              event.preventDefault();
              void openManageTab();
            }}
            aria-label={t("side.openManage")}
            title={t("side.manageWorkspaces")}
          >
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
        <div className="filter-row" role="group" aria-label={t("side.tabFilters")}>
          <button className={filter === "unclassified" ? "filter-chip active" : "filter-chip"} type="button" aria-pressed={filter === "unclassified"} onClick={() => setFilter((current) => current === "unclassified" ? "all" : "unclassified")}>{t("common.unclassified")} <span>{unclassifiedCount}</span></button>
          <button className={windowScope === "current" ? "filter-chip active" : "filter-chip"} type="button" aria-pressed={windowScope === "current"} onClick={() => setWindowScope((current) => current === "current" ? "all" : "current")}>{t("side.currentWindow")}</button>
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
            selectedTabId={activeTabId}
            checkedTabIds={checkedTabIds}
            onToggleWindow={(key) => setExpandedWindows((current) => {
              const next = new Set(current);
              if (next.has(key)) {
                next.delete(key);
                collapsedWindowsRef.current.add(key);
              } else {
                next.add(key);
                collapsedWindowsRef.current.delete(key);
              }
              writeStoredSet(COLLAPSED_WINDOWS_KEY, collapsedWindowsRef.current);
              return next;
            })}
            onToggleWorkspace={(id) => setExpandedWorkspaces((current) => {
              const next = new Set(current);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              writeStoredSet(EXPANDED_WORKSPACES_KEY, next);
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
            onCloseTabs={(tabIds) => void closeSelectedTabs(tabIds)}
            onTogglePinTab={(tabId, pinned) => void state.setTabPinned(tabId, pinned)}
            onCopyUrl={copyTabUrl}
          />
        )}
      </section>

      <footer className="sidepanel-footer">
        <div className="footer-stat">
          {checkedTabIds.size ? (
            <>
              <span>{t("tree.selectedCount", { count: checkedTabIds.size })}</span>
              <select
                className="batch-move-select"
                value=""
                aria-label={t("tree.batchMoveTo")}
                onChange={(event) => {
                  const target = event.target.value;
                  if (!target) return;
                  if (target === "__unclassified__") {
                    void moveCheckedTabs([...checkedTabIds], null, currentKey);
                  } else {
                    void moveCheckedTabs([...checkedTabIds], target);
                  }
                }}
              >
                <option value="">{t("tree.batchMoveTo")}</option>
                <option value="__unclassified__">{t("common.unclassified")}</option>
                {[...snapshot.workspaces]
                  .sort((left, right) => left.order - right.order)
                  .map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
              </select>
              <button
                className="selection-clear danger"
                type="button"
                aria-label={t("tree.batchClose")}
                title={t("tree.batchClose")}
                onClick={() => void closeSelectedTabs([...checkedTabIds])}
              >
                <Trash2 aria-hidden="true" size={12} />
              </button>
              <button className="selection-clear" type="button" onClick={() => setCheckedTabIds(new Set())}>{t("tree.clearSelection")}</button>
            </>
          ) : (
            <><span className="status-dot" aria-hidden="true" /><span>{snapshot.tabs.length ? t("common.tabsCount", { count: snapshot.tabs.length }) : t("side.waitingTabs")}</span></>
          )}
        </div>
        <button className="button button-ai" type="button" onClick={openAi}>
          <Sparkles aria-hidden="true" size={15} />{t("side.aiOrganize")}
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
          busy={deleteBusy}
          onClose={() => { if (!deleteBusy) setDeleteTarget(null); }}
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
        profiles={aiProfiles}
        activeProfileId={activeAiProfileId}
        onSelectProfile={selectAiProfile}
        tabs={snapshot.tabs}
        mode={aiMode}
        preview={aiPreview}
        loading={aiLoading}
        applying={aiApplying}
        error={aiError}
        onModeChange={(mode) => {
          setAiMode(mode);
          setAiPreview(null);
        }}
        onGenerate={generatePreview}
        onConfirm={applyPreview}
        onOpenSettings={() => void openManageTab("#ai-settings")}
        onClose={() => {
          if (aiApplying) return;
          if (aiLoading) {
            setAiLoading(false);
            void state.cancelOrganization();
          }
          setAiOpen(false);
        }}
      />
    </main>
  );
}
