import { useEffect, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import type { Workspace } from "../shared/contracts";
import { normalizeGroupColor } from "../shared/constants";
import type { WorkspaceDraft } from "../ui-state/model";
import { WORKSPACE_COLOR_OPTIONS } from "./workspaceColors";

interface WorkspaceDialogProps {
  open: boolean;
  windowKey: string;
  workspace?: Workspace;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (draft: WorkspaceDraft) => Promise<void> | void;
}

export function WorkspaceDialog({ open, windowKey, workspace, busy = false, onClose, onSubmit }: WorkspaceDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [color, setColor] = useState("grey");
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(workspace?.name ?? "");
    setDescription(workspace?.description ?? "");
    setTags(workspace?.tags.join(", ") ?? "");
    setColor(normalizeGroupColor(workspace?.color));
    setValidationError(null);
  }, [open, workspace]);

  const title = workspace ? "编辑工作区" : "新建工作区";
  if (!open) return null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) {
      setValidationError("请先填写工作区名称");
      return;
    }
    setValidationError(null);
    await onSubmit({
      windowKey,
      name: name.trim(),
      description: description.trim(),
      tags: tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      color
    });
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="workspace-dialog-title">
        <div className="dialog-heading">
          <div>
            <h2 id="workspace-dialog-title">{title}</h2>
            <p className="dialog-kicker">定义名称、用途和识别色。</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭">
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        <form onSubmit={submit}>
          <label className="field-label" htmlFor="workspace-name">
            名称 <span>*</span>
          </label>
          <input
            id="workspace-name"
            className="text-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：研究、工作、周末"
            autoFocus
            maxLength={48}
            aria-invalid={Boolean(validationError)}
            aria-describedby={validationError ? "workspace-form-error" : undefined}
          />
          <label className="field-label" htmlFor="workspace-description">
            描述 <small>可选</small>
          </label>
          <textarea
            id="workspace-description"
            className="text-input textarea"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="用一句话说明这个工作区的用途"
            rows={3}
            maxLength={160}
          />
          <label className="field-label" htmlFor="workspace-tags">
            标签 <small>逗号分隔</small>
          </label>
          <input
            id="workspace-tags"
            className="text-input"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="重要, 本周"
          />
          <fieldset className="field-group">
            <legend className="field-label">颜色</legend>
            <div className="color-options">
              {WORKSPACE_COLOR_OPTIONS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`color-option color-option-${key}`}
                  data-selected={color === key}
                  aria-label={`选择${label}`}
                  aria-pressed={color === key}
                  onClick={() => setColor(key)}
                />
              ))}
            </div>
          </fieldset>
          {validationError ? <p className="form-error" id="workspace-form-error">{validationError}</p> : <p className="field-helper">名称会同步到浏览器原生标签组。</p>}
          <div className="dialog-actions">
            <button className="button button-ghost" type="button" onClick={onClose} disabled={busy}>
              取消
            </button>
            <button className="button button-primary" type="submit" disabled={busy} aria-busy={busy}>
              {busy ? <><span className="spinner spinner-inline" />保存中…</> : workspace ? "保存修改" : "创建工作区"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
