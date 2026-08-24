import { describe, expect, it } from "vitest";
import { scoreOrganizationPreview, summarizeLatency, type LabeledOrganizationTab } from "../../src/ai/eval";

const tabs: LabeledOrganizationTab[] = [
  ["one", "project-a", "docs"],
  ["two", "project-a", "code"],
  ["three", "project-b", "docs"],
  ["four", "singleton", "music"]
].map(([id, purpose, type], index) => ({
  tab: {
    id,
    windowKey: "window:1",
    workspaceId: null,
    kind: "normal",
    url: `https://example.test/${id}`,
    title: id,
    index,
    pinned: false
  },
  purpose,
  type
}));

describe("AI organization evaluator", () => {
  it("scores a correct clustering and workspace reuse as perfect", () => {
    const metrics = scoreOrganizationPreview({
      mode: "purpose",
      sourceTabIds: tabs.map((item) => item.tab.id),
      sourceFingerprint: "fixture",
      groups: [
        { id: "a", name: "A", description: "", tags: [], existingWorkspaceId: "ws-a", tabIds: ["one", "two"] },
        { id: "b", name: "B", description: "", tags: [], existingWorkspaceId: null, tabIds: ["three"] }
      ],
      unclassifiedTabIds: ["four"]
    }, tabs, "purpose", { "project-a": "ws-a" });

    expect(metrics.coverage).toBe(1);
    expect(metrics.pairwisePrecision).toBe(1);
    expect(metrics.pairwiseRecall).toBe(1);
    expect(metrics.pairwiseF1).toBe(1);
    expect(metrics.workspaceReuseAccuracy).toBe(1);
    expect(metrics.mismatches).toEqual([]);
  });

  it("penalizes unrelated tabs merged into one group", () => {
    const metrics = scoreOrganizationPreview({
      mode: "purpose",
      sourceTabIds: tabs.map((item) => item.tab.id),
      sourceFingerprint: "fixture",
      groups: [{ id: "all", name: "All", description: "", tags: [], existingWorkspaceId: null, tabIds: tabs.map((item) => item.tab.id) }],
      unclassifiedTabIds: []
    }, tabs, "purpose");

    expect(metrics.pairwiseRecall).toBe(1);
    expect(metrics.pairwisePrecision).toBeCloseTo(1 / 6);
    expect(metrics.pairwiseF1).toBeLessThan(0.3);
    expect(metrics.mismatches.length).toBeGreaterThan(0);
  });

  it("summarizes latency with deterministic p50 and p95", () => {
    expect(summarizeLatency([10, 20, 30, 40])).toEqual({
      samples: 4,
      meanMs: 25,
      p50Ms: 20,
      p95Ms: 40,
      maxMs: 40
    });
  });
});
