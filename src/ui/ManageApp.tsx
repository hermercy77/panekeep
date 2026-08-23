import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CircleAlert, CircleCheck, DatabaseBackup, Download, HardDrive, KeyRound, Plus, Rows3, Settings2, Upload, X } from "lucide-react";
import type { Workspace } from "../shared/contracts";
import { useTabFridgeState } from "../ui-state/useTabFridgeState";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { createAIConfigStore } from "../ai/config";
import { createOpenAICompatibleClient } from "../ai/client";
import { workspaceColorClass } from "./workspaceColors";

function sidepanelUrl(): string {
  try {
    const browser = (globalThis as { chrome?: { runtime?: { getURL?: (path: string) => string } } }).chrome;
    return browser?.runtime?.getURL?.("sidepanel.html") ?? "sidepanel.html";
  } catch {
    return "sidepanel.html";
  }
}

export function ManageApp() {
  const state = useTabFridgeState();
  const { snapshot } = state;
  const [dialog, setDialog] = useState<{ windowKey: string; workspace?: Workspace } | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Workspace | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [aiConfig, setAiConfig] = useState({ baseUrl: "https://api.openai.com/v1", apiKey: "", model: "" });
  const [testingAI, setTestingAI] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const aiStore = useMemo(() => createAIConfigStore(), []);

  useEffect(() => {
    void aiStore.load().then(setAiConfig).catch(() => undefined);
  }, [aiStore]);

  const currentWindowKey = snapshot.windows.find((window) => window.isCurrent)?.key ?? snapshot.windows[0]?.key ?? "window:unknown";
  const tabsForWorkspace = (workspaceId: string) => snapshot.tabs.filter((tab) => tab.workspaceId === workspaceId).length;

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
  const remove = async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setDeleteTarget(null);
    await state.deleteWorkspace(id);
  };

  const exportBackup = async () => {
    const payload = await state.exportBackup();
    if (!payload) return;
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `tab-fridge-backup-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("备份已导出到下载文件夹");
  };

  const saveAI = async () => {
    try {
      const saved = await aiStore.save(aiConfig);
      setAiConfig(saved);
      setNotice("AI 设置已保存");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "AI 设置保存失败");
    }
  };

  const testAI = async () => {
    setTestingAI(true);
    setNotice(null);
    try {
      const config = await aiStore.save(aiConfig);
      const result = await createOpenAICompatibleClient(config).testConnection();
      setNotice(`连接成功${result.models.length ? `，可用模型 ${result.models.length} 个` : ""}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "连接测试失败");
    } finally {
      setTestingAI(false);
    }
  };

  const importBackup = async (file: File) => {
    setFileError(null);
    try {
      const text = await file.text();
      if (await state.importBackup(text)) setNotice("备份已导入，请刷新浏览器窗口查看恢复结果");
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "备份导入失败");
    }
  };

  return (
    <main className="app-shell manage-shell">
      <header className="manage-header">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><Rows3 size={18} /></div>
          <div>
            <h1>Tab Fridge</h1>
            <p>工作区管理</p>
          </div>
        </div>
        <a className="button button-ghost" href={sidepanelUrl()}><ArrowLeft aria-hidden="true" size={15} />返回侧边栏</a>
      </header>
      <div className="manage-layout">
        <aside className="manage-nav" aria-label="管理导航">
          <button className="manage-nav-item active" type="button"><Rows3 aria-hidden="true" size={16} />工作区 <span>{snapshot.workspaces.length}</span></button>
          <a className="manage-nav-item" href="#ai-settings"><Settings2 aria-hidden="true" size={16} />AI 设置</a>
          <a className="manage-nav-item" href="#backup"><DatabaseBackup aria-hidden="true" size={16} />备份与恢复</a>
          <div className="manage-nav-note">
            <HardDrive aria-hidden="true" size={15} />本地数据
            <small>只保存在此浏览器</small>
          </div>
        </aside>
        <section className="manage-content">
          {state.error ? <div className="error-banner" role="alert"><CircleAlert aria-hidden="true" size={17} /><p>{state.error}</p><button type="button" onClick={state.clearError} aria-label="关闭错误提示"><X aria-hidden="true" size={14} /></button></div> : null}
          {notice ? <div className="success-banner" role="status"><CircleCheck aria-hidden="true" size={17} /><p>{notice}</p><button type="button" onClick={() => setNotice(null)} aria-label="关闭通知"><X aria-hidden="true" size={14} /></button></div> : null}
          <section className="manage-section" id="workspaces">
            <div className="section-title-row">
              <div>
                <h2>工作区</h2>
                <p>一个工作区对应一个浏览器原生标签组。</p>
              </div>
              <button className="button button-primary" type="button" onClick={openCreate}><Plus aria-hidden="true" size={15} />新建工作区</button>
            </div>
            {state.status === "loading" && !snapshot.workspaces.length ? <div className="loading-panel"><span className="spinner" />正在加载工作区…</div> : null}
            {state.status !== "loading" && !snapshot.workspaces.length ? (
              <div className="empty-state manage-empty"><div className="empty-illustration"><Rows3 aria-hidden="true" size={22} /></div><strong>还没有工作区</strong><span>创建工作区后，相关标签会出现在同一个原生标签组中。</span><button className="button button-primary" type="button" onClick={openCreate}><Plus aria-hidden="true" size={15} />创建工作区</button></div>
            ) : null}
            <div className="workspace-card-grid">
              {[...snapshot.workspaces].sort((a, b) => a.order - b.order).map((workspace) => {
                return (
                  <article className="workspace-card" key={workspace.id}>
                    <div className="workspace-card-body">
                      <div className="workspace-card-heading">
                        <span className={`workspace-dot workspace-dot-${workspaceColorClass(workspace.color)}`} aria-hidden="true" />
                        <h3>{workspace.name}</h3>
                        <span className="workspace-card-count">{tabsForWorkspace(workspace.id)} 标签</span>
                      </div>
                      <p className={workspace.description ? "workspace-card-description" : "workspace-card-description muted"}>{workspace.description || "还没有描述"}</p>
                      <div className="workspace-card-bottom">
                        <div className="tag-list">{workspace.tags.length ? workspace.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>) : <span className="tag muted">无标签</span>}</div>
                        <div className="card-actions">
                          <button className="mini-button" type="button" onClick={(event) => { event.stopPropagation(); openEdit(workspace); }}>编辑</button>
                          <button className="mini-button danger" type="button" onClick={(event) => { event.stopPropagation(); setDeleteTarget(workspace); }}>删除</button>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="manage-section split-section" id="ai-settings">
            <div className="section-title-row"><div><h2>AI 设置</h2><p>配置 OpenAI-compatible API。仅在主动整理时调用。</p></div><span className="local-badge"><KeyRound aria-hidden="true" size={13} />本地保存</span></div>
            <div className="settings-card">
              <label className="field-label" htmlFor="ai-base-url">Base URL</label>
              <input id="ai-base-url" className="text-input" value={aiConfig.baseUrl} onChange={(event) => setAiConfig({ ...aiConfig, baseUrl: event.target.value })} />
              <div className="form-columns">
                <div><label className="field-label" htmlFor="ai-model">模型</label><input id="ai-model" className="text-input" value={aiConfig.model} onChange={(event) => setAiConfig({ ...aiConfig, model: event.target.value })} placeholder="例如：gpt-4o-mini" /></div>
                <div><label className="field-label" htmlFor="ai-key">API Key</label><input id="ai-key" className="text-input" type="password" value={aiConfig.apiKey} onChange={(event) => setAiConfig({ ...aiConfig, apiKey: event.target.value })} placeholder="留空表示未配置" /></div>
              </div>
              <div className="settings-actions"><span>配置不会上传到 Tab Fridge。</span><div className="button-row"><button className="button button-ghost" type="button" onClick={() => void testAI()} disabled={testingAI}>{testingAI ? "测试中…" : "测试连接"}</button><button className="button button-primary" type="button" onClick={() => void saveAI()}>保存设置</button></div></div>
            </div>
          </section>

          <section className="manage-section split-section" id="backup">
            <div className="section-title-row"><div><h2>备份与恢复</h2><p>把窗口、工作区和标签保存为可迁移的 JSON。</p></div></div>
            <div className="backup-card"><div className="backup-icon"><Download aria-hidden="true" size={18} /></div><div><strong>导出 JSON 备份</strong><p>包含 {snapshot.tabs.length} 个标签、{snapshot.workspaces.length} 个工作区和 {snapshot.windows.length} 个窗口。</p></div><button className="button button-ghost" type="button" onClick={() => void exportBackup()}>导出备份</button></div>
            <div className="backup-card"><div className="backup-icon"><Upload aria-hidden="true" size={18} /></div><div><strong>导入 JSON 备份</strong><p>按备份结构新建窗口，不覆盖当前浏览器状态。</p></div><button className="button button-ghost" type="button" onClick={() => importInput.current?.click()}>选择文件</button><input ref={importInput} type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void importBackup(file); event.currentTarget.value = ""; }} /></div>
            {fileError ? <p className="inline-error">{fileError}</p> : null}
            <p className="muted-note">导出的文件不包含 API Key、Cookie、密码或网页正文。</p>
          </section>
        </section>
      </div>

      <WorkspaceDialog open={Boolean(dialog)} windowKey={dialog?.windowKey ?? currentWindowKey} workspace={dialog?.workspace} busy={busy} onClose={() => setDialog(null)} onSubmit={submit} />
      {deleteTarget ? <div className="dialog-backdrop" role="presentation"><section className="dialog-card confirm-card" role="dialog" aria-modal="true" aria-labelledby="manage-delete-title"><div className="confirm-icon"><CircleAlert aria-hidden="true" size={18} /></div><h2 id="manage-delete-title">删除「{deleteTarget.name}」？</h2><p>工作区中的标签不会关闭，会回到未分类。</p><div className="dialog-actions"><button className="button button-ghost" type="button" onClick={() => setDeleteTarget(null)}>取消</button><button className="button button-danger" type="button" onClick={() => void remove()}>删除工作区</button></div></section></div> : null}
    </main>
  );
}
