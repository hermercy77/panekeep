import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Palette, Plus, RefreshCw, Settings2, X } from "lucide-react";
import type { AIProfile, OrganizationMode, OrganizationPreview, TabRecord } from "../shared/contracts";
import { tabLabel } from "../ui-state/model";
import { useI18n } from "../i18n/react";
import { WorkspaceIcon } from "./WorkspaceIcon";
import { WORKSPACE_COLOR_OPTIONS, workspaceColorClass } from "./workspaceColors";
import { WORKSPACE_ICON_KEYS, type WorkspaceIconKey } from "../shared/workspaceAppearance";
import { Modal } from "./Modal";

interface OrganizationDialogProps {
  open: boolean;
  destination?: string;
  profiles?: AIProfile[];
  activeProfileId?: string | null;
  onSelectProfile?: (profileId: string) => void;
  tabs: TabRecord[];
  mode: OrganizationMode;
  preview: OrganizationPreview | null;
  loading: boolean;
  applying: boolean;
  error: string | null;
  onModeChange: (mode: OrganizationMode) => void;
  onGenerate: (mode: OrganizationMode, tabIds: string[]) => Promise<void>;
  onConfirm: (preview: OrganizationPreview) => Promise<void>;
  onOpenSettings?: () => void;
  onClose: () => void;
}

