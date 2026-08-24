// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeleteWorkspaceDialog } from "../../src/ui/DeleteWorkspaceDialog";
import { setAppLanguage } from "../../src/i18n";
import type { Workspace } from "../../src/shared/contracts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const workspace: Workspace = {
  id: "workspace-1",
  windowKey: "window:1",
  name: "Current work",
  description: "",
  tags: [],
  color: "blue",
  icon: "briefcase",
  groupId: 10,
  order: 0,
  createdAt: 1,
  updatedAt: 1
};

afterEach(async () => {
  document.body.innerHTML = "";
  await setAppLanguage("zh-CN");
});

describe("DeleteWorkspaceDialog", () => {
  it("keeps tabs open by default and passes the explicit close-tabs choice", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onConfirm = vi.fn();
    await act(async () => root.render(
      <DeleteWorkspaceDialog workspace={workspace} tabCount={3} onClose={vi.fn()} onConfirm={onConfirm} />
    ));

    const checkbox = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    const confirm = [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "删除工作区")!;
    expect(checkbox.checked).toBe(false);
    expect(host.textContent).toContain("同时关闭其中的 3 个标签");
    await act(async () => confirm.click());
    expect(onConfirm).toHaveBeenLastCalledWith(false);

    await act(async () => checkbox.click());
    expect(host.textContent).toContain("其中的 3 个标签也会关闭");
    await act(async () => confirm.click());
    expect(onConfirm).toHaveBeenLastCalledWith(true);

    await act(async () => setAppLanguage("en"));
    expect(host.textContent).toContain("Also close 3 tabs");
    await act(async () => root.unmount());
  });
});
