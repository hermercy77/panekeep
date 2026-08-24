// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ManageApp } from "../../src/ui/ManageApp";
import { setAppLanguage } from "../../src/i18n";
import { createBackup } from "../../src/shared/backup";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const snapshot = {
  windows: [{ key: "window:1", nativeId: 1, name: "Window 1", order: 0, isCurrent: true, expanded: true }],
  workspaces: [],
  tabs: []
};

const backup = createBackup(snapshot, "chrome", "2026-08-24T00:00:00.000Z");

afterEach(async () => {
  document.body.innerHTML = "";
  delete (globalThis as typeof globalThis & { chrome?: unknown }).chrome;
  await setAppLanguage("zh-CN");
});

describe("ManageApp backup restore report", () => {
  it("shows a bilingual list when blocked special pages are skipped", async () => {
    const values: Record<string, unknown> = { "tab-fridge.language": "zh-CN" };
    (globalThis as typeof globalThis & { chrome?: unknown }).chrome = {
      runtime: {
        getURL: (path: string) => path,
        sendMessage: async (message: { action: string }) => {
          if (message.action === "backup.import") {
            return {
              ok: true,
              result: {
                backup,
                skippedTabs: [{
                  id: "special-1",
                  title: "Blocked settings",
                  url: "chrome://blocked/",
                  reason: "browser_blocked"
                }]
              },
              snapshot
            };
          }
          return { ok: true, result: snapshot, snapshot };
        },
        onMessage: { addListener: () => undefined, removeListener: () => undefined }
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
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<ManageApp />);
      await Promise.resolve();
    });
    const input = host.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File([JSON.stringify(backup)], "backup.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: async () => JSON.stringify(backup) });
    Object.defineProperty(input, "files", { configurable: true, value: [file] });

    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(host.textContent).toContain("备份已导入");
    expect(host.textContent).toContain("1 个特殊页面未能恢复");
    expect(host.textContent).toContain("Blocked settings");
    expect(host.textContent).toContain("chrome://blocked/");
    expect(host.textContent).toContain("浏览器不允许恢复此特殊页面");

    await act(async () => { await setAppLanguage("en"); });
    expect(host.textContent).toContain("1 special page was not restored");
    expect(host.textContent).toContain("All other windows, workspaces, and tabs were imported normally.");
    expect(host.textContent).toContain("The browser blocked this special page from being restored");
    await act(async () => root.unmount());
  });
});