export function OrganizationDialog({
  open,
  destination,
  profiles = [],
  activeProfileId = null,
  onSelectProfile,
  tabs,
  mode,
  preview,
  loading,
  applying,
  error,
  onModeChange,
  onGenerate,
  onConfirm,
  onOpenSettings,
  onClose
}: OrganizationDialogProps) {
  const { t } = useI18n();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [editingStyleGroupId, setEditingStyleGroupId] = useState<string | null>(null);
  const [selectedTabIds, setSelectedTabIds] = useState<Set<string>>(new Set());
  const [draftPreview, setDraftPreview] = useState<OrganizationPreview | null>(null);
  const wasOpenRef = useRef(false);
  const customGroupCounterRef = useRef(1);
  const tabById = new Map(tabs.map((tab) => [tab.id, tab]));
  const selectableTabs = tabs.filter((tab) => (tab.kind === "normal" || tab.kind === "fixed") && !tab.specialReason);
  const unclassifiedIds = selectableTabs.filter((tab) => tab.kind === "normal" && !tab.pinned && tab.workspaceId === null).map((tab) => tab.id);
  const selectedFixedCount = selectableTabs.filter((tab) => tab.pinned && selectedTabIds.has(tab.id)).length;

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setSelectedTabIds(new Set(unclassifiedIds));
      setEditingStyleGroupId(null);
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
    setExpandedGroups(preview ? new Set(preview.groups.map((group) => group.id)) : new Set());
    setEditingStyleGroupId(null);
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

  const allExpanded = Boolean(draftPreview?.groups.length && draftPreview.groups.every((group) => expandedGroups.has(group.id)));
  const toggleAllGroups = () => {
    if (!draftPreview) return;
    setExpandedGroups(allExpanded ? new Set() : new Set(draftPreview.groups.map((group) => group.id)));
  };

  const movePreviewTab = (tabId: string, targetGroupId: string | null) => {
    setDraftPreview((current) => {
      if (!current) return current;
      const groups = current.groups.map((group) => ({ ...group, tabIds: group.tabIds.filter((id) => id !== tabId) }));
      const unclassifiedTabIds = current.unclassifiedTabIds.filter((id) => id !== tabId);
      if (targetGroupId) groups.find((group) => group.id === targetGroupId)?.tabIds.push(tabId);
      else unclassifiedTabIds.push(tabId);
      return {
        ...current,
        groups: groups.filter((group) => group.tabIds.length > 0 || group.id.startsWith("custom-group-")),
        unclassifiedTabIds
      };
    });
  };

  const updatePreviewGroup = (
    groupId: string,
    patch: Partial<Pick<OrganizationPreview["groups"][number], "name" | "color" | "icon">>
  ) => {
    setDraftPreview((current) => {
      if (!current) return current;
      return {
        ...current,
        groups: current.groups.map((group) => (group.id === groupId ? { ...group, ...patch } : group))
      };
    });
  };

  const addCustomGroup = () => {
    setDraftPreview((current) => {
      if (!current) return current;
      const index = customGroupCounterRef.current++;
      const id = `custom-group-${index}`;
      const newGroup = {
        id,
        name: t("organize.newGroupName", { count: index }),
        description: "",
        tags: [],
        icon: "folder" as WorkspaceIconKey,
        color: "blue",
        existingWorkspaceId: null,
        tabIds: []
      };
      setExpandedGroups((expanded) => new Set(expanded).add(id));
      return { ...current, groups: [...current.groups, newGroup] };
    });
  };

  const confirmDraft = () => {
    if (!draftPreview) return;
    const sanitizedGroups = draftPreview.groups
      .filter((group) => group.tabIds.length > 0)
      .map((group, index) => ({
        ...group,
        name: group.name.trim() || t("organize.newGroupName", { count: index + 1 })
      }));
    void onConfirm({ ...draftPreview, groups: sanitizedGroups });
  };

  return (
    <Modal open={open} onClose={onClose} canClose={!applying} labelledBy="organization-dialog-title" cardClassName="organization-dialog">
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
          {profiles.length > 1 && onSelectProfile ? (
            <label className="ai-profile-switcher">
              <span>{t("organize.aiProfile")}</span>
              <select
                value={activeProfileId ?? profiles[0]?.id ?? ""}
                disabled={loading || applying}
                aria-label={t("organize.aiProfile")}
                onChange={(event) => onSelectProfile(event.target.value)}
              >
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>{profile.name}</option>
                ))}
              </select>
            </label>
          ) : null}
          <p className="organization-disclosure" role="note">
            {t("organize.dataDisclosure", { destination: destination || t("organize.configuredProvider") })}
          </p>
          {error ? (
            <div className="inline-error-row" role="alert">
              <div className="inline-error">{error}</div>
              {onOpenSettings ? (
                <button type="button" className="mini-button" onClick={onOpenSettings}>
                  <Settings2 aria-hidden="true" size={14} />{t("organize.openSettings")}
                </button>
              ) : null}
            </div>
          ) : null}
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
            <div className="preview-heading-actions">
              {draftPreview.groups.length > 0 ? (
                <button className="mini-button" type="button" onClick={toggleAllGroups} disabled={applying}>
                  {allExpanded ? t("organize.collapseAll") : t("organize.expandAll")}
                </button>
              ) : null}
              <button className="mini-button" type="button" onClick={addCustomGroup} disabled={applying}>
                <Plus aria-hidden="true" size={13} />{t("organize.addGroup")}
              </button>
              <button className="mini-button" type="button" onClick={() => setDraftPreview(null)} disabled={applying}>{t("organize.modifySelection")}</button>
            </div>
          </div>
          <div className="preview-summary">
            <span>{t("common.tabsCount", { count: draftPreview.sourceTabIds.length })}</span>
            <span>{t("common.workspacesCount", { count: draftPreview.groups.filter((group) => group.tabIds.length > 0).length })}</span>
          </div>
          {draftPreview.groups.length ? (
            <div className="preview-groups">
              {draftPreview.groups.map((group) => {
                const expanded = expandedGroups.has(group.id);
                const editable = group.existingWorkspaceId === null;
                const styleOpen = editingStyleGroupId === group.id;
                return (
                  <div className="preview-group" key={group.id}>
                    <div className="preview-group-bar">
                      <button className="preview-group-heading" type="button" onClick={() => toggleGroup(group.id)} aria-expanded={expanded}>
                        <span className="tree-chevron">{expanded ? <ChevronDown aria-hidden="true" size={14} /> : <ChevronRight aria-hidden="true" size={14} />}</span>
                        <span className={`workspace-icon workspace-icon-${workspaceColorClass(group.color)}`} aria-hidden="true"><WorkspaceIcon icon={group.icon} /></span>
                        {!editable ? <strong>{group.name}</strong> : null}
                      </button>
                      {editable ? (
                        <input
                          className="preview-group-name-input"
                          value={group.name}
                          maxLength={48}
                          disabled={applying}
                          aria-label={t("organize.editGroupName")}
                          onChange={(event) => updatePreviewGroup(group.id, { name: event.target.value })}
                        />
                      ) : null}
                      {editable ? (
                        <button
                          className="mini-icon-button"
                          type="button"
                          disabled={applying}
                          aria-expanded={styleOpen}
                          aria-label={t("organize.editGroupStyle")}
                          title={t("organize.editGroupStyle")}
                          onClick={() => setEditingStyleGroupId((current) => current === group.id ? null : group.id)}
                        >
                          <Palette aria-hidden="true" size={14} />
                        </button>
                      ) : null}
                      <span className="count-badge">{group.tabIds.length}</span>
                    </div>
                    {editable && styleOpen ? (
                      <div className="preview-style-picker">
                        <div className="preview-color-row">
                          {WORKSPACE_COLOR_OPTIONS.map(([key, labelKey]) => (
                            <button
                              key={key}
                              type="button"
                              className={`color-option preview-color-dot color-option-${key}`}
                              data-selected={group.color === key}
                              aria-label={t("workspace.selectColor", { color: t(labelKey) })}
                              onClick={() => updatePreviewGroup(group.id, { color: key })}
                            />
                          ))}
                        </div>
                        <div className="preview-icon-row">
                          {WORKSPACE_ICON_KEYS.map((key) => (
                            <button
                              key={key}
                              type="button"
                              className="icon-option preview-icon-dot"
                              data-selected={group.icon === key}
                              aria-label={key}
                              onClick={() => updatePreviewGroup(group.id, { icon: key })}
                            >
                              <WorkspaceIcon icon={key} size={13} />
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {expanded ? (
                      <div className="preview-tab-list">
                        {group.tabIds.length ? group.tabIds.map((tabId) => {
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
                        }) : <span className="preview-note">{t("tree.dropHere")}</span>}
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
          {error ? <div className="inline-error" role="alert">{error}</div> : null}
          <div className="dialog-actions">
            <button className="button button-ghost" type="button" onClick={() => {
              setDraftPreview(null);
              void onGenerate(mode, [...selectedTabIds]);
            }} disabled={applying || !selectedTabIds.size}>
              <RefreshCw aria-hidden="true" size={15} />{t("organize.regenerate")}
            </button>
            <button className="button button-primary" type="button" onClick={confirmDraft} disabled={applying || !draftPreview.sourceTabIds.length}>
              {applying ? <><span className="spinner spinner-inline" />{t("organize.applying")}</> : <><Check aria-hidden="true" size={15} />{t("organize.confirmApply")}</>}
            </button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
