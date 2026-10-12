import type { AIConfig } from "../shared/contracts";
import { AIConfigError, AIHttpError, AIInvalidJsonError, AIValidationError } from "./errors";
import { normalizeAIConfig } from "./config";
import { explicitProviderError, fetchWithRetry, type AIFetch, type RetryOptions } from "./http";
import { parseStrictJson } from "./schema";
import { redactSecrets, type DebugLogger } from "../debug/logger";
import { ensureAIOriginPermission } from "./permissions";
import { getAppLanguage, translate } from "../i18n";

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
  maxTokens?: number;
  thinking?: "enabled" | "disabled";
  reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh";
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

function tr(key: Parameters<typeof translate>[1], variables?: Record<string, string | number | undefined>): string {
  return translate(getAppLanguage(), key, variables);
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
    throw new AIConfigError(tr("ai.invalidBaseUrl"), error);
  }
}

function assertUsableConfig(config: AIConfig): AIConfig {
  const normalized = normalizeAIConfig(config);
  let protocol: string;
  try {
    protocol = new URL(normalized.baseUrl).protocol;
  } catch (error) {
    throw new AIConfigError(tr("ai.invalidBaseUrl"), error);
  }
  if (protocol !== "https:" && protocol !== "http:") {
    throw new AIConfigError(tr("ai.httpRequired"));
  }
  if (!normalized.apiKey) throw new AIConfigError(tr("ai.keyRequired"));
  return normalized;
}

