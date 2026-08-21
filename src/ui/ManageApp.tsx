import { useEffect, useMemo, useRef, useState } from "react";
import type { Workspace } from "../shared/contracts";
import { useTabFridgeState } from "../ui-state/useTabFridgeState";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { createAIConfigStore } from "../ai/config";
import { createOpenAICompatibleClient } from "../ai/client";

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
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  const selectedWorkspace = useMemo(() => snapshot.workspaces.find((workspace) => workspace.id === selectedId), [selectedId, snapshot.workspaces]);
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
      setSelectedId(saved.id);
    }
  };
  const remove = async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setDeleteTarget(null);
    if (await state.deleteWorkspace(id)) setSelectedId((current) => (current === id ? null : current));
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
          <div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>
          <div>
            <span className="eyebrow">TAB FRIDGE</span>
            <h1>工作区管理</h1>
          </div>
        </div>
        <a className="button button-ghost" href={sidepanelUrl()}>← 返回侧边栏</a>
      </header>
      <div className="manage-layout">
        <aside className="manage-nav" aria-label="管理导航">
          <button className="manage-nav-item active" type="button">工作区 <span>{snapshot.workspaces.length}</span></button>
          <a className="manage-nav-item" href="#ai-settings">AI 设置</a>
          <a className="manage-nav-item" href="#backup">备份与恢复</a>
          <div className="manage-nav-note">
            <span className="status-dot" />
            本地数据
            <small>只保存在此浏览器</small>
          </div>
        </aside>
        <section className="manage-content">
          {state.error ? <div className="error-banner" role="alert"><span>!</span><p>{state.error}</p><button type="button" onClick={state.clearError}>×</button></div> : null}
          {notice ? <div className="success-banner" role="status"><span>✓</span><p>{notice}</p><button type="button" onClick={() => setNotice(null)}>×</button></div> : null}
          <section className="manage-section" id="workspaces">
            <div className="section-title-row">
              <div>
                <span className="eyebrow">ORGANIZE</span>
                <h2>工作区</h2>
                <p>用颜色、描述和标签把不同上下文分开。</p>
              </div>
              <button className="button button-primary" type="button" onClick={openCreate}>＋ 新建工作区</button>
            </div>
            {state.status === "loading" && !snapshot.workspaces.length ? <div className="loading-panel"><span className="spinner" />正在加载工作区…</div> : null}
            {state.status !== "loading" && !snapshot.workspaces.length ? (
              <div className="empty-state manage-empty"><div className="empty-illustration">▤</div><strong>还没有工作区</strong><span>创建一个工作区，把相关标签放在一起。</span><button className="button button-primary" type="button" onClick={openCreate}>创建第一个工作区</button></div>
            ) : null}
            <div className="workspace-card-grid">
              {[...snapshot.workspaces].sort((a, b) => a.order - b.order).map((workspace) => {
                const selected = selectedId === workspace.id;
                return (
                  <article className={selected ? "workspace-card selected" : "workspace-card"} key={workspace.id} onClick={() => setSelectedId(workspace.id)}>
                    <div className={`workspace-card-accent accent-${workspace.color || "slate"}`} />
                    <div className="workspace-card-body">
                      <div className="workspace-card-heading">
                        <span className={`workspace-dot workspace-dot-${workspace.color || "slate"}`} />
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
            {selectedWorkspace ? (
              <div className="workspace-detail">
                <div><span className={`workspace-dot workspace-dot-${selectedWorkspace.color || "slate"}`} /><strong>{selectedWorkspace.name}</strong><span>{tabsForWorkspace(selectedWorkspace.id)} 个标签</span></div>
                <p>{selectedWorkspace.description || "这个工作区还没有描述。"}</p>
                <button className="button button-ghost" type="button" onClick={() => openEdit(selectedWorkspace)}>编辑详情</button>
              </div>
            ) : null}
          </section>

          <section className="manage-section split-section" id="ai-settings">
            <div className="section-title-row"><div><span className="eyebrow">AI ORGANIZER</span><h2>AI 设置</h2><p>仅在你主动生成整理预览时使用。</p></div><span className="local-badge">本地保存</span></div>
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
            <div className="section-title-row"><div><span className="eyebrow">SAFETY</span><h2>备份与恢复</h2><p>导出标签、窗口和工作区，方便迁移或留档。</p></div></div>
            <div className="backup-card"><div className="backup-icon">↓</div><div><strong>导出 JSON 备份</strong><p>包含 {snapshot.tabs.length} 个标签、{snapshot.workspaces.length} 个工作区和 {snapshot.windows.length} 个窗口。</p></div><button className="button button-ghost" type="button" onClick={() => void exportBackup()}>导出备份</button></div>
            <div className="backup-card"><div className="backup-icon">↑</div><div><strong>导入 JSON 备份</strong><p>按备份结构新建窗口，不覆盖当前浏览器状态。</p></div><button className="button button-ghost" type="button" onClick={() => importInput.current?.click()}>选择文件</button><input ref={importInput} type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void importBackup(file); event.currentTarget.value = ""; }} /></div>
            {fileError ? <p className="inline-error">{fileError}</p> : null}
            <p className="muted-note">导出的文件不包含 API Key、Cookie、密码或网页正文。</p>
          </section>
        </section>
      </div>

      <WorkspaceDialog open={Boolean(dialog)} windowKey={dialog?.windowKey ?? currentWindowKey} workspace={dialog?.workspace} busy={busy} onClose={() => setDialog(null)} onSubmit={submit} />
      {deleteTarget ? <div className="dialog-backdrop" role="presentation"><section className="dialog-card confirm-card" role="dialog" aria-modal="true" aria-labelledby="manage-delete-title"><div className="confirm-icon">!</div><h2 id="manage-delete-title">删除「{deleteTarget.name}」？</h2><p>工作区中的标签不会关闭，会回到未分类。</p><div className="dialog-actions"><button className="button button-ghost" type="button" onClick={() => setDeleteTarget(null)}>取消</button><button className="button button-danger" type="button" onClick={() => void remove()}>删除工作区</button></div></section></div> : null}
    </main>
  );
}
