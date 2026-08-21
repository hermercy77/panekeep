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
      baseUrl: "https://provider.test/v1",
      apiKey: "secret",
      model: "model"
    });
    await expect(store.load()).resolves.toMatchObject({ apiKey: "secret" });
    await store.clear();
    await expect(store.load()).resolves.toMatchObject({ apiKey: "" });
  });
});
