// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceMergeDialog } from "../../src/ui/WorkspaceMergeDialog";
import { createWorkspaceMergePreview } from "../../src/shared/workspaceMerge";
import type { TabRecord, Workspace } from "../../src/shared/contracts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("WorkspaceMergeDialog", () => {
  it("previews cross-window consequences and requires explicit confirmation", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const source: Workspace = {
      id: "source",
      windowKey: "window:1",
      name: "来源",
      description: "discarded",
      tags: ["source"],
      color: "red",
      icon: "code",
      groupId: 10,
      order: 0,
      createdAt: 1,
      updatedAt: 1
    };
    const target: Workspace = {
      id: "target",
      windowKey: "window:2",
      name: "目标",
      description: "kept",
      tags: ["target"],
      color: "blue",
      icon: "briefcase",
      groupId: 20,
      order: 0,
      createdAt: 1,
      updatedAt: 1
    };
    const sourceTabs: TabRecord[] = [1, 2].map((id, index) => ({
      id: String(id),
      windowKey: source.windowKey,
      workspaceId: source.id,
      kind: "normal",
      url: `https://example.test/${id}`,
      index,
      pinned: false
    }));
    const preview = createWorkspaceMergePreview(source, target, sourceTabs);
    const onConfirm = vi.fn();
    const onClose = vi.fn();

    await act(async () => root.render(
      <WorkspaceMergeDialog
        preview={preview}
        source={source}
        target={target}
        targetTabCount={3}
        busy={false}
        error={null}
        onClose={onClose}
        onConfirm={onConfirm}
      />
    ));

    expect(host.textContent).toContain("将「来源」合并到「目标」？");
    expect(host.textContent).toContain("合并后共 5 个");
    expect(host.textContent).toContain("来源网页将移动到目标工作区所在窗口");
    expect(host.textContent).toContain("来源工作区将被删除");
    expect(host.textContent).toContain("目标工作区的名称、描述、标签、颜色和图标保持不变");
    expect(host.textContent).toContain("此操作不提供撤销");
    const confirm = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("确认合并"));
    await act(async () => confirm?.click());
    expect(onConfirm).toHaveBeenCalledWith(preview);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
});
