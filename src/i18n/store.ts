import {
  APP_LANGUAGE_STORAGE_KEY,
  DEFAULT_APP_LANGUAGE,
  isAppLanguage,
  type AppLanguage
} from "./catalog";

type Listener = (language: AppLanguage) => void;
type StorageArea = {
  get: (key: string, callback?: (items: Record<string, unknown>) => void) => Promise<Record<string, unknown>> | void;
  set: (items: Record<string, unknown>, callback?: () => void) => Promise<void> | void;
};

let currentLanguage: AppLanguage = DEFAULT_APP_LANGUAGE;
const listeners = new Set<Listener>();
let storageListenerRegistered = false;

function storageLocal(): StorageArea | undefined {
  return (globalThis as typeof globalThis & { chrome?: { storage?: { local?: StorageArea } } }).chrome?.storage?.local;
}

function publish(language: AppLanguage): void {
  currentLanguage = language;
  if (typeof document !== "undefined") document.documentElement.setAttribute("lang", language);
  for (const listener of listeners) listener(language);
}

async function readStorage(storage: StorageArea): Promise<Record<string, unknown>> {
  const result = storage.get(APP_LANGUAGE_STORAGE_KEY);
  if (result && typeof (result as Promise<Record<string, unknown>>).then === "function") return result;
  return new Promise((resolve) => storage.get(APP_LANGUAGE_STORAGE_KEY, resolve));
}

async function writeStorage(storage: StorageArea, language: AppLanguage): Promise<void> {
  const result = storage.set({ [APP_LANGUAGE_STORAGE_KEY]: language });
  if (result && typeof (result as Promise<void>).then === "function") await result;
  else await new Promise<void>((resolve) => storage.set({ [APP_LANGUAGE_STORAGE_KEY]: language }, resolve));
}

function registerStorageListener(): void {
  if (storageListenerRegistered) return;
  const storage = (globalThis as typeof globalThis & {
    chrome?: { storage?: { onChanged?: { addListener?: (listener: (changes: Record<string, { newValue?: unknown }>, area: string) => void) => void } } };
  }).chrome?.storage;
  if (!storage?.onChanged?.addListener) return;
  storageListenerRegistered = true;
  storage.onChanged.addListener((changes, area) => {
    const next = changes[APP_LANGUAGE_STORAGE_KEY]?.newValue;
    if (area === "local" && isAppLanguage(next)) publish(next);
  });
}

export function getAppLanguage(): AppLanguage {
  return currentLanguage;
}

export async function initializeAppLanguage(): Promise<AppLanguage> {
  registerStorageListener();
  const storage = storageLocal();
  if (!storage) return currentLanguage;
  try {
    const stored = (await readStorage(storage))[APP_LANGUAGE_STORAGE_KEY];
    if (isAppLanguage(stored)) publish(stored);
  } catch {
    // Keep the deterministic default when storage is unavailable.
  }
  return currentLanguage;
}

export async function setAppLanguage(language: AppLanguage): Promise<void> {
  publish(language);
  const storage = storageLocal();
  if (storage) await writeStorage(storage, language);
}

export function subscribeAppLanguage(listener: Listener): () => void {
  registerStorageListener();
  listeners.add(listener);
  return () => listeners.delete(listener);
}
