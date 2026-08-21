import type { AIConfig } from "../shared/contracts";
import { AIConfigError, AIHttpError, AIInvalidJsonError, AIValidationError } from "./errors";
import { normalizeAIConfig } from "./config";
import { fetchWithRetry, type AIFetch, type RetryOptions } from "./http";
import { parseStrictJson } from "./schema";
import { redactSecrets, type DebugLogger } from "../debug/logger";
import { ensureAIOriginPermission } from "./permissions";

export interface AIClient {
  complete(messages: readonly ChatMessage[], options?: CompleteOptions): Promise<string>;
  completeJSON<T = unknown>(
    messages: readonly ChatMessage[],
    schema?: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: unknown } },
    options?: CompleteOptions
  ): Promise<T>;
  testConnection(options?: TestConnectionOptions): Promise<TestConnectionResult>;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompleteOptions extends RetryOptions {
  temperature?: number;
  responseFormat?: "json_object" | "text";
}

export interface TestConnectionOptions extends RetryOptions {
  path?: string;
}

export interface TestConnectionResult {
  ok: true;
  status: number;
  models: string[];
}

export interface OpenAICompatibleClientOptions {
  fetch?: AIFetch;
  logger?: DebugLogger;
  retry?: RetryOptions;
}

const defaultFetch: AIFetch = async (input, init) => {
  const response = await fetch(input, init);
  return response;
};

function endpoint(baseUrl: string, path: string): string {
  const normalizedPath = path.replace(/^\/+/, "");
  try {
    return new URL(normalizedPath, `${baseUrl.replace(/\/+$/, "")}/`).toString();
  } catch (error) {
    throw new AIConfigError("Invalid AI base URL", error);
  }
}

function assertUsableConfig(config: AIConfig): AIConfig {
  const normalized = normalizeAIConfig(config);
  let protocol: string;
  try {
    protocol = new URL(normalized.baseUrl).protocol;
  } catch (error) {
    throw new AIConfigError("Invalid AI base URL", error);
  }
  if (protocol !== "https:" && protocol !== "http:") {
    throw new AIConfigError("AI base URL must use HTTP or HTTPS");
  }
  if (!normalized.apiKey) throw new AIConfigError("An AI API key is required");
  if (!normalized.model) throw new AIConfigError("An AI model is required");
  return normalized;
}

function headers(config: AIConfig): Record<string, string> {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.apiKey}`
  };
}

async function readJSON(response: { json?: () => Promise<unknown>; text?: () => Promise<string> }): Promise<unknown> {
  if (response.json) {
    try {
      return await response.json();
    } catch (error) {
      if (!response.text) throw new AIInvalidJsonError("AI provider returned invalid JSON", error);
    }
  }
  if (response.text) {
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new AIInvalidJsonError("AI provider returned invalid JSON", error);
    }
  }
  throw new AIInvalidJsonError("AI provider returned an empty response");
}

function extractContent(payload: unknown): string {
  if (typeof payload !== "object" || payload === null || !("choices" in payload)) {
    throw new AIHttpError("AI provider response did not contain choices", 200);
  }
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new AIHttpError("AI provider returned no choices", 200);
  }
  const message = choices[0] && typeof choices[0] === "object" ? (choices[0] as { message?: unknown }).message : undefined;
  const content = message && typeof message === "object" ? (message as { content?: unknown }).content : undefined;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const text = content
      .filter((part): part is { text: string } => typeof part === "object" && part !== null && typeof (part as { text?: unknown }).text === "string")
      .map((part) => part.text)
      .join("");
    if (text) return text;
  }
  throw new AIHttpError("AI provider response did not contain message content", 200);
}

export class OpenAICompatibleClient implements AIClient {
  readonly config: AIConfig;
  private readonly fetchImpl: AIFetch;
  private readonly logger?: DebugLogger;
  private readonly retry: RetryOptions;

  constructor(config: AIConfig, options: OpenAICompatibleClientOptions = {}) {
    this.config = assertUsableConfig(config);
    this.fetchImpl = options.fetch ?? defaultFetch;
    this.logger = options.logger;
    this.retry = options.retry ?? {};
  }

  async complete(messages: readonly ChatMessage[], options: CompleteOptions = {}): Promise<string> {
    if (!messages.length) throw new AIConfigError("At least one chat message is required");
    await ensureAIOriginPermission(this.config.baseUrl);
    const body = {
      model: this.config.model,
      messages,
      temperature: options.temperature ?? 0,
      ...(options.responseFormat === "text" ? {} : { response_format: { type: "json_object" } })
    };
    const url = endpoint(this.config.baseUrl, "chat/completions");
    this.logger?.debug("ai.request", {
      method: "POST",
      url,
      model: this.config.model,
      messageCount: messages.length
    });

    const response = await fetchWithRetry(this.fetchImpl, url, {
      method: "POST",
      headers: headers(this.config),
      body: JSON.stringify(body)
    }, { ...this.retry, ...options });
    const payload = await readJSON(response);
    const content = extractContent(payload);
    this.logger?.debug("ai.response", { status: response.status, contentLength: content.length });
    return content;
  }

  async completeJSON<T = unknown>(
    messages: readonly ChatMessage[],
    schema?: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: unknown } },
    options: CompleteOptions = {}
  ): Promise<T> {
    const content = await this.complete(messages, { ...options, responseFormat: "json_object" });
    const json = parseStrictJson(content);
    if (!schema) return json as T;
    const parsed = schema.safeParse(json);
    if (parsed.success === false) {
      throw new AIValidationError("AI response failed schema validation", [parsed.error]);
    }
    return parsed.data;
  }

  async requestJSON<T = unknown>(
    messages: readonly ChatMessage[],
    schema?: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: unknown } },
    options: CompleteOptions = {}
  ): Promise<T> {
    return this.completeJSON(messages, schema, options);
  }

  async testConnection(options: TestConnectionOptions = {}): Promise<TestConnectionResult> {
    await ensureAIOriginPermission(this.config.baseUrl);
    const path = options.path ?? "models";
    const url = endpoint(this.config.baseUrl, path);
    this.logger?.debug("ai.connection_test", { method: "GET", url });
    const response = await fetchWithRetry(this.fetchImpl, url, {
      method: "GET",
      headers: headers(this.config)
    }, { ...this.retry, ...options });
    const payload = await readJSON(response);
    const models =
      typeof payload === "object" && payload !== null && Array.isArray((payload as { data?: unknown }).data)
        ? (payload as { data: unknown[] }).data
            .map((item) => (item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string" ? (item as { id: string }).id : undefined))
            .filter((id): id is string => Boolean(id))
        : [];
    return { ok: true, status: response.status, models };
  }
}

export function createOpenAICompatibleClient(
  config: AIConfig,
  options?: OpenAICompatibleClientOptions
): OpenAICompatibleClient {
  return new OpenAICompatibleClient(config, options);
}

/** Useful when logging request objects in development code. */
export function sanitizeAIRequestForLog(value: unknown): unknown {
  return redactSecrets(value);
}
