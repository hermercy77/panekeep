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

    expect(host.textContent).toContain("AI 建议保持未分类");
    const confirm = [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("确认并应用"));
    expect(confirm?.disabled).toBe(false);
    await act(async () => confirm?.click());
    expect(onConfirm).toHaveBeenCalledWith(preview);
    await act(async () => root.unmount());
  });
});
