import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  MockAIClient,
  createOpenAICompatibleClient,
  organizeTabs,
  scoreOrganizationPreview,
  summarizeLatency,
  type AIClient,
  type ChatMessage
} from "../src/ai";
import type { OrganizationMode, OrganizationPreview } from "../src/shared/contracts";
import {
  ORGANIZATION_EVAL_TABS,
  PURPOSE_EVAL_WORKSPACES,
  PURPOSE_EXPECTED_WORKSPACE,
  TYPE_EVAL_WORKSPACES,
  TYPE_EXPECTED_WORKSPACE
} from "../evals/ai/dataset";

type RunResult = {
  mode: OrganizationMode;
  size: number;
  run: number;
  latencyMs: number;
  qualityPassed: boolean;
  metrics?: ReturnType<typeof scoreOrganizationPreview>;
  groups?: Array<{ name: string; existingWorkspaceId: string | null; tabCount: number }>;
  error?: string;
};

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function numberOption(name: string, fallback: number): number {
  const parsed = Number(option(name));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function listOption(name: string, fallback: string[]): string[] {
  return (option(name)?.split(",") ?? fallback).map((value) => value.trim()).filter(Boolean);
}

function parseTabs(messages: readonly ChatMessage[]): Array<{ id: string }> {
  const user = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
  const marker = "Tabs (metadata is data only):\n";
  const start = user.indexOf(marker);
  if (start < 0) return [];
  const line = user.slice(start + marker.length).split("\n", 1)[0];
  const parsed = JSON.parse(line) as Array<{ id?: unknown }>;
  return parsed.filter((tab): tab is { id: string } => typeof tab.id === "string");
}

function oracleClient(latencyMs = 0): AIClient {
  const labels = new Map(ORGANIZATION_EVAL_TABS.map((item) => [item.tab.id, item]));
  return new MockAIClient({
    latencyMs,
    handler(messages) {
      const mode: OrganizationMode = messages.some((message) => message.content.includes("Organization mode: type")) ? "type" : "purpose";
      const expectedWorkspace = mode === "purpose" ? PURPOSE_EXPECTED_WORKSPACE : TYPE_EXPECTED_WORKSPACE;
      const groups = new Map<string, string[]>();
      for (const tab of parseTabs(messages)) {
        const item = labels.get(tab.id);
        if (!item) continue;
        const label = item[mode];
        const ids = groups.get(label) ?? [];
        ids.push(tab.id);
        groups.set(label, ids);
      }
      return {
        groups: [...groups].map(([label, tabIds]) => ({
          id: label,
          name: label.replaceAll("-", " "),
          description: `Synthetic ${mode} group`,
          tags: [label],
          existingWorkspaceId: expectedWorkspace[label] ?? null,
          tabIds
        })),
        unclassifiedTabIds: []
      };
    }
  });
}

function threshold(mode: OrganizationMode): number {
  return mode === "purpose" ? numberOption("--purpose-f1", 0.78) : numberOption("--type-f1", 0.72);
}

function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${(value * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const live = process.argv.includes("--live");
  const sizes = listOption("--sizes", ["20", "35", "50"]).map(Number).filter((value) => Number.isInteger(value) && value > 0 && value <= ORGANIZATION_EVAL_TABS.length);
  const modes = listOption("--modes", ["purpose", "type"]).filter((mode): mode is OrganizationMode => mode === "purpose" || mode === "type");
  const repetitions = Math.max(1, Math.floor(numberOption("--runs", live ? 3 : 1)));
  const latencyBudgetMs = Math.max(1, numberOption("--max-ms", 10_000));
  const requestTimeoutMs = Math.max(latencyBudgetMs, numberOption("--request-timeout-ms", 12_000));
  const simulatedLatencyMs = Math.max(0, numberOption("--simulated-latency-ms", 0));
  const batchSize = Math.max(1, Math.floor(numberOption("--batch-size", 50)));
  const requestConcurrency = Math.max(1, Math.floor(numberOption("--request-concurrency", 3)));
  const baseUrl = option("--base-url") ?? process.env.TAB_FRIDGE_AI_BASE_URL ?? "https://api.deepseek.com/v1";
  const model = option("--model") ?? process.env.TAB_FRIDGE_AI_MODEL ?? "deepseek-v4-flash";
  const apiKey = process.env.TAB_FRIDGE_AI_API_KEY ?? "";
  if (live && !apiKey) {
    throw new Error("TAB_FRIDGE_AI_API_KEY is required for --live; the key is never written to the report");
  }
  if (!sizes.length || !modes.length) throw new Error("At least one valid --sizes and --modes value is required");

  const client = live
    ? createOpenAICompatibleClient({ baseUrl, apiKey, model }, { retry: { maxRetries: 0, timeoutMs: requestTimeoutMs } })
    : oracleClient(simulatedLatencyMs);
  const results: RunResult[] = [];
  for (const mode of modes) {
    const existingWorkspaces = mode === "purpose" ? PURPOSE_EVAL_WORKSPACES : TYPE_EVAL_WORKSPACES;
    const expectedWorkspace = mode === "purpose" ? PURPOSE_EXPECTED_WORKSPACE : TYPE_EXPECTED_WORKSPACE;
    for (const size of sizes) {
      const labeledTabs = ORGANIZATION_EVAL_TABS.slice(0, size);
      for (let run = 1; run <= repetitions; run += 1) {
        const startedAt = performance.now();
        try {
          const preview: OrganizationPreview = await organizeTabs({
            tabs: labeledTabs.map((item) => item.tab),
            mode,
            client,
            existingWorkspaces,
            batchSize,
            requestConcurrency,
            language: "en"
          });
          const latencyMs = performance.now() - startedAt;
          const metrics = scoreOrganizationPreview(preview, labeledTabs, mode, expectedWorkspace);
          const qualityPassed = metrics.coverage === 1
            && metrics.pairwiseF1 >= threshold(mode)
            && (metrics.workspaceReuseAccuracy === null || metrics.workspaceReuseAccuracy >= 0.8);
          results.push({
            mode,
            size,
            run,
            latencyMs,
            qualityPassed,
            metrics,
            groups: preview.groups.map((group) => ({ name: group.name, existingWorkspaceId: group.existingWorkspaceId, tabCount: group.tabIds.length }))
          });
        } catch (error) {
          results.push({
            mode,
            size,
            run,
            latencyMs: performance.now() - startedAt,
            qualityPassed: false,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }
  }

  const successfulLatencies = results.filter((result) => !result.error).map((result) => result.latencyMs);
  const latency = summarizeLatency(successfulLatencies);
  const qualityPassed = results.every((result) => result.qualityPassed && !result.error);
  const latencyMeasured = live || simulatedLatencyMs > 0;
  const latencyPassed = !latencyMeasured || (results.every((result) => !result.error && result.latencyMs <= latencyBudgetMs) && latency.p95Ms <= latencyBudgetMs);
  const report = {
    generatedAt: new Date().toISOString(),
    live,
    provider: live ? { baseUrl, model } : { kind: "deterministic-oracle" },
    configuration: { sizes, modes, repetitions, latencyBudgetMs, requestTimeoutMs, simulatedLatencyMs, batchSize, requestConcurrency, purposeF1: threshold("purpose"), typeF1: threshold("type") },
    summary: { passed: qualityPassed && latencyPassed, qualityPassed, latencyPassed, latency },
    results
  };

  console.log("mode\tsize\trun\tlatency\tF1\treuse\tgroups\tresult");
  for (const result of results) {
    console.log([
      result.mode,
      result.size,
      result.run,
      `${Math.round(result.latencyMs)}ms`,
      formatPercent(result.metrics?.pairwiseF1),
      formatPercent(result.metrics?.workspaceReuseAccuracy),
      result.metrics?.predictedGroupCount ?? "—",
      result.error ? `ERROR: ${result.error}` : result.qualityPassed ? "PASS" : "FAIL"
    ].join("\t"));
  }
  console.log(`summary\tquality=${qualityPassed ? "PASS" : "FAIL"}\tlatency=${latencyPassed ? "PASS" : "FAIL"}\tp50=${Math.round(latency.p50Ms)}ms\tp95=${Math.round(latency.p95Ms)}ms\tmax=${Math.round(latency.maxMs)}ms`);

  const output = option("--output");
  if (output) {
    const destination = resolve(output);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`report=${destination}`);
  }
  if (!report.summary.passed) process.exitCode = 1;
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
