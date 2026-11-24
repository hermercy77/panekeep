// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { SidePanelApp } from "../../src/ui/SidePanelApp";
import { setAppLanguage } from "../../src/i18n";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const baseSnapshot = {
  windows: [{ key: "window:1", nativeId: 1, name: "Window 1", order: 0, isCurrent: true, expanded: true }],
  workspaces: [],
  tabs: [
    {
      id: "tab-1",
      windowKey: "window:1",
      workspaceId: null,
      kind: "normal",
      url: "https://docs.example.com/",
      title: "Docs",
      index: 0,
      pinned: false
    }
  ]
};

afterEach(async () => {
  document.body.innerHTML = "";
  delete (globalThis as typeof globalThis & { chrome?: unknown }).chrome;
  await setAppLanguage("zh-CN");
});

function installMockChrome(sendMessage: (message: { action?: string }) => Promise<unknown>) {
  (globalThis as typeof globalThis & { chrome?: unknown }).chrome = {
    runtime: {
      getURL: (path: string) => path,
      sendMessage,
      onMessage: { addListener: () => undefined, removeListener: () => undefined }
    },
    storage: {
      local: {
        get: async () => ({}),
        set: async () => undefined
      },
      onChanged: { addListener: () => undefined }
    }
  };
}

describe("SidePanelApp AI organization error surfacing", () => {
  it("shows the real preview error inside the dialog without duplicating it to the background banner", async () => {
    installMockChrome(async (message) => {
      if (message.action === "refresh") return { ok: true, result: baseSnapshot, snapshot: baseSnapshot };
      if (message.action === "organization.preview") {
        return { ok: false, error: "AI 服务返回 HTTP 401" };
      }
      return { ok: true, result: baseSnapshot, snapshot: baseSnapshot };
    });

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SidePanelApp />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const openAiButton = host.querySelector<HTMLButtonElement>(".button-ai")!;
    await act(async () => {
      openAiButton.click();
      await Promise.resolve();
    });

    const generateButton = [...host.querySelectorAll<HTMLButtonElement>(".organization-dialog button")]
      .find((button) => button.textContent?.includes("生成预览"))!;
    await act(async () => {
      generateButton.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const dialogError = host.querySelector(".organization-dialog .inline-error");
    expect(dialogError?.textContent).toBe("AI 服务返回 HTTP 401");
    expect(host.querySelector(".error-banner")).toBeNull();

    await act(async () => root.unmount());
  });

  it("shows the real apply error inside the dialog in English as well", async () => {
    await setAppLanguage("en");
    const preview = {
      mode: "purpose",
      sourceTabIds: ["tab-1"],
      sourceFingerprint: "fp-1",
      groups: [
        {
          id: "g1",
          name: "Docs",
          description: "",
          tags: [],
          icon: "file-text",
          color: "blue",
          existingWorkspaceId: null,
          tabIds: ["tab-1"]
        }
      ],
      unclassifiedTabIds: []
    };
    installMockChrome(async (message) => {
      if (message.action === "refresh") return { ok: true, result: baseSnapshot, snapshot: baseSnapshot };
      if (message.action === "organization.preview") return { ok: true, result: preview };
      if (message.action === "organization.apply") {
        return { ok: false, error: "Browser state changed. Generate a new preview." };
      }
      return { ok: true, result: baseSnapshot, snapshot: baseSnapshot };
    });

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SidePanelApp />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      host.querySelector<HTMLButtonElement>(".button-ai")!.click();
      await Promise.resolve();
    });
    const generateButton = [...host.querySelectorAll<HTMLButtonElement>(".organization-dialog button")]
      .find((button) => button.textContent?.includes("Generate preview"))!;
    await act(async () => {
      generateButton.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const confirmButton = [...host.querySelectorAll<HTMLButtonElement>(".organization-dialog button")]
      .find((button) => button.textContent?.includes("Confirm and apply"))!;
    await act(async () => {
      confirmButton.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const dialogError = host.querySelector(".organization-dialog .inline-error");
    expect(dialogError?.textContent).toBe("Browser state changed. Generate a new preview.");
    expect(host.querySelector(".error-banner")).toBeNull();

    await act(async () => root.unmount());
  });

  it("cancels an in-flight organization request when closing the dialog during loading", async () => {
    const actions: Array<{ action?: string; payload?: unknown }> = [];
    installMockChrome(async (message) => {
      actions.push(message);
      if (message.action === "refresh") return { ok: true, result: baseSnapshot, snapshot: baseSnapshot };
      if (message.action === "organization.preview") {
        return new Promise(() => undefined);
      }
      return { ok: true, result: { cancelled: true } };
    });

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<SidePanelApp />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      host.querySelector<HTMLButtonElement>(".button-ai")!.click();
      await Promise.resolve();
    });
    const generateButton = [...host.querySelectorAll<HTMLButtonElement>(".organization-dialog button")]
      .find((button) => button.textContent?.includes("生成预览"))!;
    await act(async () => {
      generateButton.click();
      await Promise.resolve();
    });

    const closeButton = host.querySelector<HTMLButtonElement>('.organization-dialog [aria-label="关闭"]')!;
    await act(async () => {
      closeButton.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(actions.some((item) => item.action === "organization.cancel")).toBe(true);
    await act(async () => root.unmount());
  });
});
