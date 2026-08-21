import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Workspace } from "../shared/contracts";
import type { WorkspaceDraft } from "../ui-state/model";

const COLORS = [
  ["slate", "#64748b"],
  ["blue", "#3b82f6"],
  ["cyan", "#06b6d4"],
  ["green", "#22c55e"],
  ["amber", "#f59e0b"],
  ["rose", "#f43f5e"],
  ["violet", "#8b5cf6"]
] as const;

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
  const [color, setColor] = useState("slate");
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(workspace?.name ?? "");
    setDescription(workspace?.description ?? "");
    setTags(workspace?.tags.join(", ") ?? "");
    setColor(workspace?.color || "slate");
    setValidationError(null);
  }, [open, workspace]);

  const title = workspace ? "编辑工作区" : "新建工作区";
  const selectedColor = useMemo(() => COLORS.find(([key]) => key === color)?.[1] ?? "#64748b", [color]);

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
            <span className="eyebrow">WORKSPACE</span>
            <h2 id="workspace-dialog-title">{title}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭">
            ×
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
              {COLORS.map(([key, hex]) => (
                <button
                  key={key}
                  type="button"
                  className="color-option"
                  data-selected={color === key}
                  aria-label={`选择${key}色`}
                  aria-pressed={color === key}
                  onClick={() => setColor(key)}
                  style={{ "--option-color": hex } as React.CSSProperties}
                />
              ))}
            </div>
          </fieldset>
          {validationError ? <p className="form-error">{validationError}</p> : null}
          <div className="dialog-actions">
            <button className="button button-ghost" type="button" onClick={onClose} disabled={busy}>
              取消
            </button>
            <button className="button button-primary" type="submit" disabled={busy} style={{ "--button-accent": selectedColor } as React.CSSProperties}>
              {busy ? "保存中…" : workspace ? "保存修改" : "创建工作区"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
