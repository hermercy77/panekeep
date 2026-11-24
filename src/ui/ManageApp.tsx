import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, CircleAlert, CircleCheck, DatabaseBackup, Download, Eye, EyeOff, Plus, Rows3, Settings2, Upload, X } from "lucide-react";
import { isWorkspaceClosableTab, type AIConfig, type AIProfile, type AISettings, type Workspace } from "../shared/contracts";
import { usePaneKeepState } from "../ui-state/usePaneKeepState";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { createAIConfigStore, DEFAULT_AI_CONFIG, normalizeAIConfig } from "../ai/config";
import { createOpenAICompatibleClient } from "../ai/client";
import { AI_PROVIDER_PRESETS, getAIProviderPreset, inferAIProviderId } from "../ai/providers";
import { workspaceColorClass } from "./workspaceColors";
import { useI18n } from "../i18n/react";
import { APP_LANGUAGES, type AppLanguage } from "../i18n/catalog";
import type { BackupImportSkippedTab } from "../shared/backup";
import { WorkspaceIcon } from "./WorkspaceIcon";
import { DeleteWorkspaceDialog } from "./DeleteWorkspaceDialog";
import { BrandMark } from "./BrandMark";

function sidepanelUrl(): string {
  try {
    const browser = (globalThis as { chrome?: { runtime?: { getURL?: (path: string) => string } } }).chrome;
    return browser?.runtime?.getURL?.("sidepanel.html") ?? "sidepanel.html";
  } catch {
    return "sidepanel.html";
  }
}

