import { afterEach, describe, expect, it } from "vitest";
import { invokeBrowser } from "../../src/browser/api";

const originalChrome = (globalThis as { chrome?: unknown }).chrome;

afterEach(() => {
  Object.assign(globalThis, { chrome: originalChrome });
});

describe("browser API invocation", () => {
  it("reads callback runtime.lastError and rejects without an unchecked Chrome error", async () => {
    const runtime: { lastError?: { message?: string } } = {};
    Object.assign(globalThis, { chrome: { runtime } });
    const owner = {
      move: (_groupId: number, _details: { index: number }, callback: (value?: unknown) => void) => {
        runtime.lastError = { message: "Cannot move the group to an index that is in the middle of another group." };
        callback(undefined);
        delete runtime.lastError;
      }
    };

    await expect(invokeBrowser(owner, "move", 10, { index: 3 }))
      .rejects.toThrow("Cannot move the group to an index that is in the middle of another group.");
  });
});
