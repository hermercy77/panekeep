import { describe, expect, it } from "vitest";
import { AI_PROVIDER_PRESETS, getAIProviderPreset, inferAIProviderId } from "../../src/ai/providers";

describe("AI provider presets", () => {
  it("keeps provider IDs and Base URLs unique", () => {
    expect(new Set(AI_PROVIDER_PRESETS.map((provider) => provider.id)).size).toBe(AI_PROVIDER_PRESETS.length);
    expect(new Set(AI_PROVIDER_PRESETS.map((provider) => provider.baseUrl)).size).toBe(AI_PROVIDER_PRESETS.length);
  });

  it("infers exact presets without misclassifying relays", () => {
    expect(inferAIProviderId("https://api.deepseek.com/")).toBe("deepseek");
    expect(inferAIProviderId("https://api.deepseek.com/v1")).toBe("deepseek");
    expect(inferAIProviderId("https://relay.example.com/v1")).toBe("custom");
    expect(getAIProviderPreset("groq")?.baseUrl).toBe("https://api.groq.com/openai/v1");
    expect(getAIProviderPreset("baidu-qianfan")?.baseUrl).toBe("https://qianfan.baidubce.com/v2");
  });
});