function normalizeOrigin(value: string): string | null {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

export function ManageApp() {
  const { language, setLanguage, t } = useI18n();
  const state = usePaneKeepState();
  const { snapshot } = state;
  const [dialog, setDialog] = useState<{ windowKey: string; workspace?: Workspace } | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Workspace | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [aiSettings, setAiSettings] = useState<AISettings>({ activeProfileId: null, profiles: [] });
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState("");
  const [aiConfig, setAiConfig] = useState<AIConfig>(DEFAULT_AI_CONFIG);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [testingAI, setTestingAI] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [skippedImportTabs, setSkippedImportTabs] = useState<BackupImportSkippedTab[]>([]);
  const [activeSection, setActiveSection] = useState("workspaces");
  const importInput = useRef<HTMLInputElement>(null);
  const keyBoundOriginRef = useRef<string | null>(null);
  const aiStore = useMemo(() => createAIConfigStore(), []);

  const loadProfileIntoForm = (profile: AIProfile | null) => {
    if (!profile) {
      setEditingProfileId(null);
      setProfileName("");
      setAiConfig({ ...DEFAULT_AI_CONFIG });
      keyBoundOriginRef.current = null;
      setAvailableModels([]);
      setShowApiKey(false);
      return;
    }
    setEditingProfileId(profile.id);
    setProfileName(profile.name);
    setAiConfig({
      providerId: profile.providerId,
      baseUrl: profile.baseUrl,
      apiKey: profile.apiKey,
      model: profile.model
    });
    keyBoundOriginRef.current = profile.apiKey ? normalizeOrigin(profile.baseUrl) : null;
    setAvailableModels([]);
    setShowApiKey(false);
  };

  useEffect(() => {
    void aiStore.loadSettings().then((settings) => {
      setAiSettings(settings);
      const active = settings.profiles.find((item) => item.id === settings.activeProfileId) ?? settings.profiles[0] ?? null;
      loadProfileIntoForm(active);
    }).catch(() => undefined);
  }, [aiStore]);

  useEffect(() => {
    if (!("IntersectionObserver" in globalThis)) return;
    const sections = ["workspaces", "ai-settings", "backup"]
      .map((id) => document.getElementById(id))
      .filter((section): section is HTMLElement => Boolean(section));
    const observer = new IntersectionObserver((entries) => {
      const current = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => Math.abs(left.boundingClientRect.top) - Math.abs(right.boundingClientRect.top))[0];
      if (current?.target.id) setActiveSection(current.target.id);
    }, { rootMargin: "-20% 0px -60%", threshold: [0, 0.2, 0.6] });
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  const currentWindowKey = snapshot.windows.find((window) => window.isCurrent)?.key ?? snapshot.windows[0]?.key ?? "window:unknown";
  const tabsForWorkspace = (workspaceId: string) => snapshot.tabs.filter((tab) => isWorkspaceClosableTab(tab, workspaceId)).length;

  const openCreate = () => setDialog({ windowKey: currentWindowKey });
  const openEdit = (workspace: Workspace) => setDialog({ windowKey: workspace.windowKey, workspace });
  const submit = async (draft: Parameters<typeof state.createWorkspace>[0]) => {
    setBusy(true);
    const saved = dialog?.workspace ? await state.updateWorkspace(dialog.workspace.id, draft) : await state.createWorkspace(draft);
    setBusy(false);
    if (saved) {
      setDialog(null);
    }
  };
  const remove = async (closeTabs: boolean) => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setDeleteBusy(true);
    const ok = await state.deleteWorkspace(id, closeTabs);
    setDeleteBusy(false);
    if (ok) setDeleteTarget(null);
  };

  const exportBackup = async () => {
    const payload = await state.exportBackup();
    if (!payload) return;
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `panekeep-backup-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice({ tone: "success", message: t("notice.backupExported") });
  };

  const saveAI = async () => {
    try {
      const { settings, profile } = await aiStore.saveProfile({
        ...(editingProfileId ? { id: editingProfileId } : {}),
        name: profileName,
        ...aiConfig
      }, { activate: true });
      setAiSettings(settings);
      setEditingProfileId(profile.id);
      setProfileName(profile.name);
      keyBoundOriginRef.current = profile.apiKey ? normalizeOrigin(profile.baseUrl) : null;
      setAiConfig({
        providerId: profile.providerId,
        baseUrl: profile.baseUrl,
        apiKey: profile.apiKey,
        model: profile.model
      });
      setNotice({ tone: "success", message: t("notice.aiSaved") });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : t("notice.aiSaveFailed") });
    }
  };

  const startNewAIProfile = () => {
    loadProfileIntoForm(null);
    setNotice(null);
  };

  const activateAIProfile = async (profileId: string) => {
    try {
      const settings = await aiStore.setActiveProfile(profileId);
      setAiSettings(settings);
      const selected = settings.profiles.find((item) => item.id === profileId) ?? null;
      if (selected) loadProfileIntoForm(selected);
      setNotice({ tone: "success", message: t("notice.aiProfileActivated") });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : t("notice.aiSaveFailed") });
    }
  };

  const removeAIProfile = async (profileId: string) => {
    try {
      const settings = await aiStore.deleteProfile(profileId);
      setAiSettings(settings);
      if (editingProfileId === profileId) {
        const next = settings.profiles.find((item) => item.id === settings.activeProfileId) ?? settings.profiles[0] ?? null;
        loadProfileIntoForm(next);
      }
      setNotice({ tone: "success", message: t("notice.aiProfileDeleted") });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : t("notice.aiSaveFailed") });
    }
  };

  const changeProvider = (providerId: string) => {
    const preset = getAIProviderPreset(providerId);
    keyBoundOriginRef.current = null;
    setAiConfig({
      providerId,
      baseUrl: preset?.baseUrl ?? "",
      apiKey: "",
      model: ""
    });
    setAvailableModels([]);
    setNotice(null);
  };

  const changeBaseUrl = (baseUrl: string) => {
    const nextOrigin = normalizeOrigin(baseUrl);
    const boundOrigin = keyBoundOriginRef.current;
    const hostChanged = Boolean(aiConfig.apiKey && boundOrigin && nextOrigin && nextOrigin !== boundOrigin);
    if (hostChanged) {
      keyBoundOriginRef.current = null;
      setNotice({ tone: "error", message: t("notice.apiKeyClearedForNewHost") });
    } else if (aiConfig.apiKey && !boundOrigin && nextOrigin) {
      keyBoundOriginRef.current = nextOrigin;
    }
    setAiConfig({
      ...aiConfig,
      baseUrl,
      providerId: inferAIProviderId(baseUrl),
      ...(hostChanged ? { apiKey: "" } : {})
    });
    setAvailableModels([]);
  };

  const changeApiKey = (apiKey: string) => {
    keyBoundOriginRef.current = apiKey.trim() ? normalizeOrigin(aiConfig.baseUrl) : null;
    setAiConfig({ ...aiConfig, apiKey });
  };

  const testAI = async () => {
    setTestingAI(true);
    setNotice(null);
    try {
      const config = normalizeAIConfig(aiConfig);
      const result = await createOpenAICompatibleClient(config).testConnection();
      setAvailableModels(result.models);
      const configuredModelMissing = Boolean(config.model && result.models.length && !result.models.includes(config.model));
      setNotice({
        tone: configuredModelMissing ? "error" : "success",
        message: t(configuredModelMissing
          ? "notice.configuredModelUnavailable"
          : result.models.length
            ? "notice.connectionSucceeded"
            : "notice.connectionSucceededNoModels")
      });
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : t("notice.connectionFailed") });
    } finally {
      setTestingAI(false);
    }
  };

  const importBackup = async (file: File) => {
    setFileError(null);
    setSkippedImportTabs([]);
    try {
      const text = await file.text();
      const result = await state.importBackup(text);
      if (result) {
        setSkippedImportTabs(result.skippedTabs);
        setNotice({ tone: "success", message: t("notice.backupImported") });
      }
    } catch (error) {
      setFileError(error instanceof Error ? error.message : t("notice.backupImportFailed"));
    }
  };

  const renderAIEditorForm = () => (
    <div className="settings-card ai-profile-drawer">
      <p className="settings-disclosure">{t("manage.aiDataDisclosure")}</p>
      <div className="settings-form-grid">
        <div className="settings-field">
          <label className="field-label" htmlFor="ai-profile-name">{t("manage.profileName")} <small>{t("common.optional")}</small></label>
          <input
            id="ai-profile-name"
            className="text-input"
            disabled={testingAI}
            value={profileName}
            maxLength={48}
            onChange={(event) => setProfileName(event.target.value)}
            placeholder={t("manage.profileNamePlaceholder")}
          />
        </div>
        <div className="settings-field">
          <label className="field-label" htmlFor="ai-provider">{t("manage.provider")}</label>
          <select id="ai-provider" className="text-input provider-select" disabled={testingAI} value={getAIProviderPreset(aiConfig.providerId) ? aiConfig.providerId : "custom"} onChange={(event) => changeProvider(event.target.value)}>
            <optgroup label={t("manage.providerGlobal")}>
              {AI_PROVIDER_PRESETS.filter((provider) => provider.market === "global").map((provider) => <option key={provider.id} value={provider.id}>{t(provider.nameKey)}</option>)}
            </optgroup>
            <optgroup label={t("manage.providerChina")}>
              {AI_PROVIDER_PRESETS.filter((provider) => provider.market === "china").map((provider) => <option key={provider.id} value={provider.id}>{t(provider.nameKey)}</option>)}
            </optgroup>
            <option value="custom">{t("manage.providerCustom")}</option>
          </select>
        </div>
      </div>
      <label className="field-label" htmlFor="ai-base-url">{t("manage.baseUrl")}</label>
      <input id="ai-base-url" className="text-input" disabled={testingAI} value={aiConfig.baseUrl} onChange={(event) => changeBaseUrl(event.target.value)} />
      <div className="settings-form-grid">
        <div className="settings-field">
          <label className="field-label" htmlFor="ai-key">{t("manage.apiKey")}</label>
          <div className="api-key-input-wrap">
            <input id="ai-key" className="text-input" disabled={testingAI} type={showApiKey ? "text" : "password"} value={aiConfig.apiKey} onChange={(event) => changeApiKey(event.target.value)} placeholder={t("manage.keyPlaceholder")} />
            <button
              className="api-key-visibility-button"
              type="button"
              disabled={testingAI}
              aria-label={showApiKey ? t("manage.hideApiKey") : t("manage.showApiKey")}
              title={showApiKey ? t("manage.hideApiKey") : t("manage.showApiKey")}
              onClick={() => setShowApiKey((current) => !current)}
            >
              {showApiKey ? <EyeOff aria-hidden="true" size={15} /> : <Eye aria-hidden="true" size={15} />}
            </button>
            <button className="connection-test-button" type="button" onClick={() => void testAI()} disabled={testingAI}>{testingAI ? t("manage.testingCompact") : t("manage.testConnection")}</button>
          </div>
        </div>
        <div className="settings-field">
          <label className="field-label" htmlFor="ai-model">{t("manage.model")}</label>
          <input id="ai-model" className="text-input" list={availableModels.length ? "ai-model-options" : undefined} disabled={testingAI} value={aiConfig.model} onChange={(event) => setAiConfig({ ...aiConfig, model: event.target.value })} placeholder={t("manage.modelPlaceholder")} autoComplete="off" />
          <datalist id="ai-model-options">{availableModels.map((model) => <option key={model} value={model} />)}</datalist>
        </div>
      </div>
      {availableModels.length ? (
        <div className="model-suggestions" role="listbox" aria-label={t("manage.availableModels")}>
          {availableModels
            .filter((model) => !aiConfig.model.trim() || availableModels.includes(aiConfig.model) || model.toLowerCase().includes(aiConfig.model.trim().toLowerCase()))
            .slice(0, 24)
            .map((model) => (
              <button
                key={model}
                type="button"
                role="option"
                aria-selected={aiConfig.model === model}
                className={aiConfig.model === model ? "model-chip active" : "model-chip"}
                disabled={testingAI}
                onClick={() => setAiConfig({ ...aiConfig, model })}
              >
                {model}
              </button>
            ))}
        </div>
      ) : null}
      <div className="settings-actions"><button className="button button-primary" type="button" disabled={testingAI} onClick={() => void saveAI()}>{t("manage.saveSettings")}</button></div>
    </div>
  );

  return (
    <main className="app-shell manage-shell">
      <header className="manage-header">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><BrandMark size={20} /></div>
          <div>
            <h1>{t("brand.name")}</h1>
            <p>{t("manage.subtitle")}</p>
          </div>
        </div>
        <div className="manage-header-actions">
          <label className="language-control">
            <span>{t("language.label")}</span>
            <select value={language} onChange={(event) => void setLanguage(event.target.value as AppLanguage)} aria-label={t("language.label")}>
              {APP_LANGUAGES.map((value) => <option key={value} value={value}>{t(value === "zh-CN" ? "language.zhCN" : "language.en")}</option>)}
            </select>
          </label>
          <a className="button button-ghost manage-back-button" href={sidepanelUrl()} aria-label={t("manage.backToSide")} title={t("manage.backToSide")}><ArrowLeft aria-hidden="true" size={15} /><span className="manage-back-label">{t("manage.backToSide")}</span></a>
        </div>
      </header>
      <div className="manage-layout">
        <aside className="manage-nav" aria-label={t("manage.navigation")}>
          <a className={activeSection === "workspaces" ? "manage-nav-item active" : "manage-nav-item"} href="#workspaces" onClick={() => setActiveSection("workspaces")} aria-current={activeSection === "workspaces" ? "page" : undefined}><Rows3 aria-hidden="true" size={16} />{t("manage.workspaces")} <span>{snapshot.workspaces.length}</span></a>
          <a className={activeSection === "ai-settings" ? "manage-nav-item active" : "manage-nav-item"} href="#ai-settings" onClick={() => setActiveSection("ai-settings")} aria-current={activeSection === "ai-settings" ? "page" : undefined}><Settings2 aria-hidden="true" size={16} />{t("manage.aiSettings")} <span>{aiSettings.profiles.length}</span></a>
          <a className={activeSection === "backup" ? "manage-nav-item active" : "manage-nav-item"} href="#backup" onClick={() => setActiveSection("backup")} aria-current={activeSection === "backup" ? "page" : undefined}><DatabaseBackup aria-hidden="true" size={16} />{t("manage.backupRestore")}</a>
        </aside>
        <section className="manage-content">
          {state.error ? <div className="error-banner" role="alert"><CircleAlert aria-hidden="true" size={17} /><p>{state.error}</p><button type="button" onClick={state.clearError} aria-label={t("side.closeError")}><X aria-hidden="true" size={14} /></button></div> : null}
          {notice ? <div className={notice.tone === "success" ? "success-banner" : "error-banner"} role={notice.tone === "success" ? "status" : "alert"}>{notice.tone === "success" ? <CircleCheck aria-hidden="true" size={17} /> : <CircleAlert aria-hidden="true" size={17} />}<p>{notice.message}</p><button type="button" onClick={() => setNotice(null)} aria-label={t("manage.closeNotice")}><X aria-hidden="true" size={14} /></button></div> : null}

          <section className="manage-section" id="workspaces">
            <div className="editorial-section-head">
              <div className="editorial-tab-row">
                <h2 className="editorial-tab">{t("manage.workspaces")}</h2>
                <button className="button button-primary" type="button" onClick={openCreate}><Plus aria-hidden="true" size={15} />{t("common.newWorkspace")}</button>
              </div>
              <p className="editorial-section-desc">{t("manage.workspaceDescription")}</p>
            </div>
            {state.status === "loading" && !snapshot.workspaces.length ? <div className="loading-panel"><span className="spinner" />{t("manage.loadingWorkspaces")}</div> : null}
            {state.status !== "loading" && !snapshot.workspaces.length ? (
              <div className="empty-state manage-empty"><div className="empty-illustration"><Rows3 aria-hidden="true" size={22} /></div><strong>{t("manage.noWorkspaces")}</strong><span>{t("manage.noWorkspacesHint")}</span><button className="button button-primary" type="button" onClick={openCreate}><Plus aria-hidden="true" size={15} />{t("common.createWorkspace")}</button></div>
            ) : null}
            <div className="workspace-card-grid">
              {[...snapshot.workspaces].sort((a, b) => a.order - b.order).map((workspace) => {
                return (
                  <article className="workspace-card" key={workspace.id}>
                    <div className="workspace-card-body">
                      <div className="workspace-card-heading">
                        <span className={`workspace-icon workspace-icon-${workspaceColorClass(workspace.color)}`} aria-hidden="true"><WorkspaceIcon icon={workspace.icon} size={15} /></span>
                        <h3>{workspace.name}</h3>
                        <span className="workspace-card-count">{t("common.tabsCount", { count: tabsForWorkspace(workspace.id) })}</span>
                      </div>
                      {workspace.description ? <p className="workspace-card-description">{workspace.description}</p> : null}
                      <div className="workspace-card-bottom">
                        {workspace.tags.length ? <div className="tag-list">{workspace.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}</div> : null}
                        <div className="card-actions">
                          <button className="mini-button" type="button" onClick={(event) => { event.stopPropagation(); openEdit(workspace); }}>{t("common.edit")}</button>
                          <button className="mini-button danger" type="button" onClick={(event) => { event.stopPropagation(); setDeleteTarget(workspace); }}>{t("common.delete")}</button>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="manage-section split-section" id="ai-settings">
            <div className="editorial-section-head">
              <div className="editorial-tab-row">
                <h2 className="editorial-tab">{t("manage.aiSettings")}</h2>
                <button className="button button-ghost" type="button" disabled={testingAI} onClick={startNewAIProfile}>
                  <Plus aria-hidden="true" size={15} />{t("manage.addAIProfile")}
                </button>
              </div>
              <p className="editorial-section-desc">{t("manage.aiDescription")}</p>
            </div>

            <div className="ai-profiles-panel" aria-label={t("manage.aiProfiles")}>
              {aiSettings.profiles.length ? (
                <div className="ai-profile-list">
                  {aiSettings.profiles.map((profile) => {
                    const isActive = aiSettings.activeProfileId === profile.id;
                    const isSelected = editingProfileId === profile.id;
                    const preset = getAIProviderPreset(profile.providerId);
                    const providerLabel = preset ? t(preset.nameKey) : t("manage.providerCustom");
                    return (
                      <div key={profile.id} className={`ai-profile-item${isSelected ? " selected" : ""}${isActive ? " active" : ""}`}>
                        <div className="ai-profile-row-bar">
                          <button
                            type="button"
                            className="ai-profile-select"
                            disabled={testingAI}
                            aria-expanded={isSelected}
                            aria-pressed={isSelected}
                            onClick={() => {
                              loadProfileIntoForm(profile);
                              setNotice(null);
                            }}
                          >
                            <span className="tree-chevron">
                              {isSelected ? <ChevronDown aria-hidden="true" size={15} /> : <ChevronRight aria-hidden="true" size={15} />}
                            </span>
                            <span className="ai-profile-monogram" aria-hidden="true">
                              {providerLabel.slice(0, 1).toUpperCase()}
                            </span>
                            <span className="ai-profile-copy">
                              <span className="ai-profile-title-row">
                                <strong>{profile.name}</strong>
                                {isActive ? <span className="ai-profile-badge">{t("manage.activeProfile")}</span> : null}
                              </span>
                              <small>{profile.model ? `${providerLabel} · ${profile.model}` : providerLabel}</small>
                            </span>
                          </button>
                          <div className="ai-profile-actions">
                            {!isActive ? (
                              <button className="mini-button ai-activate-btn" type="button" disabled={testingAI} onClick={() => void activateAIProfile(profile.id)}>
                                {t("manage.useProfile")}
                              </button>
                            ) : null}
                            <button className="mini-button danger" type="button" disabled={testingAI} onClick={() => void removeAIProfile(profile.id)}>
                              {t("manage.deleteProfile")}
                            </button>
                          </div>
                        </div>
                        {isSelected ? renderAIEditorForm() : null}
                      </div>
                    );
                  })}
                  {editingProfileId === null ? (
                    <div className="ai-profile-item selected ai-profile-draft">
                      <div className="ai-profile-row-bar">
                        <div className="ai-profile-select">
                          <span className="tree-chevron"><ChevronDown aria-hidden="true" size={15} /></span>
                          <span className="ai-profile-monogram draft" aria-hidden="true">+</span>
                          <span className="ai-profile-copy">
                            <span className="ai-profile-title-row">
                              <strong>{profileName.trim() || t("manage.newAIProfile")}</strong>
                            </span>
                          </span>
                        </div>
                      </div>
                      {renderAIEditorForm()}
                    </div>
                  ) : null}
                </div>
              ) : (
                <>
                  <p className="muted-note">{t("manage.noAIProfiles")}</p>
                  {renderAIEditorForm()}
                </>
              )}
            </div>
          </section>

          <section className="manage-section split-section" id="backup">
            <div className="editorial-section-head">
              <div className="editorial-tab-row">
                <h2 className="editorial-tab">{t("manage.backupRestore")}</h2>
              </div>
              <p className="editorial-section-desc">{t("manage.backupDescription")}</p>
            </div>
            <div className="backup-grid">
              <div className="backup-card"><div className="backup-icon"><Download aria-hidden="true" size={18} /></div><div><strong>{t("manage.exportTitle")}</strong><p>{t("manage.exportSummary", { tabs: snapshot.tabs.length, workspaces: snapshot.workspaces.length, windows: snapshot.windows.length })}</p></div><button className="button button-ghost" type="button" onClick={() => void exportBackup()}>{t("manage.exportBackup")}</button></div>
              <div className="backup-card"><div className="backup-icon"><Upload aria-hidden="true" size={18} /></div><div><strong>{t("manage.importTitle")}</strong><p>{t("manage.importDescription")}</p></div><button className="button button-ghost" type="button" onClick={() => importInput.current?.click()}>{t("manage.chooseFile")}</button><input ref={importInput} type="file" accept=".json,application/json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void importBackup(file); event.currentTarget.value = ""; }} /></div>
            </div>
            {fileError ? <p className="inline-error">{fileError}</p> : null}
            {skippedImportTabs.length ? (
              <div className="import-skip-report" role="status">
                <strong>{t("manage.importSkippedTitle", { count: skippedImportTabs.length })}</strong>
                <p>{t("manage.importSkippedHint")}</p>
                <ul>{skippedImportTabs.map((tab) => <li key={tab.id}><span>{tab.title || tab.url || tab.id}</span>{tab.url ? <small>{tab.url}</small> : null}<small>{t("backup.specialRestoreFailed")}</small></li>)}</ul>
              </div>
            ) : null}
            <p className="muted-note">{t("manage.privacyNote")}</p>
          </section>
        </section>
      </div>

      <WorkspaceDialog open={Boolean(dialog)} windowKey={dialog?.windowKey ?? currentWindowKey} workspace={dialog?.workspace} busy={busy} onClose={() => setDialog(null)} onSubmit={submit} />
      {deleteTarget ? <DeleteWorkspaceDialog workspace={deleteTarget} tabCount={tabsForWorkspace(deleteTarget.id)} busy={deleteBusy} onClose={() => { if (!deleteBusy) setDeleteTarget(null); }} onConfirm={remove} /> : null}
    </main>
  );
}
