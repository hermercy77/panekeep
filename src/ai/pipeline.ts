import type {
  AIConfig,
  OrganizationMode,
  OrganizationPreview,
  TabRecord,
  Workspace
} from "../shared/contracts";
import { organizationPreviewSchema, organizationModeSchema } from "../shared/contracts";
import { AIValidationError, AIConfigError, AIConflictError } from "./errors";
import { OpenAICompatibleClient, type AIClient, type OpenAICompatibleClientOptions } from "./client";
import { buildOrganizationMessages } from "./prompts";
import {
  organizationResponseSchema,
  parseAndValidateOrganizationResponse,
  validateOrganizationPreview,
  type OrganizationResponse
} from "./schema";
import { assertSnapshotUnchanged, createTabSnapshot, type TabSnapshot } from "./snapshot";

export interface OrganizationPipelineRequest {
  tabs: readonly TabRecord[];
  mode: OrganizationMode;
  client?: AIClient;
  config?: AIConfig;
  clientOptions?: OpenAICompatibleClientOptions;
  existingWorkspaces?: readonly Pick<Workspace, "id" | "name" | "description" | "tags">[];
  /** Number of tabs per provider call. Defaults to 50. */
  batchSize?: number;
  snapshot?: TabSnapshot;
  revision?: string | number;
  getCurrentSnapshot?: () => TabSnapshot | Promise<TabSnapshot>;
  getCurrentTabs?: () => readonly TabRecord[] | Promise<readonly TabRecord[]>;
  signal?: AbortSignal;
}

export interface BatchOrganizationResult {
  sourceTabIds: string[];
  response: OrganizationResponse;
}

const DEFAULT_BATCH_SIZE = 50;

export function chunk<T>(values: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size <= 0) throw new RangeError("Batch size must be a positive integer");
  const batches: T[][] = [];
  for (let index = 0; index < values.length; index += size) batches.push([...values.slice(index, index + size)]);
  return batches;
}

function ensureTabInput(tabs: readonly TabRecord[]): void {
  const ids = tabs.map((tab) => tab.id);
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    throw new AIValidationError("AI organization requires unique, non-empty tab IDs");
  }
}

function sameGroupMetadata(left: OrganizationResponse["groups"][number], right: OrganizationResponse["groups"][number]): boolean {
  return (
    left.name === right.name &&
    left.description === right.description &&
    left.existingWorkspaceId === right.existingWorkspaceId &&
    left.tags.length === right.tags.length &&
    left.tags.every((tag, index) => tag === right.tags[index])
  );
}

export function mergeBatchOrganizationResponses(
  batches: readonly BatchOrganizationResult[],
  mode: OrganizationMode,
  sourceTabIds: readonly string[]
): OrganizationPreview {
  const groups: OrganizationResponse["groups"] = [];
  const groupById = new Map<string, OrganizationResponse["groups"][number]>();
  const unclassifiedTabIds: string[] = [];
  const seenUnclassified = new Set<string>();

  for (const batch of batches) {
    // Validate every batch before mutating the merged output.
    const response = parseAndValidateOrganizationResponse(batch.response, batch.sourceTabIds);
    for (const group of response.groups) {
      const existing = groupById.get(group.id);
      if (!existing) {
        const copy = { ...group, tabIds: [...group.tabIds], tags: [...group.tags] };
        groups.push(copy);
        groupById.set(group.id, copy);
      } else {
        if (!sameGroupMetadata(existing, group)) {
          throw new AIValidationError(`AI response was rejected in full: conflicting metadata for group ${group.id}`);
        }
        existing.tabIds.push(...group.tabIds);
      }
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
    sourceTabIds
  );
}

async function requestBatch(
  client: AIClient,
  tabs: readonly TabRecord[],
  mode: OrganizationMode,
  existingWorkspaces: OrganizationPipelineRequest["existingWorkspaces"],
  signal?: AbortSignal
): Promise<OrganizationResponse> {
  const messages = buildOrganizationMessages({ mode, tabs, existingWorkspaces });
  const raw = await client.completeJSON(messages, organizationResponseSchema, { signal });
  return parseAndValidateOrganizationResponse(raw, tabs.map((tab) => tab.id));
}

export async function organizeTabs(request: OrganizationPipelineRequest): Promise<OrganizationPreview> {
  const modeResult = organizationModeSchema.safeParse(request.mode);
  if (!modeResult.success) throw new AIValidationError("Unsupported organization mode", modeResult.error.issues);
  ensureTabInput(request.tabs);
  const batchSize = request.batchSize ?? DEFAULT_BATCH_SIZE;
  const batches = chunk(request.tabs, batchSize);
  const expectedSnapshot = request.snapshot ?? createTabSnapshot(request.tabs, request.revision);
  const client = request.client ?? (request.config ? new OpenAICompatibleClient(request.config, request.clientOptions) : undefined);
  if (!client) throw new AIConfigError("An AI client or AI configuration is required");

  const results: BatchOrganizationResult[] = [];
  for (const tabs of batches) {
    if (request.signal?.aborted) throw new AIConflictError("AI organization was cancelled");
    const sourceTabIds = tabs.map((tab) => tab.id);
    const response = await requestBatch(client, tabs, modeResult.data, request.existingWorkspaces, request.signal);
    results.push({ sourceTabIds, response });
  }

  if (request.getCurrentSnapshot) {
    assertSnapshotUnchanged(expectedSnapshot, await request.getCurrentSnapshot());
  } else if (request.getCurrentTabs) {
    assertSnapshotUnchanged(expectedSnapshot, await request.getCurrentTabs());
  }

  // Merge and validate only after every batch succeeded; callers never receive partial data.
  return mergeBatchOrganizationResponses(results, modeResult.data, request.tabs.map((tab) => tab.id));
}

export const runOrganizationPipeline = organizeTabs;
export const organizeTabsWithAI = organizeTabs;
export { createTabSnapshot, assertSnapshotUnchanged };
