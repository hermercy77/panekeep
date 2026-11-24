import { afterEach, describe, expect, it, vi } from "vitest";
import { AI_CONFIG_STORAGE_KEY, AI_SETTINGS_STORAGE_KEY, LocalAIConfigStore, isAllowedAIBaseUrl } from "../../src/ai";

afterEach(() => vi.unstubAllGlobals());

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

  it("requires HTTPS except for loopback AI servers", async () => {
    expect(isAllowedAIBaseUrl("https://provider.test/v1")).toBe(true);
    expect(isAllowedAIBaseUrl("http://localhost:11434/v1")).toBe(true);
    expect(isAllowedAIBaseUrl("http://127.0.0.1:8080/v1")).toBe(true);
    expect(isAllowedAIBaseUrl("http://provider.test/v1")).toBe(false);
    expect(isAllowedAIBaseUrl("http://192.168.1.20:11434/v1")).toBe(false);

    const store = new LocalAIConfigStore({ get: async () => ({}), set: async () => undefined });
    await expect(store.save({ baseUrl: "http://provider.test/v1" })).rejects.toThrow("HTTPS");
  });

  it("propagates rejected Promise storage operations without a callback retry", async () => {
    const error = new Error("Storage access denied");
    const storage = {
      get: vi.fn().mockRejectedValue(error),
      set: vi.fn().mockRejectedValue(error),
      remove: vi.fn().mockRejectedValue(error)
    };
    const store = new LocalAIConfigStore(storage);

    await expect(store.load()).rejects.toBe(error);
    await expect(store.save({ model: "new-model" })).rejects.toBe(error);
    await expect(store.clear()).rejects.toBe(error);
    expect(storage.get).toHaveBeenCalledExactlyOnceWith(AI_CONFIG_STORAGE_KEY);
    expect(storage.set).toHaveBeenCalledExactlyOnceWith({
      [AI_CONFIG_STORAGE_KEY]: expect.objectContaining({ model: "new-model" })
    });
    expect(storage.remove).toHaveBeenCalledExactlyOnceWith(AI_CONFIG_STORAGE_KEY);
  });

  it("propagates runtime.lastError from callback storage methods", async () => {
    const runtime: { lastError?: { message: string } } = {};
    vi.stubGlobal("chrome", { runtime });
    const report = (callback: () => void) => {
      runtime.lastError = { message: "Storage quota exceeded" };
      callback();
      delete runtime.lastError;
    };
    const storage = {
      get: (_key?: unknown, callback?: (items: Record<string, unknown>) => void) => {
        if (!callback) throw new TypeError("No matching signature");
        report(() => callback({}));
      },
      set: (_items: Record<string, unknown>, callback?: () => void) => {
        if (!callback) return Promise.reject(new TypeError("Callback is required"));
        report(callback);
      },
      remove: (_key: unknown, callback?: () => void) => {
        if (callback) report(callback);
      }
    };
    const store = new LocalAIConfigStore(storage);

    await expect(store.load()).rejects.toThrow("Storage quota exceeded");
    await expect(store.save({ model: "new-model" })).rejects.toThrow("Storage quota exceeded");
    await expect(store.clear()).rejects.toThrow("Storage quota exceeded");
  });

  it("migrates legacy single config and supports adding, switching, editing, and deleting multiple AI profiles", async () => {
    const values: Record<string, unknown> = {
      [AI_CONFIG_STORAGE_KEY]: {
        providerId: "deepseek",
        baseUrl: "https://api.deepseek.com",
        apiKey: "sk-deepseek",
        model: "deepseek-chat"
      }
    };
    const storage = {
      get: async () => ({ ...values }),
      set: async (items: Record<string, unknown>) => Object.assign(values, items),
      remove: async (key: string | string[]) => {
        for (const item of typeof key === "string" ? [key] : key) delete values[item];
      }
    };
    const store = new LocalAIConfigStore(storage);

    // Migrates existing single config on read
    const migrated = await store.loadSettings();
    expect(migrated.profiles).toHaveLength(1);
    expect(migrated.activeProfileId).toBe("ai-profile-default");
    expect(migrated.profiles[0]).toMatchObject({ providerId: "deepseek", model: "deepseek-chat" });

    // Add a second profile
    const added = await store.saveProfile({
      name: "Claude Review",
      providerId: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "sk-ant",
      model: "claude-sonnet-4-5"
    });
    expect(added.settings.profiles).toHaveLength(2);
    expect(added.settings.activeProfileId).toBe(added.profile.id);
    expect(values[AI_SETTINGS_STORAGE_KEY]).toMatchObject({ activeProfileId: added.profile.id });
    expect(values[AI_CONFIG_STORAGE_KEY]).toMatchObject({ providerId: "anthropic", model: "claude-sonnet-4-5" });

    // Switch back to the first profile
    const switched = await store.setActiveProfile("ai-profile-default");
    expect(switched.activeProfileId).toBe("ai-profile-default");
    await expect(store.load()).resolves.toMatchObject({ providerId: "deepseek", model: "deepseek-chat" });

    // Delete the active profile and confirm fallback to the remaining profile
    const afterDelete = await store.deleteProfile("ai-profile-default");
    expect(afterDelete.profiles).toHaveLength(1);
    expect(afterDelete.activeProfileId).toBe(added.profile.id);
    await expect(store.load()).resolves.toMatchObject({ providerId: "anthropic", model: "claude-sonnet-4-5" });
  });
});
