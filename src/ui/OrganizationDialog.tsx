import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, LayoutGrid, RefreshCw, ScanLine, Target, X } from "lucide-react";
import type { OrganizationMode, OrganizationPreview, TabRecord } from "../shared/contracts";
import { tabLabel } from "../ui-state/model";

interface OrganizationDialogProps {
  open: boolean;
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
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [selectedTabIds, setSelectedTabIds] = useState<Set<string>>(new Set());
  const [draftPreview, setDraftPreview] = useState<OrganizationPreview | null>(null);
  const wasOpenRef = useRef(false);
  const tabById = new Map(tabs.map((tab) => [tab.id, tab]));
  const selectableTabs = tabs.filter((tab) => (tab.kind === "normal" || tab.kind === "fixed") && !tab.specialReason);
  const unclassifiedIds = selectableTabs.filter((tab) => tab.kind === "normal" && !tab.pinned && tab.workspaceId === null).map((tab) => tab.id);
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
      return { ...current, groups, unclassifiedTabIds };
    });
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="dialog-card organization-dialog" role="dialog" aria-modal="true" aria-labelledby="organization-dialog-title">
        <div className="dialog-heading">
          <div>
            <h2 id="organization-dialog-title">整理标签</h2>
            <p className="dialog-kicker">先生成方案，确认后才移动标签。</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭">
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        <p className="dialog-intro">先生成可审阅的建议，确认后才会移动标签或创建工作区。</p>
        <div className="mode-options" role="radiogroup" aria-label="整理方式">
          <label className={mode === "purpose" ? "mode-option selected" : "mode-option"}>
            <input type="radio" name="organization-mode" checked={mode === "purpose"} onChange={() => onModeChange("purpose")} />
            <Target aria-hidden="true" size={17} />
            <span>
              <strong>按目的</strong>
              <small>工作、研究、稍后阅读</small>
            </span>
          </label>
          <label className={mode === "type" ? "mode-option selected" : "mode-option"}>
            <input type="radio" name="organization-mode" checked={mode === "type"} onChange={() => onModeChange("type")} />
            <LayoutGrid aria-hidden="true" size={17} />
            <span>
              <strong>按类型</strong>
              <small>开发、资料、媒体、阅读</small>
            </span>
          </label>
        </div>
        <div className="organization-selection">
          <div className="selection-heading">
            <strong>选择本次整理的标签</strong>
            <span>{selectedTabIds.size} / {selectableTabs.length}</span>
          </div>
          {selectableTabs.some((tab) => tab.kind === "fixed") ? <p className="selection-note">固定标签默认不选中；如果手动选中，应用后会取消固定并加入工作区。</p> : null}
          <div className="selection-actions">
            <button type="button" className="mini-button" onClick={() => setSelectedTabIds(new Set(unclassifiedIds))}>全选未分类</button>
            <button type="button" className="mini-button" onClick={() => setSelectedTabIds(new Set(selectableTabs.map((tab) => tab.id)))}>全选</button>
            <button type="button" className="mini-button" onClick={() => setSelectedTabIds(new Set())}>清空</button>
          </div>
          <div className="selection-list">
            {selectableTabs.map((tab) => (
              <label key={tab.id} className="selection-item">
                <input
                  type="checkbox"
                  checked={selectedTabIds.has(tab.id)}
                  onChange={(event) => setSelectedTabIds((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(tab.id);
                    else next.delete(tab.id);
                    return next;
                  })}
                />
                <span>{tabLabel(tab)}</span>
              </label>
            ))}
          </div>
        </div>
        {!preview && !loading ? (
          <div className="organization-empty">
            <div className="empty-illustration"><ScanLine aria-hidden="true" size={22} /></div>
            <strong>准备好整理你的标签了吗？</strong>
            <p>AI 只会读取当前标签的标题和网址，并在确认后执行。</p>
            <button className="button button-primary" type="button" disabled={!selectedTabIds.size} onClick={() => void onGenerate(mode, [...selectedTabIds])}>
              生成整理预览
            </button>
          </div>
        ) : null}
        {loading ? (
          <div className="loading-panel" aria-live="polite">
            <span className="spinner" />
            正在分析标签…
          </div>
        ) : null}
        {error ? <div className="inline-error">{error}</div> : null}
        {draftPreview && !loading ? (
          <div className="preview-panel">
            <div className="preview-summary">
              <span>本次将处理 {draftPreview.sourceTabIds.length} 个标签</span>
              <span>{draftPreview.groups.length} 个建议工作区</span>
            </div>
            {draftPreview.groups.length ? (
              <div className="preview-groups">
                {draftPreview.groups.map((group) => {
                  const expanded = expandedGroups.has(group.id);
                  return (
                    <div className="preview-group" key={group.id}>
                      <button className="preview-group-heading" type="button" onClick={() => toggleGroup(group.id)} aria-expanded={expanded}>
                        <span className="tree-chevron">{expanded ? <ChevronDown aria-hidden="true" size={14} /> : <ChevronRight aria-hidden="true" size={14} />}</span>
                        <span className="workspace-dot workspace-dot-slate" aria-hidden="true" />
                        <strong>{group.name}</strong>
                        <span className="count-badge">{group.tabIds.length}</span>
                      </button>
                      {expanded ? (
                        <div className="preview-tab-list">
                          {group.tabIds.map((tabId) => {
                            const tab = tabById.get(tabId);
                            return (
                              <label className="preview-tab-row" key={tabId}>
                                <span>{tab ? tabLabel(tab) : "标签已关闭"}</span>
                                <select value={group.id} onChange={(event) => movePreviewTab(tabId, event.target.value || null)} aria-label={`调整${tab ? tabLabel(tab) : "标签"}归属`}>
                                  {draftPreview.groups.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name}</option>)}
                                  <option value="">未分类</option>
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
            ) : (
              <div className="empty-state compact">
                <strong>没有找到可整理的标签</strong>
                <span>固定标签和特殊页面会保留在原处。</span>
              </div>
            )}
            {draftPreview.unclassifiedTabIds.length ? (
              <div className="preview-unclassified-list">
                <p className="preview-note">未分类</p>
                {draftPreview.unclassifiedTabIds.map((tabId) => {
                  const tab = tabById.get(tabId);
                  return (
                    <label className="preview-tab-row" key={tabId}>
                      <span>{tab ? tabLabel(tab) : "标签已关闭"}</span>
                      <select value="" onChange={(event) => movePreviewTab(tabId, event.target.value || null)} aria-label={`调整${tab ? tabLabel(tab) : "标签"}归属`}>
                        <option value="">未分类</option>
                        {draftPreview.groups.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name}</option>)}
                      </select>
                    </label>
                  );
                })}
              </div>
            ) : null}
            <div className="dialog-actions">
              <button className="button button-ghost" type="button" onClick={() => void onGenerate(mode, [...selectedTabIds])} disabled={applying || !selectedTabIds.size}>
                <RefreshCw aria-hidden="true" size={15} />重新生成
              </button>
              <button className="button button-primary" type="button" onClick={() => void onConfirm(draftPreview)} disabled={applying || !draftPreview.groups.length}>
                {applying ? <><span className="spinner spinner-inline" />应用中…</> : <><Check aria-hidden="true" size={15} />确认并应用</>}
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
