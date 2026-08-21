import { describe, expect, it } from "vitest";
import { createDebugLogger, redactSecrets } from "../../src/debug";

describe("developer debug logging", () => {
  it("redacts API keys, authorization headers, and nested secrets", () => {
    const entries: unknown[] = [];
    const logger = createDebugLogger({ enabled: true, sink: (entry) => entries.push(entry) });
    logger.debug("request", { apiKey: "sk-secret-123456", headers: { Authorization: "Bearer super-secret" } });
    expect(JSON.stringify(entries)).not.toContain("sk-secret-123456");
    expect(JSON.stringify(entries)).not.toContain("super-secret");
    expect(redactSecrets({ token: "secret-token" })).toEqual({ token: "[REDACTED]" });
  });

  it("does not emit when developer mode is disabled", () => {
    const entries: unknown[] = [];
    createDebugLogger({ enabled: false, sink: (entry) => entries.push(entry) }).info("ignored");
    expect(entries).toHaveLength(0);
  });
});
