export const AI_PROVIDER_IDS = [
  "openai",
  "anthropic",
  "google-gemini",
  "deepseek",
  "openrouter",
  "groq",
  "mistral",
  "xai",
  "together",
  "fireworks",
  "alibaba-model-studio",
  "siliconflow",
  "volcengine-ark",
  "moonshot",
  "zhipu",
  "minimax",
  "baidu-qianfan",
  "tencent-hunyuan",
  "custom"
] as const;

export type AIProviderId = (typeof AI_PROVIDER_IDS)[number];

export type AIProviderNameKey =
  | "provider.openai" | "provider.anthropic" | "provider.googleGemini" | "provider.deepseek"
  | "provider.openrouter" | "provider.groq" | "provider.mistral" | "provider.xai"
  | "provider.together" | "provider.fireworks" | "provider.alibaba" | "provider.siliconflow"
  | "provider.volcengine" | "provider.moonshot" | "provider.zhipu" | "provider.minimax"
  | "provider.baidu" | "provider.tencent";

export interface AIProviderPreset {
  id: Exclude<AIProviderId, "custom">;
  nameKey: AIProviderNameKey;
  baseUrl: string;
  baseUrlAliases?: readonly string[];
  market: "global" | "china";
}

/**
 * Curated provider endpoints. Most use OpenAI Chat Completions; Anthropic uses
 * the native Messages adapter. Model IDs deliberately stay dynamic because
 * provider catalogs change much more often than extension releases.
 */
export const AI_PROVIDER_PRESETS: readonly AIProviderPreset[] = [
  { id: "openai", nameKey: "provider.openai", baseUrl: "https://api.openai.com/v1", market: "global" },
  { id: "anthropic", nameKey: "provider.anthropic", baseUrl: "https://api.anthropic.com/v1", market: "global" },
  { id: "google-gemini", nameKey: "provider.googleGemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", market: "global" },
  { id: "deepseek", nameKey: "provider.deepseek", baseUrl: "https://api.deepseek.com", baseUrlAliases: ["https://api.deepseek.com/v1"], market: "china" },
  { id: "openrouter", nameKey: "provider.openrouter", baseUrl: "https://openrouter.ai/api/v1", market: "global" },
  { id: "groq", nameKey: "provider.groq", baseUrl: "https://api.groq.com/openai/v1", market: "global" },
  { id: "mistral", nameKey: "provider.mistral", baseUrl: "https://api.mistral.ai/v1", market: "global" },
  { id: "xai", nameKey: "provider.xai", baseUrl: "https://api.x.ai/v1", market: "global" },
  { id: "together", nameKey: "provider.together", baseUrl: "https://api.together.xyz/v1", market: "global" },
  { id: "fireworks", nameKey: "provider.fireworks", baseUrl: "https://api.fireworks.ai/inference/v1", market: "global" },
  { id: "alibaba-model-studio", nameKey: "provider.alibaba", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", market: "china" },
  { id: "siliconflow", nameKey: "provider.siliconflow", baseUrl: "https://api.siliconflow.cn/v1", market: "china" },
  { id: "volcengine-ark", nameKey: "provider.volcengine", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", market: "china" },
  { id: "moonshot", nameKey: "provider.moonshot", baseUrl: "https://api.moonshot.cn/v1", market: "china" },
  { id: "zhipu", nameKey: "provider.zhipu", baseUrl: "https://open.bigmodel.cn/api/paas/v4", market: "china" },
  { id: "minimax", nameKey: "provider.minimax", baseUrl: "https://api.minimaxi.com/v1", market: "china" },
  { id: "baidu-qianfan", nameKey: "provider.baidu", baseUrl: "https://qianfan.baidubce.com/v2", market: "china" },
  { id: "tencent-hunyuan", nameKey: "provider.tencent", baseUrl: "https://api.hunyuan.cloud.tencent.com/v1", market: "china" }
] as const;

export function getAIProviderPreset(id: string): AIProviderPreset | undefined {
  return AI_PROVIDER_PRESETS.find((provider) => provider.id === id);
}

function normalizedBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

export function inferAIProviderId(baseUrl: string): AIProviderId {
  const normalized = normalizedBaseUrl(baseUrl);
  return AI_PROVIDER_PRESETS.find((provider) =>
    [provider.baseUrl, ...(provider.baseUrlAliases ?? [])].some((candidate) => normalizedBaseUrl(candidate) === normalized)
  )?.id ?? "custom";
}
