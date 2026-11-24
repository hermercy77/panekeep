import { useState } from "react";
import { CircleAlert } from "lucide-react";
import type { Workspace } from "../shared/contracts";
import { useI18n } from "../i18n/react";
import { Modal } from "./Modal";

interface DeleteWorkspaceDialogProps {
  workspace: Workspace;
  tabCount: number;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (closeTabs: boolean) => void | Promise<void>;
}

export function DeleteWorkspaceDialog({ workspace, tabCount, busy = false, onClose, onConfirm }: DeleteWorkspaceDialogProps) {
  const { t } = useI18n();
  const [closeTabs, setCloseTabs] = useState(false);
  return (
    <Modal open onClose={onClose} canClose={!busy} labelledBy="delete-workspace-title" cardClassName="confirm-card delete-workspace-dialog">
      <div className="confirm-icon"><CircleAlert aria-hidden="true" size={18} /></div>
      <h2 id="delete-workspace-title">{t("side.deleteTitle", { name: workspace.name })}</h2>
      <p>{closeTabs ? t("workspace.deleteWithTabsDescription", { count: tabCount }) : t("side.deleteDescription")}</p>
      {tabCount > 0 ? <label className="delete-tabs-option">
        <input type="checkbox" checked={closeTabs} disabled={busy} onChange={(event) => setCloseTabs(event.target.checked)} />
        <span>
          <strong>{t("workspace.closeTabsOnDelete", { count: tabCount })}</strong>
          <small>{t("workspace.closeTabsWarning")}</small>
        </span>
      </label> : null}
      <div className="dialog-actions">
        <button className="button button-ghost" type="button" onClick={onClose} disabled={busy}>{t("common.cancel")}</button>
        <button className="button button-danger" type="button" onClick={() => void onConfirm(closeTabs)} disabled={busy} aria-busy={busy}>
          {busy ? <><span className="spinner spinner-inline" />{t("side.deleteWorkspace")}</> : t("side.deleteWorkspace")}
        </button>
      </div>
    </Modal>
  );
}
