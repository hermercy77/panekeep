import { z } from "zod";
import {
  organizationModeSchema,
  organizationPreviewSchema,
  type OrganizationMode,
  type OrganizationPreview
} from "../shared/contracts";
import { AIInvalidJsonError, AIValidationError } from "./errors";

const idSchema = z.string().min(1);

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

function issueMessage(issues: readonly { path?: PropertyKey[]; message?: string }[]): string {
  return issues
    .map((issue) => {
      const path = issue.path?.length ? issue.path.join(".") : "response";
      return `${path}: ${issue.message ?? "invalid value"}`;
    })
    .join("; ");
}

/** Parse JSON without accepting Markdown fences, comments, or trailing text. */
export function parseStrictJson(value: unknown): unknown {
  if (typeof value !== "string") {
    throw new AIInvalidJsonError("AI response content must be a JSON string");
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new AIInvalidJsonError("AI response was not valid JSON", error);
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
      `AI response failed schema validation: ${issueMessage(parsed.error.issues)}`,
      parsed.error.issues
    );
  }

  const source = [...sourceTabIds];
  const sourceSet = new Set(source);
  const issues: string[] = [];
  if (source.some((id, index) => source.indexOf(id) !== index)) {
    issues.push("source tab IDs contain duplicates");
  }

  const seenTabIds = new Set<string>();
  const seenGroupIds = new Set<string>();
  for (const [groupIndex, group] of parsed.data.groups.entries()) {
    if (seenGroupIds.has(group.id)) issues.push(`groups.${groupIndex}.id is duplicated`);
    seenGroupIds.add(group.id);
    for (const tabId of group.tabIds) {
      if (!sourceSet.has(tabId)) issues.push(`groups.${groupIndex}.tabIds contains unknown tab ${tabId}`);
      if (seenTabIds.has(tabId)) issues.push(`tab ${tabId} is assigned more than once`);
      seenTabIds.add(tabId);
    }
  }

  for (const [index, tabId] of parsed.data.unclassifiedTabIds.entries()) {
    if (!sourceSet.has(tabId)) issues.push(`unclassifiedTabIds.${index} contains unknown tab ${tabId}`);
    if (seenTabIds.has(tabId)) issues.push(`tab ${tabId} is assigned more than once`);
    seenTabIds.add(tabId);
  }

  for (const tabId of sourceSet) {
    if (!seenTabIds.has(tabId)) issues.push(`tab ${tabId} is missing from the AI response`);
  }

  if (issues.length) {
    throw new AIValidationError(`AI response was rejected in full: ${issues.join("; ")}`, issues);
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
  sourceTabIds: readonly string[]
): OrganizationPreview {
  const modeResult = organizationModeSchema.safeParse(mode);
  if (!modeResult.success) {
    throw new AIValidationError("Unsupported organization mode", modeResult.error.issues);
  }
  const response = parseAndValidateOrganizationResponse(value, sourceTabIds);
  const previewCandidate = {
    mode: modeResult.data,
    sourceTabIds: [...sourceTabIds],
    groups: response.groups.map((group) => ({ ...group })),
    unclassifiedTabIds: [...response.unclassifiedTabIds]
  };
  const result = organizationPreviewSchema.safeParse(previewCandidate);
  if (!result.success) {
    throw new AIValidationError(
      `Organization preview failed contract validation: ${issueMessage(result.error.issues)}`,
      result.error.issues
    );
  }
  return result.data;
}

export const organizationPreviewResponseSchema = organizationResponseSchema;
export const aiOrganizationResponseSchema = organizationResponseSchema;
