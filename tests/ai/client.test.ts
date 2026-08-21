import { describe, expect, it } from "vitest";
import { AIHttpError, OpenAICompatibleClient } from "../../src/ai";

function response(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

const config = { baseUrl: "https://provider.test/v1", apiKey: "sk-test-secret", model: "test-model" };

describe("OpenAI-compatible client", () => {
  it("tests the connection and sends an authorization header", async () => {
    const calls: { url: string; init?: { headers?: Record<string, string> } }[] = [];
    const client = new OpenAICompatibleClient(config, {
      fetch: async (url, init) => {
        calls.push({ url, init });
        return response(200, { data: [{ id: "test-model" }] });
      }
    });

    const result = await client.testConnection();
    expect(result).toEqual({ ok: true, status: 200, models: ["test-model"] });
    expect(calls[0].url).toBe("https://provider.test/v1/models");
    expect(calls[0].init?.headers?.Authorization).toBe("Bearer sk-test-secret");
  });

  it("retries a transient 429 once", async () => {
    let attempts = 0;
    const client = new OpenAICompatibleClient(config, {
      fetch: async () => {
        attempts += 1;
        return attempts === 1
          ? response(429, { error: { message: "slow down" } })
          : response(200, { choices: [{ message: { content: '{"ok":true}' } }] });
      },
      retry: { retryDelayMs: 0 }
    });
    await expect(client.completeJSON([{
      role: "user",
      content: "return json"
    }])).resolves.toEqual({ ok: true });
    expect(attempts).toBe(2);
  });

  it("does not retry a non-transient 4xx response", async () => {
    let attempts = 0;
    const client = new OpenAICompatibleClient(config, {
      fetch: async () => {
        attempts += 1;
        return response(401, { error: { message: "bad key" } });
      }
    });
    await expect(client.testConnection()).rejects.toBeInstanceOf(AIHttpError);
    expect(attempts).toBe(1);
  });
});
