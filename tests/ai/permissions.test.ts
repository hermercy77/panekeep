import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureAIOriginPermission } from "../../src/ai";

const originalChrome = (globalThis as { chrome?: unknown }).chrome;
const originalBrowser = (globalThis as { browser?: unknown }).browser;

afterEach(() => {
  Object.assign(globalThis, { chrome: originalChrome, browser: originalBrowser });
});

describe("AI origin permissions", () => {
  it.each([
    ["https://provider.test:8443/v1", "https://provider.test/*"],
    ["http://localhost:11434/v1", "http://localhost/*"],
    ["http://127.0.0.1:8080/v1", "http://127.0.0.1/*"]
  ])("requests only the configured host without a port", async (baseUrl, expectedPattern) => {
    const contains = vi.fn(async () => false);
    const request = vi.fn(async () => true);
    Object.assign(globalThis, { chrome: { permissions: { contains, request } }, browser: undefined });

    await ensureAIOriginPermission(baseUrl);

    expect(contains).toHaveBeenCalledWith({ origins: [expectedPattern] });
    expect(request).toHaveBeenCalledWith({ origins: [expectedPattern] });
  });
});
