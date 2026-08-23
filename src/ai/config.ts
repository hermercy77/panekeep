import { aiConfigSchema, type AIConfig } from "../shared/contracts";
import { AIConfigError } from "./errors";

export const DEFAULT_AI_CONFIG: AIConfig = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: ""
};

/** The key is deliberately kept in storage.local, never storage.sync. */
export const AI_CONFIG_STORAGE_KEY = "tab-fridge.ai-config";

export interface StorageAreaLike {
  get(
    keys?: string | string[] | Record<string, unknown> | null,
    callback?: (items: Record<string, unknown>) => void
  ): Promise<Record<string, unknown>> | void;
  set(
    items: Record<string, unknown>,
    callback?: () => void
  ): Promise<void> | void;
  remove?(keys: string | string[], callback?: () => void): Promise<void> | void;
}

export interface AIConfigStore {
  load(): Promise<AIConfig>;
  save(config: Partial<AIConfig>): Promise<AIConfig>;
  clear(): Promise<void>;
}

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

/**
 * Normalize and validate user-supplied settings at the storage boundary.
 * The API key is not logged or otherwise transformed beyond whitespace trim.
 */
export function normalizeAIConfig(config: Partial<AIConfig> = {}): AIConfig {
  const candidate = {
    ...DEFAULT_AI_CONFIG,
    ...config
  };

  try {
    const parsed = aiConfigSchema.parse({
      ...candidate,
      baseUrl: stripTrailingSlashes(String(candidate.baseUrl).trim()),
      apiKey: String(candidate.apiKey ?? "").trim(),
      model: String(candidate.model ?? "").trim()
    });

    return {
      baseUrl: stripTrailingSlashes(parsed.baseUrl),
      apiKey: parsed.apiKey,
      model: parsed.model
    };
  } catch (error) {
    throw new AIConfigError("Invalid AI configuration", error);
  }
}

function getChromeLocalStorage(): StorageAreaLike | undefined {
  const candidate = globalThis as typeof globalThis & {
    chrome?: { storage?: { local?: StorageAreaLike } };
  };
  return candidate.chrome?.storage?.local;
}

async function storageGet(storage: StorageAreaLike, keys: string | string[]): Promise<Record<string, unknown>> {
  try {
    const result = storage.get(keys);
    if (result && typeof (result as Promise<Record<string, unknown>>).then === "function") {
      return await result;
    }
  } catch {
    // Older callback-only implementations are handled below.
  }
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    try {
      storage.get(keys, (items) => resolve(items));
    } catch (error) {
      reject(error);
    }
  });
}

async function storageSet(storage: StorageAreaLike, items: Record<string, unknown>): Promise<void> {
  try {
    const result = storage.set(items);
    if (result && typeof (result as Promise<void>).then === "function") {
      await result;
      return;
    }
  } catch {
    // Older callback-only implementations are handled below.
  }
  await new Promise<void>((resolve, reject) => {
    try {
      storage.set(items, () => resolve());
    } catch (error) {
      reject(error);
    }
  });
}

async function storageRemove(storage: StorageAreaLike, keys: string | string[]): Promise<void> {
  if (!storage.remove) return;
  try {
    const result = storage.remove(keys);
    if (result && typeof (result as Promise<void>).then === "function") {
      await result;
      return;
    }
  } catch {
    // Older callback-only implementations are handled below.
  }
  await new Promise<void>((resolve, reject) => {
    try {
      storage.remove?.(keys, () => resolve());
    } catch (error) {
      reject(error);
    }
  });
}

class InMemoryStorageArea implements StorageAreaLike {
  private readonly values = new Map<string, unknown>();

  get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>> {
    const requested =
      typeof keys === "string"
        ? [keys]
        : Array.isArray(keys)
          ? keys
          : keys && typeof keys === "object"
            ? Object.keys(keys)
            : [...this.values.keys()];
    const result: Record<string, unknown> = {};
    for (const key of requested) {
      if (this.values.has(key)) result[key] = this.values.get(key);
    }
    return Promise.resolve(result);
  }

  set(items: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(items)) this.values.set(key, value);
    return Promise.resolve();
  }

  remove(keys: string | string[]): Promise<void> {
    for (const key of typeof keys === "string" ? [keys] : keys) this.values.delete(key);
    return Promise.resolve();
  }
}

let defaultMemoryStorage: StorageAreaLike | undefined;

function defaultStorage(): StorageAreaLike {
  const local = getChromeLocalStorage();
  if (local) return local;
  defaultMemoryStorage ??= new InMemoryStorageArea();
  return defaultMemoryStorage;
}

export class LocalAIConfigStore implements AIConfigStore {
  constructor(private readonly storage: StorageAreaLike = defaultStorage()) {}

  async load(): Promise<AIConfig> {
    const items = await storageGet(this.storage, AI_CONFIG_STORAGE_KEY);
    const stored = items[AI_CONFIG_STORAGE_KEY];
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
      return { ...DEFAULT_AI_CONFIG };
    }
    return normalizeAIConfig(stored as Partial<AIConfig>);
  }

  async save(config: Partial<AIConfig>): Promise<AIConfig> {
    const normalized = normalizeAIConfig(config);
    await storageSet(this.storage, { [AI_CONFIG_STORAGE_KEY]: normalized });
    return normalized;
  }

  async clear(): Promise<void> {
    if (this.storage.remove) {
      await storageRemove(this.storage, AI_CONFIG_STORAGE_KEY);
      return;
    }
    await this.save(DEFAULT_AI_CONFIG);
  }
}

export function createAIConfigStore(storage?: StorageAreaLike): AIConfigStore {
  return new LocalAIConfigStore(storage ?? defaultStorage());
}

export async function loadAIConfig(storage?: StorageAreaLike): Promise<AIConfig> {
  return createAIConfigStore(storage).load();
}

export async function saveAIConfig(
  config: Partial<AIConfig>,
  storage?: StorageAreaLike
): Promise<AIConfig> {
  return createAIConfigStore(storage).save(config);
}

export async function clearAIConfig(storage?: StorageAreaLike): Promise<void> {
  return createAIConfigStore(storage).clear();
}
