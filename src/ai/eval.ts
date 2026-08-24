import type { OrganizationMode, OrganizationPreview, TabRecord } from "../shared/contracts";

export interface LabeledOrganizationTab {
  tab: TabRecord;
  purpose: string;
  type: string;
}

export interface OrganizationEvalMismatch {
  leftId: string;
  rightId: string;
  expectedSame: boolean;
  predictedSame: boolean;
}

export interface OrganizationEvalMetrics {
  tabCount: number;
  expectedGroupCount: number;
  predictedGroupCount: number;
  coverage: number;
  pairwisePrecision: number;
  pairwiseRecall: number;
  pairwiseF1: number;
  pairwiseAccuracy: number;
  workspaceReuseAccuracy: number | null;
  workspaceReuseExpected: number;
  workspaceReuseCorrect: number;
  mismatches: OrganizationEvalMismatch[];
}

function divide(numerator: number, denominator: number, empty = 1): number {
  return denominator === 0 ? empty : numerator / denominator;
}

export function scoreOrganizationPreview(
  preview: OrganizationPreview,
  labeledTabs: readonly LabeledOrganizationTab[],
  mode: OrganizationMode,
  expectedWorkspaceByLabel: Readonly<Record<string, string>> = {}
): OrganizationEvalMetrics {
  const expectedLabel = new Map(labeledTabs.map((item) => [item.tab.id, item[mode]]));
  const predictedGroup = new Map<string, string>();
  const predictedWorkspace = new Map<string, string | null>();

  for (const group of preview.groups) {
    const key = group.existingWorkspaceId ? `existing:${group.existingWorkspaceId}` : `new:${group.id}`;
    for (const tabId of group.tabIds) {
      predictedGroup.set(tabId, key);
      predictedWorkspace.set(tabId, group.existingWorkspaceId);
    }
  }
  for (const tabId of preview.unclassifiedTabIds) {
    predictedGroup.set(tabId, `unclassified:${tabId}`);
    predictedWorkspace.set(tabId, null);
  }

  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let trueNegative = 0;
  const mismatches: OrganizationEvalMismatch[] = [];
  for (let left = 0; left < labeledTabs.length; left += 1) {
    for (let right = left + 1; right < labeledTabs.length; right += 1) {
      const leftId = labeledTabs[left].tab.id;
      const rightId = labeledTabs[right].tab.id;
      const expectedSame = expectedLabel.get(leftId) === expectedLabel.get(rightId);
      const predictedSame = predictedGroup.get(leftId) === predictedGroup.get(rightId);
      if (expectedSame && predictedSame) truePositive += 1;
      else if (!expectedSame && predictedSame) falsePositive += 1;
      else if (expectedSame) falseNegative += 1;
      else trueNegative += 1;
      if (expectedSame !== predictedSame && mismatches.length < 20) {
        mismatches.push({ leftId, rightId, expectedSame, predictedSame });
      }
    }
  }

  const precision = divide(truePositive, truePositive + falsePositive);
  const recall = divide(truePositive, truePositive + falseNegative);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  let reuseExpected = 0;
  let reuseCorrect = 0;
  for (const item of labeledTabs) {
    const workspaceId = expectedWorkspaceByLabel[item[mode]];
    if (!workspaceId) continue;
    reuseExpected += 1;
    if (predictedWorkspace.get(item.tab.id) === workspaceId) reuseCorrect += 1;
  }

  return {
    tabCount: labeledTabs.length,
    expectedGroupCount: new Set(labeledTabs.map((item) => item[mode])).size,
    predictedGroupCount: new Set(predictedGroup.values()).size,
    coverage: divide(predictedGroup.size, labeledTabs.length, 0),
    pairwisePrecision: precision,
    pairwiseRecall: recall,
    pairwiseF1: f1,
    pairwiseAccuracy: divide(truePositive + trueNegative, truePositive + falsePositive + falseNegative + trueNegative),
    workspaceReuseAccuracy: reuseExpected ? reuseCorrect / reuseExpected : null,
    workspaceReuseExpected: reuseExpected,
    workspaceReuseCorrect: reuseCorrect,
    mismatches
  };
}

export interface LatencySummary {
  samples: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

export function percentile(values: readonly number[], percentileValue: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(percentileValue * sorted.length) - 1));
  return sorted[index];
}

export function summarizeLatency(values: readonly number[]): LatencySummary {
  return {
    samples: values.length,
    meanMs: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    maxMs: values.length ? Math.max(...values) : 0
  };
}
