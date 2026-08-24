import type { TabRecord, Workspace, WorkspaceMergePreview } from "./contracts";
import { fingerprintTabs } from "../ai/snapshot";

export function fingerprintWorkspace(workspace: Workspace): string {
  return JSON.stringify({
    id: workspace.id,
    windowKey: workspace.windowKey,
    name: workspace.name,
    description: workspace.description,
    tags: workspace.tags,
    color: workspace.color,
    icon: workspace.icon,
    groupId: workspace.groupId,
    order: workspace.order,
    updatedAt: workspace.updatedAt
  });
}

export function createWorkspaceMergePreview(
  source: Workspace,
  target: Workspace,
  sourceTabs: readonly TabRecord[]
): WorkspaceMergePreview {
  return {
    sourceWorkspaceId: source.id,
    targetWorkspaceId: target.id,
    sourceWindowKey: source.windowKey,
    targetWindowKey: target.windowKey,
    sourceWorkspaceFingerprint: fingerprintWorkspace(source),
    targetWorkspaceFingerprint: fingerprintWorkspace(target),
    sourceTabIds: sourceTabs.map((tab) => tab.id),
    sourceFingerprint: fingerprintTabs(sourceTabs)
  };
}
