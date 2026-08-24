import { useState } from "react";
import { createRoot } from "react-dom/client";
import { TabTree } from "../../../src/ui/TabTree";
import { WorkspaceMergeDialog } from "../../../src/ui/WorkspaceMergeDialog";
import type { TabRecord, WindowState, Workspace, WorkspaceMergePreview } from "../../../src/shared/contracts";
import { createWorkspaceMergePreview } from "../../../src/shared/workspaceMerge";
import { setAppLanguage } from "../../../src/i18n";
import "../../../src/ui/hallmark.css";

const windows: WindowState[] = [
  { key: "window:1", nativeId: 1, name: "当前窗口", order: 0, isCurrent: true, expanded: true },
  { key: "window:2", nativeId: 2, name: "第二窗口", order: 1, isCurrent: false, expanded: true }
];

const workspaces: Workspace[] = [
  { id: "ws-source", windowKey: "window:1", name: "开发任务", description: "来源工作区", tags: ["开发"], color: "green", icon: "code", groupId: 10, order: 0, createdAt: 1, updatedAt: 1 },
  { id: "ws-target", windowKey: "window:1", name: "产品发布", description: "目标工作区", tags: ["发布"], color: "blue", icon: "briefcase", groupId: 11, order: 1, createdAt: 1, updatedAt: 1 },
  { id: "ws-cross", windowKey: "window:2", name: "跨窗口目标", description: "另一个窗口", tags: [], color: "purple", icon: "folder", groupId: 20, order: 0, createdAt: 1, updatedAt: 1 }
];

const tabs: TabRecord[] = [
  { id: "tab-1", windowKey: "window:1", workspaceId: "ws-source", kind: "normal", url: "https://github.com/example/one", title: "修复登录流程", index: 0, pinned: false, groupId: 10 },
  { id: "tab-2", windowKey: "window:1", workspaceId: "ws-source", kind: "normal", url: "https://linear.app/example/two", title: "整理发布清单", index: 1, pinned: false, groupId: 10 },
  { id: "tab-3", windowKey: "window:1", workspaceId: "ws-target", kind: "normal", url: "https://docs.example.com/three", title: "产品说明", index: 2, pinned: false, groupId: 11 },
  { id: "tab-4", windowKey: "window:1", workspaceId: null, kind: "normal", url: "https://example.com/four", title: "临时资料", index: 3, pinned: false },
  { id: "tab-special", windowKey: "window:1", workspaceId: null, kind: "special", url: "chrome://extensions/", title: "扩展程序", index: 4, pinned: false, specialReason: "chrome" },
  { id: "tab-5", windowKey: "window:2", workspaceId: "ws-cross", kind: "normal", url: "https://example.com/five", title: "跨窗口资料", index: 0, pinned: false, groupId: 20 }
];

declare global {
  interface Window { __tabFridgeEvents: Array<Record<string, unknown>>; }
}
window.__tabFridgeEvents = [];

function Harness() {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [mergePreview, setMergePreview] = useState<WorkspaceMergePreview | null>(null);
  const source = workspaces.find((workspace) => workspace.id === mergePreview?.sourceWorkspaceId);
  const target = workspaces.find((workspace) => workspace.id === mergePreview?.targetWorkspaceId);
  return (
    <main className="app-shell sidepanel-shell">
      <section className="tree-panel">
        <TabTree
          snapshot={{ windows, workspaces, tabs }}
          query=""
          filter="all"
          windowScope="all"
          workspaceTag=""
          expandedWindows={new Set(windows.map((window) => window.key))}
          expandedWorkspaces={new Set(workspaces.map((workspace) => workspace.id))}
          selectedTabId={null}
          checkedTabIds={checked}
          onToggleWindow={() => undefined}
          onToggleWorkspace={() => undefined}
          onActivateTab={(tabId) => window.__tabFridgeEvents.push({ type: "activate", tabId })}
          onCheckedTabIdsChange={setChecked}
          onMoveTabs={(tabIds, workspaceId) => window.__tabFridgeEvents.push({ type: "move-tabs", tabIds, workspaceId })}
          onMoveWorkspace={(workspaceId, beforeWorkspaceId) => window.__tabFridgeEvents.push({ type: "move-workspace", workspaceId, beforeWorkspaceId })}
          onRequestWorkspaceMerge={(sourceWorkspaceId, targetWorkspaceId) => {
            const sourceWorkspace = workspaces.find((workspace) => workspace.id === sourceWorkspaceId)!;
            const targetWorkspace = workspaces.find((workspace) => workspace.id === targetWorkspaceId)!;
            setMergePreview(createWorkspaceMergePreview(sourceWorkspace, targetWorkspace, tabs.filter((tab) => tab.workspaceId === sourceWorkspaceId)));
          }}
          onEditWorkspace={() => undefined}
          onDeleteWorkspace={() => undefined}
          onCreateWorkspace={() => undefined}
        />
      </section>
      <footer className="sidepanel-footer">
        <div className="footer-stat"><span>{checked.size} selected</span></div>
      </footer>
      <WorkspaceMergeDialog
        preview={mergePreview}
        source={source}
        target={target}
        targetTabCount={tabs.filter((tab) => tab.workspaceId === target?.id).length}
        busy={false}
        error={null}
        onClose={() => setMergePreview(null)}
        onConfirm={(preview) => window.__tabFridgeEvents.push({ type: "confirm-merge", preview })}
      />
    </main>
  );
}

void setAppLanguage("zh-CN").then(() => {
  createRoot(document.getElementById("root")!).render(<Harness />);
});
