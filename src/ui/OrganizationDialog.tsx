import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, RefreshCw, X } from "lucide-react";
import type { OrganizationMode, OrganizationPreview, TabRecord } from "../shared/contracts";
import { tabLabel } from "../ui-state/model";
import { useI18n } from "../i18n/react";
import { WorkspaceIcon } from "./WorkspaceIcon";
import { workspaceColorClass } from "./workspaceColors";

interface OrganizationDialogProps {
  open: boolean;
  destination?: string;
  tabs: TabRecord[];
  mode: OrganizationMode;
  preview: OrganizationPreview | null;
  loading: boolean;
  applying: boolean;
  error: string | null;
  onModeChange: (mode: OrganizationMode) => void;
  onGenerate: (mode: OrganizationMode, tabIds: string[]) => Promise<void>;
  onConfirm: (preview: OrganizationPreview) => Promise<void>;
  onClose: () => void;
}

export function OrganizationDialog({
  open,
  destination,
  tabs,
  mode,
  preview,
  loading,
  applying,
  error,
  onModeChange,
  onGenerate,
  onConfirm,
  onClose
}: OrganizationDialogProps) {
  const { t } = useI18n();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [selectedTabIds, setSelectedTabIds] = useState<Set<string>>(new Set());
  const [draftPreview, setDraftPreview] = useState<OrganizationPreview | null>(null);
  const wasOpenRef = useRef(false);
  const tabById = new Map(tabs.map((tab) => [tab.id, tab]));
  const selectableTabs = tabs.filter((tab) => (tab.kind === "normal" || tab.kind === "fixed") && !tab.specialReason);
  const unclassifiedIds = selectableTabs.filter((tab) => tab.kind === "normal" && !tab.pinned && tab.workspaceId === null).map((tab) => tab.id);
  const selectedFixedCount = selectableTabs.filter((tab) => tab.pinned && selectedTabIds.has(tab.id)).length;
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setSelectedTabIds(new Set(unclassifiedIds));
    } else if (open) {
      const selectableIds = new Set(selectableTabs.map((tab) => tab.id));
      setSelectedTabIds((current) => new Set([...current].filter((id) => selectableIds.has(id))));
    }
    wasOpenRef.current = open;
  }, [open, tabs]);
  useEffect(() => {
    setDraftPreview(preview ? {
      ...preview,
      sourceTabIds: [...preview.sourceTabIds],
      groups: preview.groups.map((group) => ({ ...group, tabIds: [...group.tabIds], tags: [...group.tags] })),
      unclassifiedTabIds: [...preview.unclassifiedTabIds]
    } : null);
  }, [preview]);
  if (!open) return null;
  const toggleGroup = (id: string) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const movePreviewTab = (tabId: string, targetGroupId: string | null) => {
    setDraftPreview((current) => {
      if (!current) return current;
      const groups = current.groups.map((group) => ({ ...group, tabIds: group.tabIds.filter((id) => id !== tabId) }));
      const unclassifiedTabIds = current.unclassifiedTabIds.filter((id) => id !== tabId);
      if (targetGroupId) groups.find((group) => group.id === targetGroupId)?.tabIds.push(tabId);
      else unclassifiedTabIds.push(tabId);
      return { ...current, groups: groups.filter((group) => group.tabIds.length > 0), unclassifiedTabIds };
    });
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="dialog-card organization-dialog" role="dialog" aria-modal="true" aria-labelledby="organization-dialog-title">
        <div className="dialog-heading">
          <h2 id="organization-dialog-title">{t("organize.title")}</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label={t("common.close")} disabled={applying}>
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        {!draftPreview ? (
          <>
            <div className="organization-toolbar">
              <div className="mode-options" role="radiogroup" aria-label={t("organize.mode")}>
                <label className={mode === "purpose" ? "mode-option selected" : "mode-option"}>
                  <input className="sr-only" type="radio" name="organization-mode" checked={mode === "purpose"} onChange={() => onModeChange("purpose")} disabled={loading || applying} />
                  <span>{t("organize.byPurpose")}</span>
                </label>
                <label className={mode === "type" ? "mode-option selected" : "mode-option"}>
                  <input className="sr-only" type="radio" name="organization-mode" checked={mode === "type"} onChange={() => onModeChange("type")} disabled={loading || applying} />
                  <span>{t("organize.byType")}</span>
                </label>
              </div>
              <span className="selection-count">{selectedTabIds.size} / {selectableTabs.length}</span>
            </div>
            <div className="organization-selection">
              <div className="selection-heading">
                <strong>{t("organize.selectTabs")}</strong>
                <div className="selection-actions" aria-label={t("organize.bulkSelect")}>
                  <button type="button" className="mini-button" onClick={() => setSelectedTabIds(new Set(unclassifiedIds))} disabled={loading || applying}>{t("common.unclassified")}</button>
                  <button type="button" className="mini-button" onClick={() => setSelectedTabIds(new Set(selectableTabs.map((tab) => tab.id)))} disabled={loading || applying}>{t("organize.selectAll")}</button>
                  <button type="button" className="mini-button" onClick={() => setSelectedTabIds(new Set())} disabled={loading || applying}>{t("organize.clear")}</button>
                </div>
              </div>
              <div className="selection-list">
                {selectableTabs.length ? selectableTabs.map((tab) => (
                  <label key={tab.id} className={tab.pinned ? "selection-item selection-item-fixed" : "selection-item"}>
                    <input
                      type="checkbox"
                      checked={selectedTabIds.has(tab.id)}
                      disabled={loading || applying}
                      onChange={(event) => setSelectedTabIds((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(tab.id);
                        else next.delete(tab.id);
                        return next;
                      })}
                    />
                    <span className="selection-item-label">{tabLabel(tab)}</span>
                    {tab.pinned ? <span className="selection-item-meta">{t("organize.fixed")}</span> : null}
                  </label>
                )) : <p className="selection-empty">{t("organize.noneFound")}</p>}
              </div>
              {selectedFixedCount ? <p className="selection-note">{t("organize.fixedWarning", { count: selectedFixedCount })}</p> : null}
            </div>
            <p className="organization-disclosure" role="note">
              {t("organize.dataDisclosure", { destination: destination || t("organize.configuredProvider") })}
            </p>
            {error ? <div className="inline-error">{error}</div> : null}
            <div className="dialog-actions organization-primary-actions" aria-live="polite">
              <button className="button button-primary" type="button" disabled={!selectedTabIds.size || loading || applying} onClick={() => void onGenerate(mode, [...selectedTabIds])} aria-busy={loading}>
                {loading ? <><span className="spinner spinner-inline" />{t("organize.analyzing")}</> : t("organize.generate")}
              </button>
            </div>
          </>
        ) : null}
        {draftPreview && !loading ? (
          <div className="preview-panel">
            <div className="preview-heading">
              <strong>{t("organize.preview")}</strong>
              <button className="mini-button" type="button" onClick={() => setDraftPreview(null)} disabled={applying}>{t("organize.modifySelection")}</button>
            </div>
            <div className="preview-summary">
              <span>{t("common.tabsCount", { count: draftPreview.sourceTabIds.length })}</span>
              <span>{t("common.workspacesCount", { count: draftPreview.groups.length })}</span>
            </div>
            {draftPreview.groups.length ? (
              <div className="preview-groups">
                {draftPreview.groups.map((group) => {
                  const expanded = expandedGroups.has(group.id);
                  return (
                    <div className="preview-group" key={group.id}>
                      <button className="preview-group-heading" type="button" onClick={() => toggleGroup(group.id)} aria-expanded={expanded}>
                        <span className="tree-chevron">{expanded ? <ChevronDown aria-hidden="true" size={14} /> : <ChevronRight aria-hidden="true" size={14} />}</span>
                        <span className={`workspace-icon workspace-icon-${workspaceColorClass(group.color)}`} aria-hidden="true"><WorkspaceIcon icon={group.icon} /></span>
                        <strong>{group.name}</strong>
                        <span className="count-badge">{group.tabIds.length}</span>
                      </button>
                      {expanded ? (
                        <div className="preview-tab-list">
                          {group.tabIds.map((tabId) => {
                            const tab = tabById.get(tabId);
                            return (
                              <label className="preview-tab-row" key={tabId}>
                                <span>{tab ? tabLabel(tab) : t("common.tabClosed")}</span>
                                <select value={group.id} onChange={(event) => movePreviewTab(tabId, event.target.value || null)} aria-label={t("organize.adjustAssignment", { tab: tab ? tabLabel(tab) : t("common.tabClosed") })}>
                                  {draftPreview.groups.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name}</option>)}
                                  <option value="">{t("common.unclassified")}</option>
                                </select>
                              </label>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : draftPreview.unclassifiedTabIds.length ? null : (
              <div className="empty-state compact">
                <strong>{t("organize.noneFound")}</strong>
                <span>{t("organize.noneFoundHint")}</span>
              </div>
            )}
            {draftPreview.unclassifiedTabIds.length ? (
              <div className="preview-unclassified-list">
                <p className="preview-note">{t("common.unclassified")}</p>
                {draftPreview.unclassifiedTabIds.map((tabId) => {
                  const tab = tabById.get(tabId);
                  return (
                    <label className="preview-tab-row" key={tabId}>
                      <span>{tab ? tabLabel(tab) : t("common.tabClosed")}</span>
                      <select value="" onChange={(event) => movePreviewTab(tabId, event.target.value || null)} aria-label={t("organize.adjustAssignment", { tab: tab ? tabLabel(tab) : t("common.tabClosed") })}>
                        <option value="">{t("common.unclassified")}</option>
                        {draftPreview.groups.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name}</option>)}
                      </select>
                    </label>
                  );
                })}
              </div>
            ) : null}
            {error ? <div className="inline-error">{error}</div> : null}
            <div className="dialog-actions">
              <button className="button button-ghost" type="button" onClick={() => {
                setDraftPreview(null);
                void onGenerate(mode, [...selectedTabIds]);
              }} disabled={applying || !selectedTabIds.size}>
                <RefreshCw aria-hidden="true" size={15} />{t("organize.regenerate")}
              </button>
              <button className="button button-primary" type="button" onClick={() => void onConfirm(draftPreview)} disabled={applying || !draftPreview.sourceTabIds.length}>
                {applying ? <><span className="spinner spinner-inline" />{t("organize.applying")}</> : <><Check aria-hidden="true" size={15} />{t("organize.confirmApply")}</>}
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
