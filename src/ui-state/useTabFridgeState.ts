import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OrganizationMode, OrganizationPreview, Workspace, WorkspaceMergePreview } from "../shared/contracts";
import { createBrowserAdapter } from "./adapter";
import type { TabFridgeAdapter, TabFridgeSnapshot, WorkspaceDraft } from "./model";
import { emptySnapshot } from "./model";
import { getAppLanguage, translate } from "../i18n";
import type { BackupImportResult } from "../shared/backup";
import type { MoveTabsResponse } from "../shared/messages";

export type UiLoadState = "loading" | "ready" | "error";

export interface UseTabFridgeStateResult {
  snapshot: TabFridgeSnapshot;
  status: UiLoadState;
  error: string | null;
  refresh: () => Promise<void>;
  clearError: () => void;
  createWorkspace: (draft: WorkspaceDraft) => Promise<Workspace | null>;
  updateWorkspace: (id: string, draft: Partial<WorkspaceDraft>) => Promise<Workspace | null>;
  deleteWorkspace: (id: string) => Promise<boolean>;
  moveTab: (tabId: string, workspaceId: string | null) => Promise<boolean>;
  moveTabs: (tabIds: string[], workspaceId: string | null, targetWindowKey?: string) => Promise<MoveTabsResponse | null>;
  moveWorkspace: (workspaceId: string, beforeWorkspaceId?: string) => Promise<boolean>;
  previewWorkspaceMerge: (sourceWorkspaceId: string, targetWorkspaceId: string) => Promise<WorkspaceMergePreview | null>;
  mergeWorkspaces: (preview: WorkspaceMergePreview) => Promise<boolean>;
  activateTab: (tabId: string) => Promise<boolean>;
  requestOrganization: (mode: OrganizationMode, tabIds?: string[]) => Promise<OrganizationPreview | null>;
  applyOrganization: (preview: OrganizationPreview) => Promise<boolean>;
  exportBackup: () => Promise<string | null>;
  importBackup: (json: string) => Promise<BackupImportResult | null>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : translate(getAppLanguage(), "error.generic");
}

export function useTabFridgeState(adapter?: TabFridgeAdapter): UseTabFridgeStateResult {
  const stableAdapter = useMemo(() => adapter ?? createBrowserAdapter(), [adapter]);
  const [snapshot, setSnapshot] = useState<TabFridgeSnapshot>(emptySnapshot);
  const [status, setStatus] = useState<UiLoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const next = await stableAdapter.getSnapshot();
      if (!mounted.current) return;
      setSnapshot(next);
      setStatus("ready");
    } catch (cause) {
      if (!mounted.current) return;
      setStatus("error");
      setError(errorMessage(cause));
    }
  }, [stableAdapter]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const unsubscribe = stableAdapter.subscribe?.((next) => {
      if (mounted.current) {
        setSnapshot(next);
        setStatus("ready");
      }
    });
    return () => {
      mounted.current = false;
      unsubscribe?.();
    };
  }, [refresh, stableAdapter]);

  const run = useCallback(
    async <T,>(operation: () => Promise<T>, result: (value: T) => void): Promise<boolean> => {
      setError(null);
      try {
        const value = await operation();
        if (!mounted.current) return false;
        result(value);
        const next = await stableAdapter.getSnapshot();
        if (mounted.current) {
          setSnapshot(next);
          setStatus("ready");
        }
        return true;
      } catch (cause) {
        if (mounted.current) {
          setStatus("error");
          setError(errorMessage(cause));
        }
        return false;
      }
    },
    [stableAdapter]
  );

  const createWorkspace = useCallback(
    async (draft: WorkspaceDraft) => {
      let created: Workspace | null = null;
      const ok = await run(
        async () => stableAdapter.createWorkspace(draft),
        (value) => {
          created = value;
        }
      );
      return ok ? created : null;
    },
    [run, stableAdapter]
  );

  const updateWorkspace = useCallback(
    async (id: string, draft: Partial<WorkspaceDraft>) => {
      let updated: Workspace | null = null;
      const ok = await run(
        async () => stableAdapter.updateWorkspace(id, draft),
        (value) => {
          updated = value;
        }
      );
      return ok ? updated : null;
    },
    [run, stableAdapter]
  );

  const deleteWorkspace = useCallback(
    (id: string) => run(() => stableAdapter.deleteWorkspace(id), () => undefined),
    [run, stableAdapter]
  );
  const moveTab = useCallback(
    (tabId: string, workspaceId: string | null) => run(() => stableAdapter.moveTab(tabId, workspaceId), () => undefined),
    [run, stableAdapter]
  );
  const moveTabs = useCallback(
    async (tabIds: string[], workspaceId: string | null, targetWindowKey?: string) => {
      let outcome: MoveTabsResponse | null = null;
      const ok = await run(
        () => stableAdapter.moveTabs(tabIds, workspaceId, targetWindowKey),
        (value) => { outcome = value; }
      );
      return ok ? outcome : null;
    },
    [run, stableAdapter]
  );
  const moveWorkspace = useCallback(
    (workspaceId: string, beforeWorkspaceId?: string) =>
      run(() => stableAdapter.moveWorkspace(workspaceId, beforeWorkspaceId), () => undefined),
    [run, stableAdapter]
  );
  const previewWorkspaceMerge = useCallback(
    async (sourceWorkspaceId: string, targetWorkspaceId: string) => {
      let preview: WorkspaceMergePreview | null = null;
      const ok = await run(
        () => stableAdapter.previewWorkspaceMerge(sourceWorkspaceId, targetWorkspaceId),
        (value) => { preview = value; }
      );
      return ok ? preview : null;
    },
    [run, stableAdapter]
  );
  const mergeWorkspaces = useCallback(
    (preview: WorkspaceMergePreview) => run(() => stableAdapter.mergeWorkspaces(preview), () => undefined),
    [run, stableAdapter]
  );
  const activateTab = useCallback(
    (tabId: string) => run(() => stableAdapter.activateTab(tabId), () => undefined),
    [run, stableAdapter]
  );
  const requestOrganization = useCallback(
    async (mode: OrganizationMode, tabIds?: string[]) => {
      let preview: OrganizationPreview | null = null;
      const ok = await run(
        async () => stableAdapter.requestOrganization(mode, tabIds),
        (value) => {
          preview = value;
        }
      );
      return ok ? preview : null;
    },
    [run, stableAdapter]
  );
  const applyOrganization = useCallback(
    (preview: OrganizationPreview) => run(() => stableAdapter.applyOrganization(preview), () => undefined),
    [run, stableAdapter]
  );
  const exportBackup = useCallback(async () => {
    if (!stableAdapter.exportBackup) return null;
    try {
      return await stableAdapter.exportBackup();
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause));
      return null;
    }
  }, [stableAdapter]);
  const importBackup = useCallback(async (json: string) => {
    if (!stableAdapter.importBackup) return null;
    let imported: BackupImportResult | null = null;
    const ok = await run(
      () => stableAdapter.importBackup?.(json) ?? Promise.reject(new Error(translate(getAppLanguage(), "error.importUnavailable"))),
      (value) => { imported = value; }
    );
    return ok ? imported : null;
  }, [run, stableAdapter]);

  return {
    snapshot,
    status,
    error,
    refresh,
    clearError: () => setError(null),
    createWorkspace,
    updateWorkspace,
    deleteWorkspace,
    moveTab,
    moveTabs,
    moveWorkspace,
    previewWorkspaceMerge,
    mergeWorkspaces,
    activateTab,
    requestOrganization,
    applyOrganization
    ,exportBackup
    ,importBackup
  };
}
