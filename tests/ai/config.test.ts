import { describe, expect, it } from "vitest";
import { AI_CONFIG_STORAGE_KEY, LocalAIConfigStore, describeModelAvailability } from "../../src/ai";

describe("local AI config storage", () => {
  it("stores and loads API configuration through the injected local area", async () => {
    const values: Record<string, unknown> = {};
    const storage = {
      get: async () => values,
      set: async (items: Record<string, unknown>) => Object.assign(values, items),
      remove: async (key: string) => delete values[key]
    };
    const store = new LocalAIConfigStore(storage);
    await store.save({ baseUrl: "https://provider.test/v1/", apiKey: " secret ", model: " model " });
    expect(values[AI_CONFIG_STORAGE_KEY]).toEqual({
      baseUrl: "https://provider.test/v1",
      apiKey: "secret",
      model: "model"
    });
    await expect(store.load()).resolves.toMatchObject({ apiKey: "secret" });
    await store.clear();
    await expect(store.load()).resolves.toMatchObject({ apiKey: "" });
  });

  it("supports callback-style Chrome storage implementations", async () => {
    const values: Record<string, unknown> = {};
    const storage = {
      get: (_keys?: unknown, callback?: (items: Record<string, unknown>) => void) => {
        if (callback) queueMicrotask(() => callback(values));
      },
      set: (items: Record<string, unknown>, callback?: () => void) => {
        Object.assign(values, items);
        if (callback) queueMicrotask(callback);
      },
      remove: (key: string | string[], callback?: () => void) => {
        for (const item of typeof key === "string" ? [key] : key) delete values[item];
        if (callback) queueMicrotask(callback);
      }
    };
    const store = new LocalAIConfigStore(storage);
    await store.save({ baseUrl: "https://api.deepseek.com", apiKey: "secret", model: "deepseek-v4-flash" });
    await expect(store.load()).resolves.toMatchObject({ model: "deepseek-v4-flash", apiKey: "secret" });
  });

  it("reports a configured model that is missing from the provider list", () => {
    expect(describeModelAvailability("deepseekv4flash", ["deepseek-v4-pro", "deepseek-v4-flash"])).toEqual({
      tone: "error",
      message: "连接成功，但模型「deepseekv4flash」不可用。可用模型：deepseek-v4-pro、deepseek-v4-flash"
    });
    expect(describeModelAvailability("deepseek-v4-flash", ["deepseek-v4-flash"])).toEqual({
      tone: "success",
      message: "连接成功，可用模型 1 个"
    });
    expect(describeModelAvailability("missing", ["available"], "en")).toEqual({
      tone: "error",
      message: "Connected, but “missing” is unavailable. Available models: available"
    });
  });
});
