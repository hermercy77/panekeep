import { aiConfigSchema, aiProfileSchema, aiSettingsSchema, type AIConfig, type AIProfile, type AISettings } from "../shared/contracts";
import { AIConfigError } from "./errors";
import { getAppLanguage, translate } from "../i18n";
import { getAIProviderPreset, inferAIProviderId } from "./providers";
import { getBrowserLastError, isBrowserSignatureError } from "../browser/api";

export const DEFAULT_AI_CONFIG: AIConfig = {
  providerId: "openai",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: ""
};

/** The legacy key is kept for seamless upgrades and stays in storage.local, never storage.sync. */
export const AI_CONFIG_STORAGE_KEY = "tab-fridge.ai-config";
export const AI_SETTINGS_STORAGE_KEY = "tab-fridge.ai-settings";

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
  loadSettings(): Promise<AISettings>;
  saveProfile(
    profile: Partial<AIProfile>,
    options?: { activate?: boolean }
  ): Promise<{ settings: AISettings; profile: AIProfile }>;
  setActiveProfile(profileId: string): Promise<AISettings>;
  deleteProfile(profileId: string): Promise<AISettings>;
}

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

/** Public AI endpoints must use TLS. Plain HTTP is limited to this device. */
export function isAllowedAIBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHost(url.hostname));
  } catch {
    return false;
  }
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
      providerId: String(config.providerId ?? inferAIProviderId(String(candidate.baseUrl))).trim(),
      baseUrl: stripTrailingSlashes(String(candidate.baseUrl).trim()),
      apiKey: String(candidate.apiKey ?? "").trim(),
      model: String(candidate.model ?? "").trim()
    });

    if (!isAllowedAIBaseUrl(parsed.baseUrl)) {
      throw new AIConfigError(translate(getAppLanguage(), "ai.secureUrlRequired"));
    }

    return {
      providerId: parsed.providerId,
      baseUrl: stripTrailingSlashes(parsed.baseUrl),
      apiKey: parsed.apiKey,
      model: parsed.model
    };
  } catch (error) {
    if (error instanceof AIConfigError) throw error;
    throw new AIConfigError(translate(getAppLanguage(), "ai.invalidConfig"), error);
  }
}

function getChromeLocalStorage(): StorageAreaLike | undefined {
  const candidate = globalThis as typeof globalThis & {
    chrome?: { storage?: { local?: StorageAreaLike } };
  };
  return candidate.chrome?.storage?.local;
}

async function invokeStorage<T>(invoke: (callback?: (value: T) => void) => Promise<T> | void): Promise<T> {
  try {
    const result = invoke();
    if (result !== undefined) return await result;
  } catch (error) {
    if (!isBrowserSignatureError(error)) throw error;
  }
  return new Promise<T>((resolve, reject) => {
    const result = invoke((value) => {
      const error = getBrowserLastError();
      if (error) reject(error);
      else resolve(value);
    });
    if (result !== undefined) void result.then(resolve, reject);
  });
}

function storageGet(storage: StorageAreaLike, keys: string | string[]): Promise<Record<string, unknown>> {
  return invokeStorage((callback) => callback ? storage.get(keys, callback) : storage.get(keys));
}

