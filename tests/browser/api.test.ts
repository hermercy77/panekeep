import { afterEach, describe, expect, it, vi } from "vitest";
import { invokeBrowser } from "../../src/browser/api";

const originalChrome = (globalThis as { chrome?: unknown }).chrome;

afterEach(() => {
  Object.assign(globalThis, { chrome: originalChrome });
});

describe("browser API invocation", () => {
  it.each(["No tab with id: 42", "Permission denied"])("reports a business failure after one call (%s)", async (message) => {
    const error = new Error(message);
    const remove = vi.fn().mockRejectedValue(error);
    await expect(invokeBrowser({ remove }, "remove", 42)).rejects.toBe(error);
    expect(remove).toHaveBeenCalledExactlyOnceWith(42, expect.any(Function));
  });

  it("reports a synchronous business failure after one call", async () => {
    const error = new Error("Permission denied");
    const remove = vi.fn(() => { throw error; });
    await expect(invokeBrowser({ remove }, "remove", 42)).rejects.toBe(error);
    expect(remove).toHaveBeenCalledOnce();
  });

  it.each([false, true])("retries in Promise form for a callback signature error (async %s)", async (asynchronous) => {
    const remove = vi.fn((_id: number, callback?: () => void) => {
      if (callback) {
        const error = new TypeError("Expected at most 1 argument for tabs.remove(), got 2");
        if (asynchronous) return Promise.reject(error);
        throw error;
      }
      return Promise.resolve();
    });
    await expect(invokeBrowser({ remove }, "remove", 42)).resolves.toBeUndefined();
    expect(remove.mock.calls).toEqual([[42, expect.any(Function)], [42]]);
  });

  it("reads callback runtime.lastError and rejects without an unchecked Chrome error", async () => {
    const runtime: { lastError?: { message?: string } } = {};
    Object.assign(globalThis, { chrome: { runtime } });
    const owner = {
      move: vi.fn((_groupId: number, _details: { index: number }, callback: (value?: unknown) => void) => {
        runtime.lastError = { message: "Cannot move the group to an index that is in the middle of another group." };
        callback(undefined);
        delete runtime.lastError;
      })
    };

    await expect(invokeBrowser(owner, "move", 10, { index: 3 }))
      .rejects.toThrow("Cannot move the group to an index that is in the middle of another group.");
    expect(owner.move).toHaveBeenCalledOnce();
  });
});
