// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceDialog } from "../../src/ui/WorkspaceDialog";
import type { Workspace } from "../../src/shared/contracts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("WorkspaceDialog progressive details", () => {
  it("keeps optional metadata collapsed for a new workspace", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => root.render(
      <WorkspaceDialog
        open
        windowKey="window:1"
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    ));

    expect(host.textContent).not.toContain("定义名称、用途和识别色");
    expect(host.querySelector("#workspace-name")).not.toBeNull();
    expect(host.querySelector("#workspace-description")).toBeNull();
    expect(host.querySelector("#workspace-tags")).toBeNull();
    expect(host.querySelectorAll(".icon-option")).toHaveLength(18);
    expect(host.querySelector<HTMLButtonElement>('[aria-label="选择文件夹图标"]')?.dataset.selected).toBe("true");

    const details = [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("描述与标签"));
    await act(async () => details?.click());
    expect(details?.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector("#workspace-description")).not.toBeNull();
    expect(host.querySelector("#workspace-tags")).not.toBeNull();
    await act(async () => root.unmount());
  });

  it("opens optional metadata when editing a workspace that already uses it", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const workspace: Workspace = {
      id: "workspace:1",
      windowKey: "window:1",
      name: "发布",
      description: "发布前检查",
      tags: ["本周"],
      color: "blue",
      icon: "briefcase",
      groupId: 1,
      order: 0,
      createdAt: 1,
      updatedAt: 1
    };

    await act(async () => root.render(
      <WorkspaceDialog
        open
        windowKey="window:1"
        workspace={workspace}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    ));

    expect(host.querySelector<HTMLTextAreaElement>("#workspace-description")?.value).toBe("发布前检查");
    expect(host.querySelector<HTMLInputElement>("#workspace-tags")?.value).toBe("本周");
    expect(host.querySelector<HTMLButtonElement>('[aria-label="选择办公图标"]')?.dataset.selected).toBe("true");
    await act(async () => root.unmount());
  });
});
