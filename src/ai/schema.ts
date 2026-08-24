import { z } from "zod";
import {
  organizationModeSchema,
  organizationPreviewSchema,
  type OrganizationMode,
  type OrganizationPreview
} from "../shared/contracts";
import { AIInvalidJsonError, AIValidationError } from "./errors";
import { getAppLanguage, translate } from "../i18n";

const idSchema = z.string().min(1);

function tr(key: Parameters<typeof translate>[1], variables?: Record<string, string | number | undefined>): string {
  return translate(getAppLanguage(), key, variables);
}

/** Strict response shape accepted from an AI provider for one batch. */
export const organizationGroupResponseSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1),
    description: z.string().default(""),
    tags: z.array(z.string()).default([]),
    existingWorkspaceId: z.string().nullable(),
    tabIds: z.array(idSchema).min(1)
  })
  .strict();

export const organizationResponseSchema = z
  .object({
    groups: z.array(organizationGroupResponseSchema),
    unclassifiedTabIds: z.array(idSchema)
  })
  .strict();

export type OrganizationGroupResponse = z.infer<typeof organizationGroupResponseSchema>;
export type OrganizationResponse = z.infer<typeof organizationResponseSchema>;

/** Parse JSON without accepting Markdown fences, comments, or trailing text. */
export function parseStrictJson(value: unknown): unknown {
  if (typeof value !== "string") {
    throw new AIInvalidJsonError(tr("ai.responseStringRequired"));
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new AIInvalidJsonError(tr("ai.invalidJson"), error);
  }
}

export function parseAndValidateOrganizationResponse(
  value: unknown,
  sourceTabIds: readonly string[]
): OrganizationResponse {
  const json = typeof value === "string" ? parseStrictJson(value) : value;
  const parsed = organizationResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new AIValidationError(
      tr("ai.schemaFailed"),
      parsed.error.issues
    );
  }

  const source = [...sourceTabIds];
  const sourceSet = new Set(source);
  const issues: string[] = [];
  if (source.some((id, index) => source.indexOf(id) !== index)) {
    issues.push(tr("ai.sourceIdsDuplicate"));
  }

  const seenTabIds = new Set<string>();
  const seenGroupIds = new Set<string>();
  for (const [groupIndex, group] of parsed.data.groups.entries()) {
    if (seenGroupIds.has(group.id)) issues.push(tr("ai.groupIdDuplicate", { index: groupIndex + 1 }));
    seenGroupIds.add(group.id);
    for (const tabId of group.tabIds) {
      if (!sourceSet.has(tabId)) issues.push(tr("ai.unknownTab", { id: tabId }));
      if (seenTabIds.has(tabId)) issues.push(tr("ai.tabAssignedTwice", { id: tabId }));
      seenTabIds.add(tabId);
    }
  }

  for (const [index, tabId] of parsed.data.unclassifiedTabIds.entries()) {
    if (!sourceSet.has(tabId)) issues.push(tr("ai.unknownTab", { id: tabId, index: index + 1 }));
    if (seenTabIds.has(tabId)) issues.push(tr("ai.tabAssignedTwice", { id: tabId }));
    seenTabIds.add(tabId);
  }

  for (const tabId of sourceSet) {
    if (!seenTabIds.has(tabId)) issues.push(tr("ai.tabMissing", { id: tabId }));
  }

  if (issues.length) {
    throw new AIValidationError(tr("ai.responseRejected", { details: issues.join("; ") }), issues);
  }
  return parsed.data;
}

/**
 * Add the local mode and source IDs only after the provider payload has been
 * completely validated. This prevents a partially valid preview from leaking
 * to callers.
 */
export function validateOrganizationPreview(
  value: unknown,
  mode: OrganizationMode,
  sourceTabIds: readonly string[],
  sourceFingerprint: string
): OrganizationPreview {
  const modeResult = organizationModeSchema.safeParse(mode);
  if (!modeResult.success) {
    throw new AIValidationError(tr("ai.unsupportedMode"), modeResult.error.issues);
  }
  const response = parseAndValidateOrganizationResponse(value, sourceTabIds);
  const previewCandidate = {
    mode: modeResult.data,
    sourceTabIds: [...sourceTabIds],
    sourceFingerprint,
    groups: response.groups.map((group) => ({ ...group })),
    unclassifiedTabIds: [...response.unclassifiedTabIds]
  };
  const result = organizationPreviewSchema.safeParse(previewCandidate);
  if (!result.success) {
    throw new AIValidationError(
      tr("ai.previewContractFailed"),
      result.error.issues
    );
  }
  return result.data;
}

export const organizationPreviewResponseSchema = organizationResponseSchema;
export const aiOrganizationResponseSchema = organizationResponseSchema;
