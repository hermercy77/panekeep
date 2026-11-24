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
  it("loads model suggestions into one editable field without extra mode controls", async () => {
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
    const modelInput = host.querySelector<HTMLInputElement>("#ai-model")!;
    expect(modelInput.tagName).toBe("INPUT");
    expect(modelInput.placeholder).toBe("测试连接通过将返回可用模型列表");
    const testButton = host.querySelector<HTMLButtonElement>(".api-key-input-wrap .connection-test-button");
    expect(testButton?.textContent).toBe("测试连接");
    expect(host.querySelectorAll(".settings-actions button")).toHaveLength(1);
    expect(host.querySelector(".settings-actions button")?.textContent).toBe("保存设置");
    await act(async () => {
      testButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(modelInput.getAttribute("list")).toBe("ai-model-options");
    expect([...host.querySelectorAll<HTMLOptionElement>("#ai-model-options option")].map((option) => option.value)).toEqual(["gpt-fast", "gpt-precise"]);
    expect(host.textContent).toContain("连接成功");
    expect(host.textContent).not.toContain("已检测到 2 个可用模型");
    expect(host.textContent).not.toContain("手动输入");

    const toggleVisibility = host.querySelector<HTMLButtonElement>(".api-key-visibility-button")!;
    const keyInput = host.querySelector<HTMLInputElement>("#ai-key")!;
    expect(keyInput.type).toBe("password");
    await act(async () => toggleVisibility.click());
    expect(keyInput.type).toBe("text");
    await act(async () => toggleVisibility.click());
    expect(keyInput.type).toBe("password");

    const secondModelChip = [...host.querySelectorAll<HTMLButtonElement>(".model-chip")].find((button) => button.textContent === "gpt-precise")!;
    await act(async () => secondModelChip.click());
    expect(modelInput.value).toBe("gpt-precise");

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(modelInput, "private-model-alias");
      modelInput.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      testButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(modelInput.value).toBe("private-model-alias");
    expect(values[AI_CONFIG_STORAGE_KEY]).toMatchObject({ model: "" });
    expect(host.textContent).toContain("连接成功，但当前模型不在可用列表中");
    expect(host.textContent).not.toContain("gpt-fast、gpt-precise");

    const saveButton = host.querySelector<HTMLButtonElement>(".settings-actions button")!;
    await act(async () => {
      saveButton.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(values[AI_CONFIG_STORAGE_KEY]).toMatchObject({ model: "private-model-alias" });
    expect(host.textContent).toContain("AI 设置已保存");

    await act(async () => root.unmount());
  });

  it("clears the API key when Base URL changes to another origin and preserves it for same-origin edits", async () => {
    const values: Record<string, unknown> = {
      "tab-fridge.language": "zh-CN",
      [AI_CONFIG_STORAGE_KEY]: {
        providerId: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-original-secret",
        model: "gpt-4o-mini"
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
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<ManageApp />);
      await Promise.resolve();
    });
    const baseUrlInput = host.querySelector<HTMLInputElement>("#ai-base-url")!;
    const keyInput = host.querySelector<HTMLInputElement>("#ai-key")!;
    const testButton = host.querySelector<HTMLButtonElement>(".api-key-input-wrap .connection-test-button")!;
    expect(keyInput.value).toBe("sk-original-secret");

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(baseUrlInput, "https://api.openai.com/v2");
      baseUrlInput.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    expect(keyInput.value).toBe("sk-original-secret");

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(baseUrlInput, "https://relay.example.com/v1");
      baseUrlInput.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    expect(keyInput.value).toBe("");
    expect(host.textContent).toContain("服务地址已更换，已清除原 API Key，请重新填写");

    await act(async () => {
      testButton.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(values[AI_CONFIG_STORAGE_KEY]).toMatchObject({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-original-secret",
      model: "gpt-4o-mini"
    });

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

  it("supports adding, switching, and deleting multiple AI profiles in both zh-CN and en", async () => {
    const values: Record<string, unknown> = {
      "tab-fridge.language": "zh-CN",
      [AI_CONFIG_STORAGE_KEY]: {
        providerId: "deepseek",
        baseUrl: "https://api.deepseek.com",
        apiKey: "sk-deepseek-1",
        model: "deepseek-chat"
      }
    };
    (globalThis as typeof globalThis & { chrome?: unknown }).chrome = {
      runtime: {
        getURL: (path: string) => path,
        sendMessage: async () => ({ ok: true, result: snapshot, snapshot }),
        onMessage: { addListener: () => undefined, removeListener: () => undefined }
      },
      storage: {
        local: {
          get: async () => ({ ...values }),
          set: async (items: Record<string, unknown>) => Object.assign(values, items),
          remove: async () => undefined
        },
        onChanged: { addListener: () => undefined }
      }
    };

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<ManageApp />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(host.querySelectorAll(".ai-profile-item")).toHaveLength(1);
    expect(host.textContent).toContain("使用中");

    // Click "Add profile" and save a second profile
    const addButton = [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("添加新配置"))!;
    await act(async () => addButton.click());

    const nameInput = host.querySelector<HTMLInputElement>("#ai-profile-name")!;
    const providerSelect = host.querySelector<HTMLSelectElement>("#ai-provider")!;
    const keyInput = host.querySelector<HTMLInputElement>("#ai-key")!;
    const modelInput = host.querySelector<HTMLInputElement>("#ai-model")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(nameInput, "Claude 工作");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
      providerSelect.value = "anthropic";
      providerSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(keyInput, "sk-ant-2");
      keyInput.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(modelInput, "claude-sonnet-4-5");
      modelInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const saveButton = host.querySelector<HTMLButtonElement>(".settings-actions button")!;
    await act(async () => {
      saveButton.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(host.querySelectorAll(".ai-profile-item")).toHaveLength(2);
    expect(host.textContent).toContain("Claude 工作");
    expect(values[AI_CONFIG_STORAGE_KEY]).toMatchObject({ providerId: "anthropic", model: "claude-sonnet-4-5" });

    // Switch back to the first profile
    const useButton = [...host.querySelectorAll<HTMLButtonElement>(".ai-profile-actions button")]
      .find((button) => button.textContent === "设为当前")!;
    await act(async () => {
      useButton.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(values[AI_CONFIG_STORAGE_KEY]).toMatchObject({ providerId: "deepseek", model: "deepseek-chat" });

    // Verify English labels and delete one profile
    await act(async () => { await setAppLanguage("en"); });
    expect(host.textContent).toContain("Add profile");
    expect(host.textContent).toContain("Active");
    const deleteButtons = [...host.querySelectorAll<HTMLButtonElement>(".ai-profile-actions button")]
      .filter((button) => button.textContent === "Delete profile");
    await act(async () => {
      deleteButtons[1].click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.querySelectorAll(".ai-profile-item")).toHaveLength(1);

    await act(async () => root.unmount());
  });
});
