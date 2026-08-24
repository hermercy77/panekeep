import { useEffect, useState, type FormEvent } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import type { Workspace } from "../shared/contracts";
import { normalizeGroupColor } from "../shared/constants";
import type { WorkspaceDraft } from "../ui-state/model";
import { WORKSPACE_COLOR_OPTIONS } from "./workspaceColors";
import { useI18n } from "../i18n/react";
import { WORKSPACE_ICON_KEYS, normalizeWorkspaceIcon, type WorkspaceIconKey } from "../shared/workspaceAppearance";
import { WorkspaceIcon } from "./WorkspaceIcon";

const ICON_LABEL_KEYS = {
  folder: "icon.folder",
  briefcase: "icon.briefcase",
  code: "icon.code",
  book: "icon.book",
  search: "icon.search",
  "file-text": "icon.fileText",
  palette: "icon.palette",
  message: "icon.message",
  calendar: "icon.calendar",
  plane: "icon.plane",
  "shopping-cart": "icon.shoppingCart",
  wallet: "icon.wallet",
  chart: "icon.chart",
  megaphone: "icon.megaphone",
  media: "icon.media",
  music: "icon.music",
  home: "icon.home",
  shield: "icon.shield"
} as const;

interface WorkspaceDialogProps {
  open: boolean;
  windowKey: string;
  workspace?: Workspace;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (draft: WorkspaceDraft) => Promise<void> | void;
}

export function WorkspaceDialog({ open, windowKey, workspace, busy = false, onClose, onSubmit }: WorkspaceDialogProps) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [color, setColor] = useState("grey");
  const [icon, setIcon] = useState<WorkspaceIconKey>("folder");
  const [showDetails, setShowDetails] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(workspace?.name ?? "");
    setDescription(workspace?.description ?? "");
    setTags(workspace?.tags.join(", ") ?? "");
    setColor(normalizeGroupColor(workspace?.color));
    setIcon(normalizeWorkspaceIcon(workspace?.icon));
    setShowDetails(Boolean(workspace?.description || workspace?.tags.length));
    setValidationError(null);
  }, [open, workspace]);

  const title = workspace ? t("workspace.editTitle") : t("workspace.newTitle");
  if (!open) return null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) {
      setValidationError(t("workspace.nameRequired"));
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
      color,
      icon
    });
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="workspace-dialog-title">
        <div className="dialog-heading">
          <h2 id="workspace-dialog-title">{title}</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label={t("common.close")}>
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        <form onSubmit={submit}>
          <label className="field-label" htmlFor="workspace-name">
            {t("workspace.name")} <span>*</span>
          </label>
          <input
            id="workspace-name"
            className="text-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("workspace.namePlaceholder")}
            autoFocus
            maxLength={48}
            aria-invalid={Boolean(validationError)}
            aria-describedby={validationError ? "workspace-form-error" : undefined}
            aria-required="true"
          />
          <fieldset className="field-group">
            <legend className="field-label">{t("workspace.color")}</legend>
            <div className="color-options">
              {WORKSPACE_COLOR_OPTIONS.map(([key, labelKey]) => (
                <button
                  key={key}
                  type="button"
                  className={`color-option color-option-${key}`}
                  data-selected={color === key}
                  aria-label={t("workspace.selectColor", { color: t(labelKey) })}
                  aria-pressed={color === key}
                  onClick={() => setColor(key)}
                />
              ))}
            </div>
          </fieldset>
          <fieldset className="field-group">
            <legend className="field-label">{t("workspace.icon")}</legend>
            <div className="icon-options">
              {WORKSPACE_ICON_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  className="icon-option"
                  data-selected={icon === key}
                  aria-label={t("workspace.selectIcon", { icon: t(ICON_LABEL_KEYS[key]) })}
                  aria-pressed={icon === key}
                  disabled={busy}
                  onClick={() => setIcon(key)}
                >
                  <WorkspaceIcon icon={key} size={16} />
                </button>
              ))}
            </div>
          </fieldset>
          <button className="details-toggle" type="button" onClick={() => setShowDetails((current) => !current)} aria-expanded={showDetails}>
            {showDetails ? <ChevronDown aria-hidden="true" size={15} /> : <ChevronRight aria-hidden="true" size={15} />}
            {t("workspace.details")}
            <span>{t("common.optional")}</span>
          </button>
          {showDetails ? (
            <div className="workspace-details-fields">
              <label className="field-label" htmlFor="workspace-description">{t("workspace.description")}</label>
              <textarea
                id="workspace-description"
                className="text-input textarea"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t("workspace.descriptionPlaceholder")}
                rows={3}
                maxLength={160}
              />
              <label className="field-label" htmlFor="workspace-tags">{t("workspace.tags")} <small>{t("workspace.commaSeparated")}</small></label>
              <input
                id="workspace-tags"
                className="text-input"
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                placeholder={t("workspace.tagsPlaceholder")}
              />
            </div>
          ) : null}
          {validationError ? <p className="form-error" id="workspace-form-error">{validationError}</p> : null}
          <div className="dialog-actions">
            <button className="button button-ghost" type="button" onClick={onClose} disabled={busy}>
              {t("common.cancel")}
            </button>
            <button className="button button-primary" type="submit" disabled={busy} aria-busy={busy}>
              {busy ? <><span className="spinner spinner-inline" />{t("common.saving")}</> : workspace ? t("common.saveChanges") : t("common.createWorkspace")}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
