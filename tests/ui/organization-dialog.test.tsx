// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrganizationDialog } from "../../src/ui/OrganizationDialog";
import type { TabRecord } from "../../src/shared/contracts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const groupedTabs: TabRecord[] = [
  { id: "tab-1", windowKey: "window:1", workspaceId: "workspace:1", kind: "normal", url: "https://music.example/", title: "Music", index: 0, pinned: false, groupId: 1 },
  { id: "tab-2", windowKey: "window:1", workspaceId: "workspace:2", kind: "normal", url: "https://search.example/", title: "Search", index: 1, pinned: false, groupId: 2 }
];

afterEach(() => {
  document.body.innerHTML = "";
});

describe("OrganizationDialog selection", () => {
  it("keeps the tab checklist primary and uses compact organization modes", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onGenerate = vi.fn(async () => undefined);

    await act(async () => root.render(
      <OrganizationDialog
        open
        tabs={groupedTabs}
        mode="purpose"
        preview={null}
        loading={false}
        applying={false}
        error={null}
        onModeChange={vi.fn()}
        onGenerate={onGenerate}
        onConfirm={vi.fn(async () => undefined)}
        onClose={vi.fn()}
      />
    ));

    expect(host.querySelectorAll(".selection-item")).toHaveLength(2);
    expect(host.textContent).toContain("按目的");
    expect(host.textContent).toContain("按类型");
    expect(host.textContent).not.toContain("工作、研究、稍后阅读");
    expect(host.textContent).not.toContain("准备好整理你的标签了吗");
    const selectAll = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "全选");
    const generate = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "生成预览");
    await act(async () => selectAll?.click());
    await act(async () => generate?.click());
    expect(onGenerate).toHaveBeenCalledWith("purpose", ["tab-1", "tab-2"]);
    await act(async () => root.unmount());
  });

  it("preserves manual selections across live tab snapshot refreshes", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const props = {
      open: true,
      mode: "purpose" as const,
      preview: null,
      loading: false,
      applying: false,
      error: null,
      onModeChange: vi.fn(),
      onGenerate: vi.fn(async () => undefined),
      onConfirm: vi.fn(async () => undefined),
      onClose: vi.fn()
    };

    await act(async () => root.render(<OrganizationDialog {...props} tabs={groupedTabs} />));
    const checkboxes = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(checkboxes).toHaveLength(2);
    await act(async () => {
      checkboxes[0].click();
      checkboxes[1].click();
    });
    expect(checkboxes.every((checkbox) => checkbox.checked)).toBe(true);
    expect(host.textContent).toContain("2 / 2");

    await act(async () => root.render(
      <OrganizationDialog {...props} tabs={groupedTabs.map((tab) => ({ ...tab }))} />
    ));

    const refreshedCheckboxes = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(refreshedCheckboxes.every((checkbox) => checkbox.checked)).toBe(true);
    expect(host.textContent).toContain("2 / 2");
    await act(async () => root.unmount());
  });

  it("drops only a selected tab that disappears while the dialog is open", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const props = {
      open: true,
      mode: "purpose" as const,
      preview: null,
      loading: false,
      applying: false,
      error: null,
      onModeChange: vi.fn(),
      onGenerate: vi.fn(async () => undefined),
      onConfirm: vi.fn(async () => undefined),
      onClose: vi.fn()
    };

    await act(async () => root.render(<OrganizationDialog {...props} tabs={groupedTabs} />));
    const checkboxes = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    await act(async () => {
      checkboxes[0].click();
      checkboxes[1].click();
    });
    await act(async () => root.render(<OrganizationDialog {...props} tabs={[{ ...groupedTabs[0] }]} />));

    const remaining = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(remaining?.checked).toBe(true);
    expect(host.textContent).toContain("1 / 1");
    await act(async () => root.unmount());
  });

  it("restores the current unclassified default after closing and reopening", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const tabs = [groupedTabs[0], { ...groupedTabs[1], workspaceId: null, groupId: undefined }];
    const baseProps = {
      mode: "purpose" as const,
      preview: null,
      loading: false,
      applying: false,
      error: null,
      onModeChange: vi.fn(),
      onGenerate: vi.fn(async () => undefined),
      onConfirm: vi.fn(async () => undefined),
      onClose: vi.fn()
    };

    await act(async () => root.render(<OrganizationDialog {...baseProps} open tabs={tabs} />));
    let checkboxes = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(checkboxes.map((checkbox) => checkbox.checked)).toEqual([false, true]);
    await act(async () => {
      checkboxes[0].click();
      checkboxes[1].click();
    });
    expect(checkboxes.map((checkbox) => checkbox.checked)).toEqual([true, false]);

    await act(async () => root.render(<OrganizationDialog {...baseProps} open={false} tabs={tabs} />));
    await act(async () => root.render(<OrganizationDialog {...baseProps} open tabs={tabs} />));

    checkboxes = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(checkboxes.map((checkbox) => checkbox.checked)).toEqual([false, true]);
    await act(async () => root.unmount());
  });

  it("allows confirming an all-unclassified AI suggestion", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onConfirm = vi.fn(async () => undefined);
    const preview = {
      mode: "purpose" as const,
      sourceTabIds: ["tab-1"],
      sourceFingerprint: "fixture-fingerprint",
      groups: [],
      unclassifiedTabIds: ["tab-1"]
    };

    await act(async () => root.render(
      <OrganizationDialog
        open
        tabs={groupedTabs}
        mode="purpose"
        preview={preview}
        loading={false}
        applying={false}
        error={null}
        onModeChange={vi.fn()}
        onGenerate={vi.fn(async () => undefined)}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />
    ));

    expect(host.textContent).toContain("1 个标签");
    expect(host.textContent).toContain("未分类");
    expect(host.textContent).not.toContain("AI 建议保持未分类");
    const confirm = [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("确认并应用"));
    expect(confirm?.disabled).toBe(false);
    await act(async () => confirm?.click());
    expect(onConfirm).toHaveBeenCalledWith(preview);
    await act(async () => root.unmount());
  });

  it("returns to the checklist while regenerating a preview", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onGenerate = vi.fn(async () => undefined);
    const preview = {
      mode: "purpose" as const,
      sourceTabIds: ["tab-1"],
      sourceFingerprint: "fixture-fingerprint",
      groups: [{ id: "group-1", name: "音乐", description: "", tags: [], existingWorkspaceId: null, tabIds: ["tab-1"] }],
      unclassifiedTabIds: []
    };

    await act(async () => root.render(
      <OrganizationDialog
        open
        tabs={[{ ...groupedTabs[0], workspaceId: null, groupId: undefined }, groupedTabs[1]]}
        mode="purpose"
        preview={preview}
        loading={false}
        applying={false}
        error={null}
        onModeChange={vi.fn()}
        onGenerate={onGenerate}
        onConfirm={vi.fn(async () => undefined)}
        onClose={vi.fn()}
      />
    ));

    const regenerate = [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("重新生成"));
    await act(async () => regenerate?.click());
    expect(host.querySelector(".selection-list")).not.toBeNull();
    expect(host.querySelector(".preview-panel")).toBeNull();
    expect(onGenerate).toHaveBeenCalledWith("purpose", ["tab-1"]);
    await act(async () => root.unmount());
  });
});
