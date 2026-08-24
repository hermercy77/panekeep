import { ArrowRight, GitMerge, X } from "lucide-react";
import type { Workspace, WorkspaceMergePreview } from "../shared/contracts";
import { useI18n } from "../i18n/react";
import { workspaceColorClass } from "./workspaceColors";
import { WorkspaceIcon } from "./WorkspaceIcon";

interface WorkspaceMergeDialogProps {
  preview: WorkspaceMergePreview | null;
  source?: Workspace;
  target?: Workspace;
  targetTabCount: number;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (preview: WorkspaceMergePreview) => void;
}

export function WorkspaceMergeDialog({
  preview,
  source,
  target,
  targetTabCount,
  busy,
  error,
  onClose,
  onConfirm
}: WorkspaceMergeDialogProps) {
  const { t } = useI18n();
  if (!preview || !source || !target) return null;
  const sourceCount = preview.sourceTabIds.length;

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <section className="dialog-card merge-dialog" role="dialog" aria-modal="true" aria-labelledby="merge-dialog-title">
        <div className="dialog-heading">
          <h2 id="merge-dialog-title">{t("merge.title")}</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label={t("common.close")} disabled={busy}>
            <X aria-hidden="true" size={18} />
          </button>
        </div>

        <div className="merge-flow" aria-hidden="true">
          <div className="merge-workspace">
            <span className={`workspace-icon workspace-icon-${workspaceColorClass(source.color)}`}><WorkspaceIcon icon={source.icon} /></span>
            <strong>{source.name}</strong>
            <b>{sourceCount}</b>
          </div>
          <ArrowRight size={18} />
          <div className="merge-workspace target">
            <span className={`workspace-icon workspace-icon-${workspaceColorClass(target.color)}`}><WorkspaceIcon icon={target.icon} /></span>
            <strong>{target.name}</strong>
            <b>{targetTabCount}</b>
          </div>
        </div>

        <p className="merge-summary">{t("merge.summary", { source: source.name, target: target.name, sourceCount })}</p>
        {preview.sourceWindowKey !== preview.targetWindowKey ? <p className="merge-window-note">{t("merge.crossWindow")}</p> : null}
        {error ? <p className="inline-error" role="alert">{error}</p> : null}
        <div className="dialog-actions">
          <button className="button button-ghost" type="button" onClick={onClose} disabled={busy}>{t("common.cancel")}</button>
          <button className="button button-danger" type="button" onClick={() => onConfirm(preview)} disabled={busy} aria-busy={busy}>
            {busy ? <><span className="spinner spinner-inline" />{t("merge.applying")}</> : <><GitMerge aria-hidden="true" size={15} />{t("merge.confirm")}</>}
          </button>
        </div>
      </section>
    </div>
  );
}
