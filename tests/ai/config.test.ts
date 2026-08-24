import { describe, expect, it } from "vitest";
import { AI_CONFIG_STORAGE_KEY, LocalAIConfigStore } from "../../src/ai";

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
      providerId: "custom",
      baseUrl: "https://provider.test/v1",
      apiKey: "secret",
      model: "model"
    });
    await expect(store.load()).resolves.toMatchObject({ apiKey: "secret" });
    await store.clear();
    await expect(store.load()).resolves.toMatchObject({ apiKey: "" });
  });

  it("infers a preset for configurations saved before provider selection existed", async () => {
    const values: Record<string, unknown> = {
      [AI_CONFIG_STORAGE_KEY]: { baseUrl: "https://openrouter.ai/api/v1", apiKey: "secret", model: "model" }
    };
    const store = new LocalAIConfigStore({
      get: async () => values,
      set: async (items: Record<string, unknown>) => Object.assign(values, items)
    });

    await expect(store.load()).resolves.toMatchObject({ providerId: "openrouter" });
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
});
