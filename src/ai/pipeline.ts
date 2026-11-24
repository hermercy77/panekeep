import type {
  AIConfig,
  OrganizationMode,
  OrganizationPreview,
  TabRecord,
  Workspace
} from "../shared/contracts";
import { organizationPreviewSchema, organizationModeSchema } from "../shared/contracts";
import { AIAbortError, AIValidationError, AIConfigError, AITimeoutError, AIInvalidJsonError } from "./errors";
import { OpenAICompatibleClient, type AIClient, type ChatMessage, type CompleteOptions, type OpenAICompatibleClientOptions } from "./client";
import { buildOrganizationMessages } from "./prompts";
import {
  organizationResponseSchema,
  parseAndValidateOrganizationResponse,
  validateOrganizationPreview,
  type OrganizationResponse
} from "./schema";
import { assertSnapshotUnchanged, createTabSnapshot, type TabSnapshot } from "./snapshot";
import { getAppLanguage, translate, type AppLanguage } from "../i18n";

export interface OrganizationPipelineRequest {
  tabs: readonly TabRecord[];
  mode: OrganizationMode;
  client?: AIClient;
  config?: AIConfig;
  clientOptions?: OpenAICompatibleClientOptions;
  existingWorkspaces?: readonly Pick<Workspace, "id" | "name" | "description" | "tags">[];
  /** Number of tabs per provider call. Defaults to 50. */
  batchSize?: number;
  /** Maximum simultaneous provider calls. Defaults to three. */
  requestConcurrency?: number;
  snapshot?: TabSnapshot;
  revision?: string | number;
  getCurrentSnapshot?: () => TabSnapshot | Promise<TabSnapshot>;
  getCurrentTabs?: () => readonly TabRecord[] | Promise<readonly TabRecord[]>;
  signal?: AbortSignal;
  deadlineAt?: number;
  language?: AppLanguage;
}

export interface BatchOrganizationResult {
  sourceTabIds: string[];
  response: OrganizationResponse;
}

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_REQUEST_CONCURRENCY = 3;
const DEFAULT_ORGANIZATION_BUDGET_MS = 60_000;

/**
 * Keep JSON generation bounded without truncating a valid result. Measured
 * against real gateways, a 20-tab preview returns roughly 1.4k-2.1k characters
 * of JSON, and reasoning models spend part of the budget before emitting it.
 * The floor is therefore 2,048 rather than 512: too small a budget makes the
 * provider stop at `finish_reason: length` and the truncated JSON then fails
 * validation, which reads as an unexplained AI failure to the user.
 */
export function organizationOutputTokenBudget(tabCount: number): number {
  return Math.min(4_096, Math.max(2_048, 256 + Math.max(0, Math.floor(tabCount)) * 60));
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T, index: number) => Promise<R>,
  onFirstError?: () => void
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  let stopped = false;
  const workers = Array.from({ length: Math.min(values.length, concurrency) }, async () => {
    while (!stopped && nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await operation(values[index], index);
      } catch (error) {
        if (!stopped) {
          stopped = true;
          onFirstError?.();
        }
        throw error;
      }
    }
  });
  await Promise.all(workers);
  return results;
}

function tr(key: Parameters<typeof translate>[1], variables?: Record<string, string | number | undefined>): string {
  return translate(getAppLanguage(), key, variables);
}

export function chunk<T>(values: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size <= 0) throw new RangeError(tr("ai.batchSizeInvalid"));
  const batches: T[][] = [];
  for (let index = 0; index < values.length; index += size) batches.push([...values.slice(index, index + size)]);
  return batches;
}

function ensureTabInput(tabs: readonly TabRecord[]): void {
  const ids = tabs.map((tab) => tab.id);
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    throw new AIValidationError(tr("ai.duplicateTabIds"));
  }
}

export function mergeBatchOrganizationResponses(
  batches: readonly BatchOrganizationResult[],
  mode: OrganizationMode,
  sourceTabIds: readonly string[],
  sourceFingerprint: string,
  existingWorkspaces: OrganizationPipelineRequest["existingWorkspaces"] = []
): OrganizationPreview {
  const groups: OrganizationResponse["groups"] = [];
  const groupByWorkspaceId = new Map<string, OrganizationResponse["groups"][number]>();
  const workspaceById = new Map((existingWorkspaces ?? []).map((workspace) => [workspace.id, workspace]));
  const unclassifiedTabIds: string[] = [];
  const seenUnclassified = new Set<string>();

  for (const [batchIndex, batch] of batches.entries()) {
    // Validate every batch before mutating the merged output.
    const response = parseAndValidateOrganizationResponse(batch.response, batch.sourceTabIds);
    for (const group of response.groups) {
      const id = batches.length > 1 ? `b${batchIndex}-${group.id}` : group.id;
      const workspaceId = group.existingWorkspaceId;
      if (workspaceId === null) {
        groups.push({ ...group, id });
        continue;
      }
      const existing = groupByWorkspaceId.get(workspaceId);
      if (existing) {
        existing.tabIds.push(...group.tabIds);
        continue;
      }
      const workspace = workspaceById.get(workspaceId);
      if (!workspace) throw new AIValidationError(tr("ai.unknownWorkspace", { id: workspaceId }));
      const reused = { ...group, id, name: workspace.name, description: workspace.description, tags: [...workspace.tags] };
      groups.push(reused);
      groupByWorkspaceId.set(workspaceId, reused);
    }
    for (const tabId of response.unclassifiedTabIds) {
      if (!seenUnclassified.has(tabId)) {
        seenUnclassified.add(tabId);
        unclassifiedTabIds.push(tabId);
      }
    }
  }

  return validateOrganizationPreview(
    { groups, unclassifiedTabIds },
    mode,
    sourceTabIds,
    sourceFingerprint
  );
}

