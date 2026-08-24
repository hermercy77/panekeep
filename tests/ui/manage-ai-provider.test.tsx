// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManageApp } from "../../src/ui/ManageApp";
import { AI_CONFIG_STORAGE_KEY } from "../../src/ai/config";
import { AI_PROVIDER_PRESETS } from "../../src/ai/providers";
import { setAppLanguage } from "../../src/i18n";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const snapshot = {
  windows: [{ key: "window:1", nativeId: 1, name: "Window 1", order: 0, isCurrent: true, expanded: true }],
  workspaces: [],
  tabs: []
};

afterEach(async () => {
  document.body.innerHTML = "";
  delete (globalThis as typeof globalThis & { chrome?: unknown }).chrome;
  vi.unstubAllGlobals();
  await setAppLanguage("zh-CN");
});

describe("ManageApp AI provider settings", () => {
  it("loads models after testing and keeps manual entry available", async () => {
    const values: Record<string, unknown> = {
      "tab-fridge.language": "zh-CN",
      [AI_CONFIG_STORAGE_KEY]: {
        providerId: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "secret",
        model: ""
      }
    };
    (globalThis as typeof globalThis & { chrome?: unknown }).chrome = {
      runtime: {
        getURL: (path: string) => path,
        sendMessage: async () => ({ ok: true, result: snapshot, snapshot }),
        onMessage: { addListener: () => undefined, removeListener: () => undefined }
      },
      permissions: {
        contains: async () => true,
        request: async () => true
      },
      storage: {
        local: {
          get: async () => values,
          set: async (items: Record<string, unknown>) => Object.assign(values, items),
          remove: async () => undefined
        },
        onChanged: { addListener: () => undefined }
      }
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: "gpt-fast" }, { id: "gpt-precise" }]
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<ManageApp />);
      await Promise.resolve();
    });
    const testButton = [...host.querySelectorAll("button")].find((button) => button.textContent === "测试连接");
    await act(async () => {
      testButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const modelSelect = host.querySelector<HTMLSelectElement>("#ai-model");
    expect(modelSelect?.tagName).toBe("SELECT");
    expect([...modelSelect!.options].map((option) => option.value)).toEqual(["", "gpt-fast", "gpt-precise"]);
    expect(host.textContent).toContain("已检测到 2 个可用模型");

    const manualButton = [...host.querySelectorAll("button")].find((button) => button.textContent === "手动输入");
    await act(async () => manualButton?.click());
    const manualInput = host.querySelector<HTMLInputElement>("#ai-model")!;
    expect(manualInput.placeholder).toContain("gpt-4o-mini");

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(manualInput, "private-model-alias");
      manualInput.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      testButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.querySelector<HTMLInputElement>("#ai-model")?.value).toBe("private-model-alias");
    expect(values[AI_CONFIG_STORAGE_KEY]).toMatchObject({ model: "private-model-alias" });

    await act(async () => root.unmount());
  });

  it("switches presets safely and exposes an empty editable Custom URL", async () => {
    const values: Record<string, unknown> = { "tab-fridge.language": "zh-CN" };
    (globalThis as typeof globalThis & { chrome?: unknown }).chrome = {
      runtime: {
        getURL: (path: string) => path,
        sendMessage: async () => ({ ok: true, result: snapshot, snapshot }),
        onMessage: { addListener: () => undefined, removeListener: () => undefined }
      },
      storage: { local: { get: async () => values, set: async () => undefined }, onChanged: { addListener: () => undefined } }
    };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<ManageApp />);
      await Promise.resolve();
    });
    const provider = host.querySelector<HTMLSelectElement>("#ai-provider")!;
    expect(provider.options).toHaveLength(AI_PROVIDER_PRESETS.length + 1);

    await act(async () => {
      provider.value = "deepseek";
      provider.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(host.querySelector<HTMLInputElement>("#ai-base-url")?.value).toBe("https://api.deepseek.com");
    expect(host.querySelector<HTMLInputElement>("#ai-key")?.value).toBe("");

    await act(async () => {
      provider.value = "custom";
      provider.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(host.querySelector<HTMLInputElement>("#ai-base-url")?.value).toBe("");

    await act(async () => root.unmount());
  });
});