function storageSet(storage: StorageAreaLike, items: Record<string, unknown>): Promise<void> {
  return invokeStorage((callback) => callback ? storage.set(items, callback) : storage.set(items));
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

function makeProfileId(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  return randomUuid ? `ai-profile-${randomUuid}` : `ai-profile-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function defaultAIProfileName(config: Pick<AIConfig, "providerId" | "baseUrl" | "model">): string {
  const preset = getAIProviderPreset(config.providerId);
  const providerLabel = preset
    ? translate(getAppLanguage(), preset.nameKey)
    : (() => {
        try {
          return new URL(config.baseUrl).hostname || translate(getAppLanguage(), "manage.providerCustom");
        } catch {
          return translate(getAppLanguage(), "manage.providerCustom");
        }
      })();
  return config.model.trim() ? `${providerLabel} · ${config.model.trim()}` : providerLabel;
}

export function normalizeAIProfile(profile: Partial<AIProfile> = {}): AIProfile {
  const base = normalizeAIConfig(profile);
  const id = String(profile.id ?? "").trim() || makeProfileId();
  const name = String(profile.name ?? "").trim() || defaultAIProfileName(base);
  return aiProfileSchema.parse({ ...base, id, name });
}

function toAIConfig(profile: AIProfile): AIConfig {
  return {
    providerId: profile.providerId,
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    model: profile.model
  };
}

function hasMeaningfulConfig(config: AIConfig): boolean {
  return Boolean(
    config.apiKey.trim()
    || config.model.trim()
    || config.providerId !== DEFAULT_AI_CONFIG.providerId
    || config.baseUrl !== DEFAULT_AI_CONFIG.baseUrl
  );
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
    const { remove } = this.storage;
    if (remove) {
      await invokeStorage<void>((callback) => callback
        ? remove.call(this.storage, AI_CONFIG_STORAGE_KEY, callback)
        : remove.call(this.storage, AI_CONFIG_STORAGE_KEY));
      return;
    }
    await this.save(DEFAULT_AI_CONFIG);
  }

  async loadSettings(): Promise<AISettings> {
    const items = await storageGet(this.storage, [AI_SETTINGS_STORAGE_KEY, AI_CONFIG_STORAGE_KEY]);
    const rawSettings = items[AI_SETTINGS_STORAGE_KEY];
    if (rawSettings && typeof rawSettings === "object" && !Array.isArray(rawSettings)) {
      const candidate = rawSettings as { activeProfileId?: unknown; profiles?: unknown };
      const rawProfiles = Array.isArray(candidate.profiles) ? candidate.profiles : [];
      const profiles: AIProfile[] = [];
      const seenIds = new Set<string>();
      for (const entry of rawProfiles) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
        try {
          const normalized = normalizeAIProfile(entry as Partial<AIProfile>);
          if (seenIds.has(normalized.id)) continue;
          seenIds.add(normalized.id);
          profiles.push(normalized);
        } catch {
          // Drop corrupted profile entries rather than breaking the whole settings UI.
        }
      }
      const requestedActive = typeof candidate.activeProfileId === "string" ? candidate.activeProfileId : null;
      const activeProfileId = requestedActive && profiles.some((item) => item.id === requestedActive)
        ? requestedActive
        : profiles[0]?.id ?? null;
      return aiSettingsSchema.parse({ activeProfileId, profiles });
    }

    const legacyRaw = items[AI_CONFIG_STORAGE_KEY];
    if (legacyRaw && typeof legacyRaw === "object" && !Array.isArray(legacyRaw)) {
      try {
        const legacy = normalizeAIConfig(legacyRaw as Partial<AIConfig>);
        if (hasMeaningfulConfig(legacy)) {
          const migrated = normalizeAIProfile({ ...legacy, id: "ai-profile-default" });
          return aiSettingsSchema.parse({ activeProfileId: migrated.id, profiles: [migrated] });
        }
      } catch {
        // Ignore invalid legacy payload and return empty profiles.
      }
    }
    return { activeProfileId: null, profiles: [] };
  }

  private async persistSettings(settings: AISettings): Promise<AISettings> {
    const active = settings.profiles.find((item) => item.id === settings.activeProfileId) ?? settings.profiles[0] ?? null;
    const nextSettings: AISettings = {
      activeProfileId: active?.id ?? null,
      profiles: settings.profiles
    };
    const activeConfig = active ? toAIConfig(active) : { ...DEFAULT_AI_CONFIG };
    await storageSet(this.storage, {
      [AI_SETTINGS_STORAGE_KEY]: nextSettings,
      [AI_CONFIG_STORAGE_KEY]: activeConfig
    });
    return nextSettings;
  }

  async saveProfile(
    profile: Partial<AIProfile>,
    options: { activate?: boolean } = {}
  ): Promise<{ settings: AISettings; profile: AIProfile }> {
    const current = await this.loadSettings();
    const normalized = normalizeAIProfile(profile);
    const exists = current.profiles.some((item) => item.id === normalized.id);
    const profiles = exists
      ? current.profiles.map((item) => (item.id === normalized.id ? normalized : item))
      : [...current.profiles, normalized];
    const shouldActivate = options.activate ?? (!exists || current.activeProfileId === null || current.activeProfileId === normalized.id);
    const activeProfileId = shouldActivate ? normalized.id : current.activeProfileId ?? normalized.id;
    const settings = await this.persistSettings({ activeProfileId, profiles });
    return { settings, profile: normalized };
  }

  async setActiveProfile(profileId: string): Promise<AISettings> {
    const current = await this.loadSettings();
    if (!current.profiles.some((item) => item.id === profileId)) {
      throw new AIConfigError(translate(getAppLanguage(), "ai.invalidConfig"));
    }
    return this.persistSettings({ ...current, activeProfileId: profileId });
  }

  async deleteProfile(profileId: string): Promise<AISettings> {
    const current = await this.loadSettings();
    const profiles = current.profiles.filter((item) => item.id !== profileId);
    const activeProfileId = current.activeProfileId === profileId
      ? profiles[0]?.id ?? null
      : current.activeProfileId;
    return this.persistSettings({ activeProfileId, profiles });
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
