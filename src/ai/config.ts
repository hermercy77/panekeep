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

function invokeStorage<T>(
  method: (...args: never[]) => Promise<T> | void,
  args: unknown[],
  callbackResult: T
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (value: T) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    try {
      const result = method(...([...args, (value: T) => finish(value)] as never[]));
      if (result && typeof (result as Promise<T>).then === "function") {
        (result as Promise<T>).then(finish, (error) => {
          if (!settled) {
            settled = true;
            reject(error);
          }
        });
      } else if (method.length <= args.length) {
        finish(callbackResult);
      }
    } catch (error) {
      settled = true;
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
    const items = await invokeStorage<Record<string, unknown>>(
      this.storage.get.bind(this.storage) as (...args: never[]) => Promise<Record<string, unknown>> | void,
      [AI_CONFIG_STORAGE_KEY],
      {}
    );
    const stored = items[AI_CONFIG_STORAGE_KEY];
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
      return { ...DEFAULT_AI_CONFIG };
    }
    return normalizeAIConfig(stored as Partial<AIConfig>);
  }

  async save(config: Partial<AIConfig>): Promise<AIConfig> {
    const normalized = normalizeAIConfig(config);
    await invokeStorage<void>(
      this.storage.set.bind(this.storage) as (...args: never[]) => Promise<void> | void,
      [{ [AI_CONFIG_STORAGE_KEY]: normalized }],
      undefined
    );
    return normalized;
  }

  async clear(): Promise<void> {
    if (this.storage.remove) {
      await invokeStorage<void>(
        this.storage.remove.bind(this.storage) as (...args: never[]) => Promise<void> | void,
        [AI_CONFIG_STORAGE_KEY],
        undefined
      );
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