async function requestBatch(
  client: AIClient,
  tabs: readonly TabRecord[],
  mode: OrganizationMode,
  existingWorkspaces: OrganizationPipelineRequest["existingWorkspaces"],
  language: AppLanguage,
  options: Required<Pick<CompleteOptions, "signal" | "deadlineAt">>
): Promise<OrganizationResponse> {
  const baseMessages: ChatMessage[] = buildOrganizationMessages({ mode, tabs, existingWorkspaces, language });
  const tabIds = tabs.map((tab) => tab.id);
  let messages = baseMessages;
  let previousRaw: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (options.signal.aborted) throw new AIAbortError();
    if (Date.now() >= options.deadlineAt) throw new AITimeoutError();
    try {
      const raw = await client.completeJSON(messages, organizationResponseSchema, {
        ...options,
        maxTokens: organizationOutputTokenBudget(tabs.length)
      });
      previousRaw = raw;
      return parseAndValidateOrganizationResponse(raw, tabIds);
    } catch (error) {
      const retryableValidation = error instanceof AIValidationError || error instanceof AIInvalidJsonError;
      if (!retryableValidation || attempt === 1 || options.signal.aborted) throw error;
      const correction = `The previous JSON was invalid or incomplete. Return corrected JSON only. Assign every required tab ID exactly once. Required IDs (${tabIds.length}): ${JSON.stringify(tabIds)}.`;
      messages = previousRaw === undefined
        ? [...baseMessages, { role: "user", content: correction }]
        : [...baseMessages, { role: "assistant", content: JSON.stringify(previousRaw) }, { role: "user", content: correction }];
    }
  }
  throw new AIValidationError(tr("ai.schemaFailed"));
}

export async function organizeTabs(request: OrganizationPipelineRequest): Promise<OrganizationPreview> {
  const deadlineAt = request.deadlineAt ?? request.clientOptions?.retry?.deadlineAt ?? Date.now() + DEFAULT_ORGANIZATION_BUDGET_MS;
  const modeResult = organizationModeSchema.safeParse(request.mode);
  if (!modeResult.success) throw new AIValidationError(tr("ai.unsupportedMode"), modeResult.error.issues);
  ensureTabInput(request.tabs);
  const batchSize = request.batchSize ?? DEFAULT_BATCH_SIZE;
  const requestedConcurrency = request.requestConcurrency ?? DEFAULT_REQUEST_CONCURRENCY;
  const requestConcurrency = Number.isFinite(requestedConcurrency) && requestedConcurrency > 0
    ? Math.max(1, Math.floor(requestedConcurrency))
    : DEFAULT_REQUEST_CONCURRENCY;
  const batches = chunk(request.tabs, batchSize);
  const expectedSnapshot = request.snapshot ?? createTabSnapshot(request.tabs, request.revision);
  const client = request.client ?? (request.config ? new OpenAICompatibleClient(request.config, request.clientOptions) : undefined);
  if (!client) throw new AIConfigError(tr("ai.clientRequired"));

  const language = request.language ?? getAppLanguage();
  const batchController = new AbortController();
  const abortBatches = () => batchController.abort();
  if (request.signal?.aborted) abortBatches();
  else request.signal?.addEventListener("abort", abortBatches, { once: true });
  const batchOptions = { signal: batchController.signal, deadlineAt };
  let results: BatchOrganizationResult[];
  try {
    results = await mapWithConcurrency(batches, requestConcurrency, async (tabs) => {
      const sourceTabIds = tabs.map((tab) => tab.id);
      const response = await requestBatch(client, tabs, modeResult.data, request.existingWorkspaces, language, batchOptions);
      return { sourceTabIds, response };
    }, abortBatches);
    if (batchController.signal.aborted) throw new AIAbortError();
  } finally {
    request.signal?.removeEventListener("abort", abortBatches);
  }

  if (request.getCurrentSnapshot) {
    assertSnapshotUnchanged(expectedSnapshot, await request.getCurrentSnapshot());
  } else if (request.getCurrentTabs) {
    assertSnapshotUnchanged(expectedSnapshot, await request.getCurrentTabs());
  }

  // Merge and validate only after every batch succeeded; callers never receive partial data.
  // The fingerprint is added locally and is never part of the provider prompt.
  return mergeBatchOrganizationResponses(
    results,
    modeResult.data,
    request.tabs.map((tab) => tab.id),
    expectedSnapshot.fingerprint,
    request.existingWorkspaces
  );
}

export const runOrganizationPipeline = organizeTabs;
export const organizeTabsWithAI = organizeTabs;
export { createTabSnapshot, assertSnapshotUnchanged };
