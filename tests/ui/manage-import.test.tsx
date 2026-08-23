// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ManageApp } from "../../src/ui/ManageApp";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ManageApp backup import", () => {
  it("lets the application validate the selected file instead of relying on OS MIME filtering", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<ManageApp />);
      await Promise.resolve();
    });

    const input = host.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    expect(input?.hasAttribute("accept")).toBe(false);
    await act(async () => root.unmount());
  });
});
