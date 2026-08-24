import { afterEach, describe, expect, it } from "vitest";
import {
  APP_LANGUAGE_STORAGE_KEY,
  MESSAGES,
  getAppLanguage,
  initializeAppLanguage,
  setAppLanguage,
  subscribeAppLanguage,
  translate
} from "../../src/i18n";
import { buildOrganizationMessages } from "../../src/ai/prompts";

afterEach(async () => {
  await setAppLanguage("zh-CN");
  delete (globalThis as typeof globalThis & { chrome?: unknown }).chrome;
});

describe("Tab Fridge localization", () => {
  it("keeps every locale complete and non-empty", () => {
    const chineseKeys = Object.keys(MESSAGES["zh-CN"]).sort();
    const englishKeys = Object.keys(MESSAGES.en).sort();
    expect(englishKeys).toEqual(chineseKeys);
    for (const language of ["zh-CN", "en"] as const) {
      for (const key of chineseKeys) {
        const value = MESSAGES[language][key as keyof typeof MESSAGES[typeof language]];
        expect(typeof value === "function" ? value({ count: 2, name: "Test", tabs: 2, workspaces: 2, windows: 2 }) : value).not.toBe("");
      }
    }
    expect(translate("zh-CN", "common.tabsCount", { count: 2 })).toBe("2 个标签");
    expect(translate("en", "common.tabsCount", { count: 1 })).toBe("1 tab");
    expect(translate("en", "common.tabsCount", { count: 2 })).toBe("2 tabs");
    expect(translate("en", "side.aiOrganize")).toBe("Organize with AI");
    expect(translate("zh-CN", "backup.numberedSuffix", { count: 2 })).toBe("（2）");
    expect(translate("en", "backup.numberedSuffix", { count: 2 })).toBe(" (2)");
  });

  it("persists the selected language in chrome.storage.local", async () => {
    const values: Record<string, unknown> = {};
    (globalThis as typeof globalThis & { chrome?: unknown }).chrome = {
      storage: {
        local: {
          get: async () => values,
          set: async (items: Record<string, unknown>) => Object.assign(values, items)
        }
      }
    };

    await setAppLanguage("en");
    expect(values[APP_LANGUAGE_STORAGE_KEY]).toBe("en");
    expect(getAppLanguage()).toBe("en");
    values[APP_LANGUAGE_STORAGE_KEY] = "zh-CN";
    await initializeAppLanguage();
    expect(getAppLanguage()).toBe("zh-CN");
  });

  it("notifies every open extension view when the language changes", async () => {
    const seen: string[] = [];
    const unsubscribe = subscribeAppLanguage((language) => seen.push(language));

    await setAppLanguage("en");
    await setAppLanguage("zh-CN");

    expect(seen).toEqual(["en", "zh-CN"]);
    unsubscribe();
  });

  it("instructs AI workspace metadata to follow the selected language", () => {
    const tabs = [{ id: "tab-1", url: "https://example.com", title: "Example", pinned: false, kind: "normal" as const, workspaceId: null }];
    const chinese = buildOrganizationMessages({ mode: "purpose", tabs, language: "zh-CN" });
    const english = buildOrganizationMessages({ mode: "purpose", tabs, language: "en" });

    expect(chinese[0].content).toContain("Simplified Chinese");
    expect(chinese[1].content).toContain("Simplified Chinese (zh-CN)");
    expect(english[0].content).toContain("in English");
    expect(english[1].content).toContain("English (en)");
  });
});