function headers(config: AIConfig): Record<string, string> {
  if (config.providerId === "anthropic") {
    return {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01"
    };
  }
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.apiKey}`
  };
}

/**
 * Strip a leading vendor namespace so routed model IDs such as
 * `deepseek/deepseek-v4.1-flash` or `~deepseek/deepseek-flash-latest` are read
 * as the family they belong to. Direct IDs like `deepseek-v4-flash` are
 * returned unchanged.
 */
export function modelFamily(model: string): string {
  return model.toLowerCase().trim().replace(/^~?[a-z0-9][a-z0-9._-]*\//, "");
}

function isDeepSeekCompatible(config: AIConfig): boolean {
  let hostname = "";
  try {
    hostname = new URL(config.baseUrl).hostname.toLowerCase();
  } catch {
    // Fall back to the model ID when the Base URL cannot be parsed.
  }
  return hostname.includes("deepseek") || modelFamily(config.model).startsWith("deepseek");
}

function isGPT55(config: AIConfig): boolean {
  return /^gpt-5\.5(?:$|-)/i.test(config.model);
}

async function readJSON(response: { json?: () => Promise<unknown>; text?: () => Promise<string> }): Promise<unknown> {
  if (response.json) {
    try {
      return await response.json();
    } catch (error) {
      if (!response.text) throw new AIInvalidJsonError(tr("ai.invalidJson"), error);
    }
  }
  if (response.text) {
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new AIInvalidJsonError(tr("ai.invalidJson"), error);
    }
  }
  throw new AIInvalidJsonError(tr("ai.emptyResponse"));
}

/**
 * Some OpenAI-compatible gateways wrap the native payload in an envelope, for
 * example `{"data": {"choices": [...]}, "success": true}`. Unwrap only a
 * single envelope that actually carries a payload key, so a native response is
 * never reshaped and an unrelated `data` field is never mistaken for one.
 */
function unwrapGatewayEnvelope(payload: unknown): unknown {
  if (typeof payload !== "object" || payload === null) return payload;
  if ("choices" in payload || "content" in payload) return payload;
  const envelope = (payload as { data?: unknown }).data;
  if (typeof envelope === "object" && envelope !== null && ("choices" in envelope || "content" in envelope)) {
    return envelope;
  }
  return payload;
}

/**
 * A gateway can answer with HTTP 200 and still report a failure in the body,
 * for example `{"error": "empty response content", "success": false}`. Surface
 * that wording instead of a generic "no usable choices" message.
 */
function gatewayError(payload: unknown): string | undefined {
  try {
    const serialized = JSON.stringify(payload);
    return serialized === undefined ? undefined : explicitProviderError(serialized);
  } catch {
    return undefined;
  }
}

function extractContent(payload: unknown): string {
  const body = unwrapGatewayEnvelope(payload);
  if (typeof body !== "object" || body === null || !("choices" in body)) {
    throw new AIHttpError(gatewayError(payload) ?? tr("ai.noChoices"), 200);
  }
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new AIHttpError(gatewayError(payload) ?? tr("ai.noChoices"), 200);
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
  throw new AIHttpError(tr("ai.noContent"), 200);
}

function extractAnthropicContent(payload: unknown): string {
  const body = unwrapGatewayEnvelope(payload);
  const content = typeof body === "object" && body !== null ? (body as { content?: unknown }).content : undefined;
  if (!Array.isArray(content)) throw new AIHttpError(tr("ai.noContent"), 200);
  const text = content
    .filter((part): part is { text: string } => typeof part === "object" && part !== null && typeof (part as { text?: unknown }).text === "string")
    .map((part) => part.text)
    .join("");
  if (!text) throw new AIHttpError(tr("ai.noContent"), 200);
  return text;
}

const NON_CHAT_MODEL_TYPES = new Set(["audio", "embedding", "image", "moderation", "rerank", "speech", "transcription", "video"]);

function modelCandidates(payload: unknown): unknown[] | undefined {
  if (Array.isArray(payload)) return payload;
  if (typeof payload !== "object" || payload === null) return undefined;
  const data = (payload as { data?: unknown }).data;
  if (Array.isArray(data)) return data;
  // A gateway can wrap the standard `{data: [...]}` list in its own envelope.
  if (typeof data === "object" && data !== null && Array.isArray((data as { data?: unknown }).data)) {
    return (data as { data: unknown[] }).data;
  }
  const models = (payload as { models?: unknown }).models;
  return Array.isArray(models) ? models : undefined;
}

function extractModels(payload: unknown): string[] {
  const candidates = modelCandidates(payload);
  if (!candidates) throw new AIHttpError(tr("ai.invalidModelsResponse"), 200);
  return [...new Set(candidates
    .map((item) => {
      if (typeof item === "string") return item;
      if (!item || typeof item !== "object") return undefined;
      const record = item as { id?: unknown; name?: unknown; model?: unknown; type?: unknown };
      if (typeof record.type === "string" && NON_CHAT_MODEL_TYPES.has(record.type.toLowerCase())) return undefined;
      return [record.id, record.name, record.model].find((value): value is string => typeof value === "string" && Boolean(value.trim()));
    })
    .filter((id): id is string => Boolean(id)))]
    .sort((left, right) => left.localeCompare(right));
}

export class OpenAICompatibleClient implements AIClient {
  readonly config: AIConfig;
  private readonly fetchImpl: AIFetch;
  private readonly logger?: DebugLogger;
  private readonly retry: RetryOptions;
  private supportsGPT55ReasoningEffort: boolean | undefined;
  private supportsThinkingControl: boolean | undefined;
  private supportsEnableThinkingControl: boolean | undefined;
  private supportsResponseFormat: boolean | undefined;
  private supportsDefaultTemperature: boolean | undefined;
  private outputTokenField: "max_tokens" | "max_completion_tokens" | "unsupported" = "max_tokens";

  constructor(config: AIConfig, options: OpenAICompatibleClientOptions = {}) {
    this.config = assertUsableConfig(config);
    this.fetchImpl = options.fetch ?? defaultFetch;
    this.logger = options.logger;
    this.retry = options.retry ?? {};
  }

  async complete(messages: readonly ChatMessage[], options: CompleteOptions = {}): Promise<string> {
    if (!messages.length) throw new AIConfigError(tr("ai.chatRequired"));
    if (!this.config.model) throw new AIConfigError(tr("ai.modelRequired"));
    await ensureAIOriginPermission(this.config.baseUrl);
    const inferredThinking = (isDeepSeekCompatible(this.config) || this.config.providerId === "volcengine-ark")
      && this.supportsThinkingControl !== false
      ? "disabled"
      : undefined;
    const thinking = options.thinking ?? inferredThinking;
    const inferredEnableThinking = ["alibaba-model-studio", "siliconflow"].includes(this.config.providerId)
      && this.supportsEnableThinkingControl !== false
      ? false
      : undefined;
    const inferredTemperature = this.config.providerId === "anthropic"
      ? undefined
      : this.config.providerId === "zhipu"
        ? 0.01
        : 0;
    const temperature = options.temperature ?? (this.supportsDefaultTemperature === false ? undefined : inferredTemperature);
    // Tab organization is a latency-sensitive classification task. GPT-5.5
    // defaults to medium reasoning, so opt out unless the caller explicitly
    // requests a different effort.
    const inferredReasoningEffort = isGPT55(this.config) && this.supportsGPT55ReasoningEffort !== false ? "none" : undefined;
    const reasoningEffort = options.reasoningEffort ?? inferredReasoningEffort;
    const isAnthropic = this.config.providerId === "anthropic";
    const anthropicSystem = isAnthropic
      ? messages.filter((message) => message.role === "system").map((message) => message.content).join("\n")
      : "";
    const body: Record<string, unknown> = isAnthropic
      ? {
          model: this.config.model,
          ...(anthropicSystem ? { system: anthropicSystem } : {}),
          messages: messages
            .filter((message) => message.role !== "system")
            .map((message) => ({ role: message.role, content: message.content })),
          max_tokens: Math.max(1, Math.floor(options.maxTokens ?? 2_048)),
          ...(thinking === undefined ? {} : { thinking: { type: thinking } })
        }
      : {
          model: this.config.model,
          messages,
          ...(temperature === undefined ? {} : { temperature }),
          ...(options.responseFormat === "text" || this.supportsResponseFormat === false ? {} : { response_format: { type: "json_object" } }),
          ...(options.maxTokens === undefined || this.outputTokenField === "unsupported"
            ? {}
            : { [this.outputTokenField]: Math.max(1, Math.floor(options.maxTokens)) }),
          ...(thinking === undefined ? {} : { thinking: { type: thinking } }),
          ...(inferredEnableThinking === undefined ? {} : { enable_thinking: inferredEnableThinking }),
          ...(reasoningEffort === undefined ? {} : { reasoning_effort: reasoningEffort })
        };
    const url = endpoint(this.config.baseUrl, isAnthropic ? "messages" : "chat/completions");
    this.logger?.debug("ai.request", {
      method: "POST",
      url,
      model: this.config.model,
      messageCount: messages.length
    });

    const send = (requestBody: Record<string, unknown>) => fetchWithRetry(this.fetchImpl, url, {
      method: "POST",
      headers: headers(this.config),
      body: JSON.stringify(requestBody)
    }, { ...this.retry, ...options });
    let response;
    let requestBody = body;
    for (let compatibilityAttempt = 0; ; compatibilityAttempt += 1) {
      try {
        response = await send(requestBody);
        if ("reasoning_effort" in requestBody && inferredReasoningEffort !== undefined) this.supportsGPT55ReasoningEffort = true;
        if ("thinking" in requestBody && inferredThinking !== undefined) this.supportsThinkingControl = true;
        if ("enable_thinking" in requestBody && inferredEnableThinking !== undefined) this.supportsEnableThinkingControl = true;
        if ("response_format" in requestBody) this.supportsResponseFormat = true;
        if ("temperature" in requestBody && options.temperature === undefined) this.supportsDefaultTemperature = true;
        break;
      } catch (error) {
        const optionalParameterError = error instanceof AIHttpError
          && (error.status === 400 || error.status === 422);
        if (!optionalParameterError || compatibilityAttempt >= 5) throw error;

        if ("reasoning_effort" in requestBody
          && inferredReasoningEffort !== undefined
          && options.reasoningEffort === undefined
          && /reasoning(?:[_. ]?effort)?/i.test(error.message)) {
          this.supportsGPT55ReasoningEffort = false;
          const { reasoning_effort: _unsupported, ...fallbackBody } = requestBody;
          requestBody = fallbackBody;
          continue;
        }
        if ("thinking" in requestBody
          && inferredThinking !== undefined
          && options.thinking === undefined
          && /thinking/i.test(error.message)) {
          this.supportsThinkingControl = false;
          const { thinking: _unsupported, ...fallbackBody } = requestBody;
          requestBody = fallbackBody;
          continue;
        }
        if ("enable_thinking" in requestBody
          && inferredEnableThinking !== undefined
          && /enable[_ .]?thinking/i.test(error.message)) {
          this.supportsEnableThinkingControl = false;
          const { enable_thinking: _unsupported, ...fallbackBody } = requestBody;
          requestBody = fallbackBody;
          continue;
        }
        if ("response_format" in requestBody && /response[_ .-]?format|json[_ -]?object|json mode/i.test(error.message)) {
          this.supportsResponseFormat = false;
          const { response_format: _unsupported, ...fallbackBody } = requestBody;
          requestBody = fallbackBody;
          continue;
        }
        if ("temperature" in requestBody && options.temperature === undefined && /temperature/i.test(error.message)) {
          this.supportsDefaultTemperature = false;
          const { temperature: _unsupported, ...fallbackBody } = requestBody;
          requestBody = fallbackBody;
          continue;
        }
        if ("max_tokens" in requestBody && /max[_ .-]?tokens|max(?:imum)? tokens|completion tokens/i.test(error.message)) {
          const { max_tokens, ...fallbackBody } = requestBody;
          this.outputTokenField = "max_completion_tokens";
          requestBody = { ...fallbackBody, max_completion_tokens: max_tokens };
          continue;
        }
        if ("max_completion_tokens" in requestBody && /max[_ .-]?completion[_ .-]?tokens|max(?:imum)? completion tokens/i.test(error.message)) {
          const { max_completion_tokens: _unsupported, ...fallbackBody } = requestBody;
          this.outputTokenField = "unsupported";
          requestBody = fallbackBody;
          continue;
        }
        throw error;
      }
    }
    const payload = await readJSON(response);
    const content = isAnthropic ? extractAnthropicContent(payload) : extractContent(payload);
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
      throw new AIValidationError(tr("ai.schemaFailed"), [parsed.error]);
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
    const models = extractModels(payload);
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
