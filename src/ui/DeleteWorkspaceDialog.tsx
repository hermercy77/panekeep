import { useState } from "react";
import { CircleAlert } from "lucide-react";
import type { Workspace } from "../shared/contracts";
import { useI18n } from "../i18n/react";

interface DeleteWorkspaceDialogProps {
  workspace: Workspace;
  tabCount: number;
  onClose: () => void;
  onConfirm: (closeTabs: boolean) => void | Promise<void>;
}

export function DeleteWorkspaceDialog({ workspace, tabCount, onClose, onConfirm }: DeleteWorkspaceDialogProps) {
  const { t } = useI18n();
  const [closeTabs, setCloseTabs] = useState(false);
  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog-card confirm-card delete-workspace-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-workspace-title">
        <div className="confirm-icon"><CircleAlert aria-hidden="true" size={18} /></div>
        <h2 id="delete-workspace-title">{t("side.deleteTitle", { name: workspace.name })}</h2>
        <p>{closeTabs ? t("workspace.deleteWithTabsDescription", { count: tabCount }) : t("side.deleteDescription")}</p>
        {tabCount > 0 ? <label className="delete-tabs-option">
          <input type="checkbox" checked={closeTabs} onChange={(event) => setCloseTabs(event.target.checked)} />
          <span>
            <strong>{t("workspace.closeTabsOnDelete", { count: tabCount })}</strong>
            <small>{t("workspace.closeTabsWarning")}</small>
          </span>
        </label> : null}
        <div className="dialog-actions">
          <button className="button button-ghost" type="button" onClick={onClose}>{t("common.cancel")}</button>
          <button className="button button-danger" type="button" onClick={() => void onConfirm(closeTabs)}>{t("side.deleteWorkspace")}</button>
        </div>
      </section>
    </div>
  );
}
