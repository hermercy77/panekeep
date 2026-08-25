import { describe, expect, it } from "vitest";
import { AIHttpError, AITimeoutError, OpenAICompatibleClient } from "../../src/ai";
import { AI_PROVIDER_PRESETS } from "../../src/ai/providers";

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
  it("uses the configured model-list endpoint and authentication for every preset", async () => {
    for (const provider of AI_PROVIDER_PRESETS) {
      let requestUrl = "";
      let requestHeaders: Record<string, string> | undefined;
      const client = new OpenAICompatibleClient({
        providerId: provider.id,
        baseUrl: provider.baseUrl,
        apiKey: "provider-test-key",
        model: ""
      }, {
        fetch: async (url, init) => {
          requestUrl = url;
          requestHeaders = init?.headers;
          return response(200, { data: [] });
        }
      });

      await client.testConnection();

      expect(requestUrl).toBe(`${provider.baseUrl}/models`);
      if (provider.id === "anthropic") {
        expect(requestHeaders).toMatchObject({ "x-api-key": "provider-test-key", "anthropic-version": "2023-06-01" });
        expect(requestHeaders).not.toHaveProperty("Authorization");
      } else expect(requestHeaders?.Authorization).toBe("Bearer provider-test-key");
    }
  });

  it("uses the correct completion protocol path for every preset", async () => {
    for (const provider of AI_PROVIDER_PRESETS) {
      let requestUrl = "";
      const client = new OpenAICompatibleClient({
        providerId: provider.id,
        baseUrl: provider.baseUrl,
        apiKey: "provider-test-key",
        model: "provider-test-model"
      }, {
        fetch: async (url) => {
          requestUrl = url;
          return provider.id === "anthropic"
            ? response(200, { content: [{ type: "text", text: '{"ok":true}' }] })
            : response(200, { choices: [{ message: { content: '{"ok":true}' } }] });
        }
      });

      await client.completeJSON([{ role: "user", content: "classify" }]);
      expect(requestUrl).toBe(`${provider.baseUrl}/${provider.id === "anthropic" ? "messages" : "chat/completions"}`);
    }
  });

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

  it("uses Anthropic's native authentication for its model list", async () => {
    const calls: { url: string; init?: { headers?: Record<string, string> } }[] = [];
    const client = new OpenAICompatibleClient({
      providerId: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "anthropic-test",
      model: ""
    }, {
      fetch: async (url, init) => {
        calls.push({ url, init });
        return response(200, { data: [{ id: "claude-test" }] });
      }
    });

    await client.testConnection();

    expect(calls[0].url).toBe("https://api.anthropic.com/v1/models");
    expect(calls[0].init?.headers).toMatchObject({
      "x-api-key": "anthropic-test",
      "anthropic-version": "2023-06-01"
    });
    expect(calls[0].init?.headers).not.toHaveProperty("Authorization");
  });

  it("uses Anthropic's native Messages request", async () => {
    let requestBody: Record<string, unknown> | undefined;
    let requestUrl = "";
    const client = new OpenAICompatibleClient({
      providerId: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "anthropic-test",
      model: "claude-sonnet-test"
    }, {
      fetch: async (url, init) => {
        requestUrl = url;
        requestBody = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
        return response(200, { content: [{ type: "text", text: '{"ok":true}' }] });
      }
    });

    await client.completeJSON([
      { role: "system", content: "Return JSON" },
      { role: "user", content: "classify" }
    ]);

    expect(requestUrl).toBe("https://api.anthropic.com/v1/messages");
    expect(requestBody).toHaveProperty("system", "Return JSON");
    expect(requestBody).toHaveProperty("messages", [{ role: "user", content: "classify" }]);
    expect(requestBody).not.toHaveProperty("temperature");
    expect(requestBody).not.toHaveProperty("response_format");
    expect(requestBody).not.toHaveProperty("thinking");
  });

  it("falls back when a provider cannot disable thinking", async () => {
    const requestBodies: Record<string, unknown>[] = [];
    const client = new OpenAICompatibleClient({
      providerId: "volcengine-ark",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      apiKey: "test",
      model: "doubao-test"
    }, {
      fetch: async (_url, init) => {
        const requestBody = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
        requestBodies.push(requestBody);
        return requestBodies.length === 1
          ? response(400, { error: { message: "thinking.type.disabled is not supported for this model" } })
          : response(200, { choices: [{ message: { content: '{"ok":true}' } }] });
      }
    });

    await expect(client.completeJSON([{ role: "user", content: "classify" }])).resolves.toEqual({ ok: true });
    expect(requestBodies[0]).toHaveProperty("thinking", { type: "disabled" });
    expect(requestBodies[1]).not.toHaveProperty("thinking");
  });

  it("uses a valid near-deterministic temperature for Zhipu", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const client = new OpenAICompatibleClient({
      providerId: "zhipu",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      apiKey: "zhipu-test",
      model: "glm-test"
    }, {
      fetch: async (_url, init) => {
        requestBody = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
        return response(200, { choices: [{ message: { content: '{"ok":true}' } }] });
      }
    });

    await client.completeJSON([{ role: "user", content: "classify" }]);

    expect(requestBody).toHaveProperty("temperature", 0.01);
  });

  it("disables provider-specific thinking for common low-latency presets", async () => {
    const bodies = new Map<string, Record<string, unknown>>();
    for (const provider of [
      { providerId: "volcengine-ark", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-test" },
      { providerId: "alibaba-model-studio", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-test" },
      { providerId: "siliconflow", baseUrl: "https://api.siliconflow.cn/v1", model: "Qwen/test" }
    ]) {
      const client = new OpenAICompatibleClient({ ...provider, apiKey: "test" }, {
        fetch: async (_url, init) => {
          bodies.set(provider.providerId, JSON.parse(init?.body ?? "{}") as Record<string, unknown>);
          return response(200, { choices: [{ message: { content: '{"ok":true}' } }] });
        }
      });
      await client.completeJSON([{ role: "user", content: "classify" }]);
    }

    expect(bodies.get("volcengine-ark")).toHaveProperty("thinking", { type: "disabled" });
    expect(bodies.get("alibaba-model-studio")).toHaveProperty("enable_thinking", false);
    expect(bodies.get("siliconflow")).toHaveProperty("enable_thinking", false);
  });

  it("falls back when a provider rejects enable_thinking", async () => {
    const requestBodies: Record<string, unknown>[] = [];
    const client = new OpenAICompatibleClient({
      providerId: "siliconflow",
      baseUrl: "https://api.siliconflow.cn/v1",
      apiKey: "test",
      model: "model-without-toggle"
    }, {
      fetch: async (_url, init) => {
        const requestBody = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
        requestBodies.push(requestBody);
        return requestBodies.length === 1
          ? response(400, { error: { message: "enable_thinking is unsupported" } })
          : response(200, { choices: [{ message: { content: '{"ok":true}' } }] });
      }
    });

    await expect(client.completeJSON([{ role: "user", content: "classify" }])).resolves.toEqual({ ok: true });
    expect(requestBodies[0]).toHaveProperty("enable_thinking", false);
    expect(requestBodies[1]).not.toHaveProperty("enable_thinking");
  });

  it("removes unsupported optional OpenAI fields with a bounded compatibility fallback", async () => {
    const requestBodies: Record<string, unknown>[] = [];
    const errors = [
      "Unsupported parameter: response_format",
      "temperature is not supported",
      "Use max_completion_tokens instead of max_tokens",
      "max_completion_tokens is not supported"
    ];
    const client = new OpenAICompatibleClient(config, {
      fetch: async (_url, init) => {
        const requestBody = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
        requestBodies.push(requestBody);
        const message = errors[requestBodies.length - 1];
        return message
          ? response(400, { error: { message } })
          : response(200, { choices: [{ message: { content: '{"ok":true}' } }] });
      }
    });

    await expect(client.completeJSON([{ role: "user", content: "classify" }], undefined, { maxTokens: 900 }))
      .resolves.toEqual({ ok: true });
    expect(requestBodies).toHaveLength(5);
    expect(requestBodies[0]).toMatchObject({ response_format: { type: "json_object" }, temperature: 0, max_tokens: 900 });
    expect(requestBodies[1]).not.toHaveProperty("response_format");
    expect(requestBodies[2]).not.toHaveProperty("temperature");
    expect(requestBodies[3]).toHaveProperty("max_completion_tokens", 900);
    expect(requestBodies[4]).not.toHaveProperty("max_tokens");
    expect(requestBodies[4]).not.toHaveProperty("max_completion_tokens");

    await client.completeJSON([{ role: "user", content: "classify again" }], undefined, { maxTokens: 900 });
    expect(requestBodies.at(-1)).not.toHaveProperty("response_format");
    expect(requestBodies.at(-1)).not.toHaveProperty("temperature");
    expect(requestBodies.at(-1)).not.toHaveProperty("max_tokens");
    expect(requestBodies.at(-1)).not.toHaveProperty("max_completion_tokens");
  });

  it("tests a connection before a model is selected and accepts common model-list shapes", async () => {
    const client = new OpenAICompatibleClient({ ...config, model: "" }, {
      fetch: async () => response(200, [
        { id: "chat-b", type: "chat" },
        { name: "chat-a", type: "language" },
        { id: "code-model", type: "code" },
        { id: "embed", type: "embedding" }
      ])
    });

    await expect(client.testConnection()).resolves.toEqual({ ok: true, status: 200, models: ["chat-a", "chat-b", "code-model"] });
  });

  it("rejects a successful HTML or unrelated JSON response as a false-positive connection", async () => {
    const client = new OpenAICompatibleClient({ ...config, model: "" }, {
      fetch: async () => response(200, { page: "dashboard" })
    });

    await expect(client.testConnection()).rejects.toBeInstanceOf(AIHttpError);
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

  it("disables DeepSeek thinking and applies the output-token limit", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const client = new OpenAICompatibleClient({
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "sk-test",
      model: "deepseek-v4-flash"
    }, {
      fetch: async (_url, init) => {
        requestBody = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
        return response(200, { choices: [{ message: { content: '{"ok":true}' } }] });
      }
    });

    await client.completeJSON([{ role: "user", content: "return json" }], undefined, { maxTokens: 1_234 });

    expect(requestBody).toMatchObject({
      max_tokens: 1_234,
      thinking: { type: "disabled" },
      response_format: { type: "json_object" }
    });
  });

  it("does not send the DeepSeek-specific thinking option to other providers", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const client = new OpenAICompatibleClient(config, {
      fetch: async (_url, init) => {
        requestBody = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
        return response(200, { choices: [{ message: { content: '{"ok":true}' } }] });
      }
    });

    await client.completeJSON([{ role: "user", content: "return json" }]);

    expect(requestBody).not.toHaveProperty("thinking");
  });

  it("uses no reasoning by default for latency-sensitive GPT-5.5 classification", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const client = new OpenAICompatibleClient({
      baseUrl: "https://provider.test/v1",
      apiKey: "sk-test",
      model: "gpt-5.5"
    }, {
      fetch: async (_url, init) => {
        requestBody = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
        return response(200, { choices: [{ message: { content: '{"ok":true}' } }] });
      }
    });

    await client.completeJSON([{ role: "user", content: "classify" }]);

    expect(requestBody).toMatchObject({ reasoning_effort: "none" });
  });

  it("allows callers to override GPT-5.5 reasoning effort", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const client = new OpenAICompatibleClient({
      baseUrl: "https://provider.test/v1",
      apiKey: "sk-test",
      model: "gpt-5.5-2026-04-23"
    }, {
      fetch: async (_url, init) => {
        requestBody = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
        return response(200, { choices: [{ message: { content: '{"ok":true}' } }] });
      }
    });

    await client.completeJSON([{ role: "user", content: "classify" }], undefined, { reasoningEffort: "low" });

    expect(requestBody).toMatchObject({ reasoning_effort: "low" });
  });

  it("falls back once when a compatible provider rejects inferred GPT-5.5 reasoning effort", async () => {
    const requestBodies: Record<string, unknown>[] = [];
    const client = new OpenAICompatibleClient({
      baseUrl: "https://provider.test/v1",
      apiKey: "sk-test",
      model: "gpt-5.5"
    }, {
      fetch: async (_url, init) => {
        const requestBody = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
        requestBodies.push(requestBody);
        return requestBodies.length === 1
          ? response(400, { error: { message: "Unknown parameter: reasoning_effort" } })
          : response(200, { choices: [{ message: { content: '{"ok":true}' } }] });
      }
    });

    await expect(client.completeJSON([{ role: "user", content: "classify" }])).resolves.toEqual({ ok: true });
    expect(requestBodies).toHaveLength(2);
    expect(requestBodies[0]).toHaveProperty("reasoning_effort", "none");
    expect(requestBodies[1]).not.toHaveProperty("reasoning_effort");
  });

  it("applies the timeout to the response body, not only the response headers", async () => {
    const client = new OpenAICompatibleClient(config, {
      fetch: async () => ({
        ok: true,
        status: 200,
        text: () => new Promise<string>(() => undefined)
      }),
      retry: { maxRetries: 0, timeoutMs: 10 }
    });

    await expect(client.complete([{ role: "user", content: "return json" }]))
      .rejects.toBeInstanceOf(AITimeoutError);
  });
});
